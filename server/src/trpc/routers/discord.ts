import { ownerProcedure, router } from '../index.js'
import { defineSchema, optNum, optStr, reqObj } from '../validation.js'
import { badRequest, failed } from '../errors.js'
import type { TrpcContext } from '../context.js'
import { discordGatewayService } from '../../discord-gateway.js'
import { getDlsitePoster, getMangadexCover } from '../../lib/posters.js'
import { updateEnvFile } from '../../utils/env.utils.js'
import logger from '../../logger.js'

function maskToken(t: string | undefined | null): string {
  if (!t) return 'none'
  return t.slice(0, 8) + '...' + t.slice(-4)
}

const gatewayLog = logger.child({ module: 'DiscordGatewayRoutes' })

function cleanProxyThumb(value: unknown): string {
  let thumb = String(value || '')
  if (thumb.includes('/api/proxy') || thumb.includes('/api/image-proxy')) {
    const match = thumb.match(/url=([^&]+)/)
    if (match) {
      try {
        thumb = decodeURIComponent(match[1])
      } catch (e) {
        gatewayLog.warn({ err: e, thumb }, 'The proxy thumbnail url is not decodable')
        return ''
      }
    }
  }
  if (!thumb.startsWith('https://')) return ''
  if (thumb.includes('localhost') || thumb.includes('127.0.0.1')) return ''
  return thumb
}

export type PresenceInput = {
  sessionId?: string
  title?: string
  thumbnail?: string
  thumbnails?: string[]
  isPlaying?: boolean
  isAdult?: boolean
  currentTime?: number
  duration?: number
  trackLabel?: string
  chapterLabel?: string
  episodeLabel?: string
  rjCode?: string
}

export const presenceInput = () =>
  defineSchema<PresenceInput, PresenceInput>((value) => {
    if (value === undefined || value === null) return {}
    const obj = reqObj(value)
    const out: PresenceInput = {}
    for (const key of [
      'sessionId',
      'title',
      'thumbnail',
      'trackLabel',
      'chapterLabel',
      'episodeLabel',
      'rjCode',
    ] as const) {
      const v = optStr(obj, key)
      if (v !== undefined) out[key] = v
    }
    const thumbs = obj.thumbnails
    if (Array.isArray(thumbs)) out.thumbnails = thumbs.map(String).filter(Boolean)
    if (typeof obj.isPlaying === 'boolean') out.isPlaying = obj.isPlaying
    if (typeof obj.isAdult === 'boolean') out.isAdult = obj.isAdult
    const currentTime = optNum(obj, 'currentTime')
    if (currentTime !== undefined) out.currentTime = currentTime
    const duration = optNum(obj, 'duration')
    if (duration !== undefined) out.duration = duration
    return out
  })

const pageStatusInput = () =>
  defineSchema<{ page?: string }, { page?: string }>((value) => {
    if (value === undefined || value === null) return {}
    const page = optStr(reqObj(value), 'page')
    return page === undefined ? {} : { page }
  })

const heartbeatInput = () =>
  defineSchema<{ sessionId?: string; bye?: boolean }, { sessionId?: string; bye?: boolean }>(
    (value) => {
      if (value === undefined || value === null) return {}
      const obj = reqObj(value)
      const out: { sessionId?: string; bye?: boolean } = {}
      const sessionId = optStr(obj, 'sessionId')
      if (sessionId !== undefined) out.sessionId = sessionId
      if (typeof obj.bye === 'boolean') out.bye = obj.bye
      return out
    }
  )

type PresenceKind = 'asmr' | 'manga' | 'tv'

const PRESENCE_KIND: Record<
  PresenceKind,
  {
    provider: string
    labelField: 'trackLabel' | 'chapterLabel' | 'episodeLabel'
    fallbackTitle: string
    playingByDefault: boolean
    state: (label: string) => string
  }
> = {
  asmr: {
    provider: 'ASMR',
    labelField: 'trackLabel',
    fallbackTitle: 'ASMR',
    playingByDefault: false,
    state: () => '',
  },
  manga: {
    provider: 'Manga',
    labelField: 'chapterLabel',
    fallbackTitle: 'Manga',
    playingByDefault: true,
    state: (label) => (label ? `Reading ${label}` : 'Reading'),
  },
  tv: {
    provider: 'TV',
    labelField: 'episodeLabel',
    fallbackTitle: 'TV',
    playingByDefault: false,
    state: (label) => label || 'Movie',
  },
}

async function presenceThumbnails(
  input: PresenceInput,
  kind: PresenceKind
): Promise<{ thumb: string; thumbs?: string[] }> {
  const raw = input.thumbnail || ''
  if (kind === 'asmr') {
    let thumb = raw
    const needsDlsite =
      !thumb || thumb.includes('weeabo0.xyz') || thumb.includes('japaneseasmr.com')
    if (needsDlsite && input.rjCode) {
      const dlsiteThumb = await getDlsitePoster(input.rjCode)
      if (dlsiteThumb) thumb = dlsiteThumb
    }
    if (thumb.includes('/api/image-proxy') || thumb.includes('weeabo0.xyz')) thumb = ''
    return { thumb, thumbs: input.thumbnails?.filter(Boolean) }
  }
  if (kind === 'manga') {
    const thumb = cleanProxyThumb(raw)
    const thumbs = input.thumbnails?.map(cleanProxyThumb).filter(Boolean)
    if (!thumb && input.title) {
      const fallback = await getMangadexCover(input.title)
      if (fallback) return { thumb: fallback, thumbs: [fallback, ...(thumbs || [])] }
    }
    return { thumb, thumbs }
  }
  return { thumb: cleanProxyThumb(raw) }
}

async function sendPresence(
  service: TrpcContext['discordRPC'],
  input: PresenceInput,
  kind: PresenceKind
): Promise<void> {
  if (!service.isServiceEnabled) return
  if (input.sessionId) service.heartbeat(input.sessionId)
  const conf = PRESENCE_KIND[kind]
  const label = input[conf.labelField] || ''
  const { thumb, thumbs } = await presenceThumbnails(input, kind)
  const timed = kind !== 'manga'
  service.updatePresence({
    title: (input.title || conf.fallbackTitle).slice(0, 128),
    episode: label.slice(0, 64),
    totalEpisodes: '',
    stateLine: conf.state(label).slice(0, 64),
    currentTime: timed ? input.currentTime || 0 : 0,
    duration: timed ? input.duration || 0 : 0,
    thumbnail: thumb,
    thumbnails: thumbs,
    isPlaying: input.isPlaying === undefined ? conf.playingByDefault : input.isPlaying,
    providerName: conf.provider,
    sessionId: input.sessionId,
    isAdult: input.isAdult === true,
  })
}

export const discordRouter = router({
  pageStatus: ownerProcedure.input(pageStatusInput()).mutation(async ({ ctx, input }) => {
    if (!input.page || !ctx.discordRPC.isServiceEnabled) {
      return { success: true }
    }
    ctx.discordRPC.setIdleStatus(input.page)
    return { success: true }
  }),

  heartbeat: ownerProcedure.input(heartbeatInput()).mutation(async ({ ctx, input }) => {
    if (!input.sessionId || !ctx.discordRPC.isServiceEnabled) {
      return { success: true }
    }
    if (input.bye) {
      ctx.discordRPC.removeHeartbeat(input.sessionId)
    } else {
      ctx.discordRPC.heartbeat(input.sessionId)
    }
    return { success: true }
  }),

  clear: ownerProcedure.input(heartbeatInput()).mutation(async ({ ctx, input }) => {
    if (!ctx.discordRPC.isServiceEnabled) {
      return { success: true }
    }
    ctx.discordRPC.clearPresence(input.sessionId)
    return { success: true }
  }),

  asmrPresence: ownerProcedure.input(presenceInput()).mutation(async ({ ctx, input }) => {
    await sendPresence(ctx.discordRPC, input, 'asmr')
    return { success: true }
  }),

  mangaPresence: ownerProcedure.input(presenceInput()).mutation(async ({ ctx, input }) => {
    await sendPresence(ctx.discordRPC, input, 'manga')
    return { success: true }
  }),

  tvPresence: ownerProcedure.input(presenceInput()).mutation(async ({ ctx, input }) => {
    await sendPresence(ctx.discordRPC, input, 'tv')
    return { success: true }
  }),

  gatewayStatus: ownerProcedure.query(() => {
    const hasToken = discordGatewayService.hasToken()
    return {
      hasToken,
      masked: hasToken ? maskToken(process.env.DISCORD_GATEWAY_TOKEN) : null,
      enabled: discordGatewayService.serviceEnabled,
    }
  }),

  gatewaySave: ownerProcedure
    .input(
      defineSchema<{ token?: string }, { token?: string }>((value) => {
        if (value === undefined || value === null) return {}
        const obj = reqObj(value)
        const out: { token?: string } = {}
        const token = optStr(obj, 'token')
        if (token !== undefined) out.token = token
        return out
      })
    )
    .mutation(async ({ input }) => {
      let token = (input.token || '').trim()
      if (token.startsWith('"') && token.endsWith('"')) token = token.slice(1, -1)
      if (token.length < 30) throw badRequest('Token too short')
      try {
        await updateEnvFile({ DISCORD_GATEWAY_TOKEN: token })
        discordGatewayService.reloadToken()
        gatewayLog.info(`Discord Gateway token saved ${maskToken(token)} (not logged)`)
        return { ok: true, masked: maskToken(token) }
      } catch (e) {
        gatewayLog.error({ err: e }, 'Failed to save Discord Gateway token')
        throw failed('Failed to save token')
      }
    }),

  gatewayRemove: ownerProcedure.mutation(async () => {
    try {
      await updateEnvFile({ DISCORD_GATEWAY_TOKEN: '' })
      discordGatewayService.reloadToken()
      gatewayLog.info('Discord Gateway token removed')
      return { ok: true }
    } catch (e) {
      gatewayLog.error({ err: e }, 'Failed to remove Discord Gateway token')
      throw failed('Failed to remove token')
    }
  }),
})
