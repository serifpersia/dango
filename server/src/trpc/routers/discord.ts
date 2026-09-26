import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import { defineSchema, optStr, reqObj } from '../validation.js'
import { discordRPCService } from '../../discord-rpc.js'
import { discordGatewayService } from '../../discord-gateway.js'
import { getDlsitePoster, getMangadexCover } from '../../hono/watchlist.js'
import { updateEnvFile } from '../../utils/env.utils.js'
import { CONFIG } from '../../config.js'
import logger from '../../logger.js'

function failed(message: string): TRPCError {
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message })
}

function badRequest(message: string): TRPCError {
  return new TRPCError({ code: 'BAD_REQUEST', message })
}

function maskToken(t: string | undefined | null): string {
  if (!t) return 'none'
  return t.slice(0, 8) + '...' + t.slice(-4)
}

const gatewayLog = logger.child({ module: 'DiscordGatewayRoutes' })

function optUnknown(obj: Record<string, unknown>, name: string): unknown {
  return obj[name]
}

function cleanProxyThumb(value: unknown): string {
  let thumb = String(value || '')
  if (thumb.includes('/api/proxy') || thumb.includes('/api/image-proxy')) {
    const match = thumb.match(/url=([^&]+)/)
    if (match) {
      try {
        thumb = decodeURIComponent(match[1])
      } catch {
        return ''
      }
    }
  }
  if (!thumb.startsWith('https://')) return ''
  if (thumb.includes('localhost') || thumb.includes('127.0.0.1')) return ''
  return thumb
}

export type PresenceBase = Record<string, unknown>

const presenceInput = () =>
  defineSchema<PresenceBase, PresenceBase>((value) => {
    if (value === undefined || value === null) return {}
    return { ...reqObj(value) }
  })

export const discordRouter = router({
  pageStatus: protectedProcedure.input(presenceInput()).mutation(async ({ input }) => {
    const page = optUnknown(input, 'page')
    if (typeof page !== 'string' || !discordRPCService.isServiceEnabled) {
      return { success: true }
    }
    discordRPCService.setIdleStatus(page)
    return { success: true }
  }),

  heartbeat: protectedProcedure.input(presenceInput()).mutation(async ({ input }) => {
    const sessionId = optUnknown(input, 'sessionId')
    const bye = optUnknown(input, 'bye')
    if (typeof sessionId !== 'string' || !discordRPCService.isServiceEnabled) {
      return { success: true }
    }
    if (bye) {
      discordRPCService.removeHeartbeat(sessionId)
    } else {
      discordRPCService.heartbeat(sessionId)
    }
    return { success: true }
  }),

  asmrPresence: protectedProcedure.input(presenceInput()).mutation(async ({ input }) => {
    if (!discordRPCService.isServiceEnabled) return { success: true }
    const sessionId = optUnknown(input, 'sessionId')
    if (typeof sessionId === 'string') discordRPCService.heartbeat(sessionId)
    const thumbnail = optUnknown(input, 'thumbnail')
    const thumbnails = optUnknown(input, 'thumbnails')
    const rjCode = optUnknown(input, 'rjCode')
    let thumb = String(thumbnail || '')
    const thumbs = Array.isArray(thumbnails) ? thumbnails.map(String).filter(Boolean) : undefined
    const needsDlsite =
      !thumb || thumb.includes('weeabo0.xyz') || thumb.includes('japaneseasmr.com')
    if (needsDlsite && rjCode) {
      const dlsiteThumb = await getDlsitePoster(String(rjCode))
      if (dlsiteThumb) thumb = dlsiteThumb
    }
    if (thumb.includes('/api/image-proxy') || thumb.includes('weeabo0.xyz')) thumb = ''
    discordRPCService.updatePresence({
      title: String(optUnknown(input, 'title') || 'ASMR').slice(0, 128),
      episode: String(optUnknown(input, 'trackLabel') || '').slice(0, 64),
      totalEpisodes: '',
      currentTime: Number(optUnknown(input, 'currentTime')) || 0,
      duration: Number(optUnknown(input, 'duration')) || 0,
      thumbnail: thumb,
      thumbnails: thumbs,
      isPlaying: !!optUnknown(input, 'isPlaying'),
      providerName: 'ASMR',
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      isAdult: !!optUnknown(input, 'isAdult'),
    })
    return { success: true }
  }),

  radioPresence: protectedProcedure.input(presenceInput()).mutation(async ({ input }) => {
    if (!discordRPCService.isServiceEnabled) return { success: true }
    const sessionId = optUnknown(input, 'sessionId')
    if (typeof sessionId === 'string') discordRPCService.heartbeat(sessionId)
    let thumb = String(optUnknown(input, 'thumbnail') || '')
    if (thumb.includes('/api/image-proxy')) {
      const match = thumb.match(/url=([^&]+)/)
      if (match) thumb = decodeURIComponent(match[1])
    }
    if (thumb && !thumb.startsWith('https://')) thumb = ''
    if (thumb.includes('localhost') || thumb.includes('127.0.0.1')) thumb = ''
    const stationLabel = String(optUnknown(input, 'stationLabel') || '')
    discordRPCService.updatePresence({
      title: String(optUnknown(input, 'title') || 'Radio').slice(0, 128),
      episode: stationLabel.slice(0, 64),
      totalEpisodes: '',
      stateLine: (stationLabel || 'Radio').slice(0, 64),
      currentTime: Number(optUnknown(input, 'currentTime')) || 0,
      duration: 0,
      thumbnail: thumb,
      isPlaying: !!optUnknown(input, 'isPlaying'),
      providerName: 'Radio',
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      isAdult: false,
    })
    return { success: true }
  }),

  musicPresence: protectedProcedure.input(presenceInput()).mutation(async ({ input }) => {
    if (!discordRPCService.isServiceEnabled) return { success: true }
    const sessionId = optUnknown(input, 'sessionId')
    if (typeof sessionId === 'string') discordRPCService.heartbeat(sessionId)
    let thumb = String(optUnknown(input, 'thumbnail') || '')
    if (thumb.includes('/api/image-proxy')) {
      const match = thumb.match(/url=([^&]+)/)
      if (match) thumb = decodeURIComponent(match[1])
    }
    if (thumb && !thumb.startsWith('https://')) thumb = ''
    if (thumb.includes('localhost') || thumb.includes('127.0.0.1')) thumb = ''
    const artistLabel = String(optUnknown(input, 'artistLabel') || '')
    discordRPCService.updatePresence({
      title: String(optUnknown(input, 'title') || 'Music').slice(0, 128),
      episode: artistLabel.slice(0, 64),
      totalEpisodes: '',
      stateLine: (artistLabel || 'Music').slice(0, 64),
      currentTime: Number(optUnknown(input, 'currentTime')) || 0,
      duration: Number(optUnknown(input, 'duration')) || 0,
      thumbnail: thumb,
      isPlaying: !!optUnknown(input, 'isPlaying'),
      providerName: 'Music',
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      isAdult: false,
    })
    return { success: true }
  }),

  mangaPresence: protectedProcedure.input(presenceInput()).mutation(async ({ input }) => {
    if (!discordRPCService.isServiceEnabled) return { success: true }
    const sessionId = optUnknown(input, 'sessionId')
    if (typeof sessionId === 'string') discordRPCService.heartbeat(sessionId)
    const thumbnails = optUnknown(input, 'thumbnails')
    const title = optUnknown(input, 'title')
    let thumb = cleanProxyThumb(optUnknown(input, 'thumbnail'))
    let thumbs = Array.isArray(thumbnails)
      ? (thumbnails.map(cleanProxyThumb).filter(Boolean) as string[])
      : undefined
    if (!thumb && title) {
      const fallback = await getMangadexCover(String(title))
      if (fallback) {
        thumb = fallback
        thumbs = [fallback, ...(thumbs || [])]
      }
    }
    const chapterLabel = String(optUnknown(input, 'chapterLabel') || '')
    discordRPCService.updatePresence({
      title: String(title || 'Manga').slice(0, 128),
      episode: chapterLabel.slice(0, 64),
      totalEpisodes: '',
      stateLine: (chapterLabel ? `Reading ${chapterLabel}` : 'Reading').slice(0, 64),
      currentTime: 0,
      duration: 0,
      thumbnail: thumb,
      thumbnails: thumbs,
      isPlaying: optUnknown(input, 'isPlaying') !== false,
      providerName: 'Manga',
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      isAdult: optUnknown(input, 'isAdult') === true,
    })
    return { success: true }
  }),

  tvPresence: protectedProcedure.input(presenceInput()).mutation(async ({ input }) => {
    if (!discordRPCService.isServiceEnabled) return { success: true }
    const sessionId = optUnknown(input, 'sessionId')
    if (typeof sessionId === 'string') discordRPCService.heartbeat(sessionId)
    const thumbnail = optUnknown(input, 'thumbnail')
    let thumb = String(thumbnail || '')
    if (thumb.includes('/api/image-proxy')) {
      const match = thumb.match(/url=([^&]+)/)
      if (match) thumb = decodeURIComponent(match[1])
    }
    if (thumb.includes('localhost') || thumb.includes('127.0.0.1')) thumb = ''
    const episodeLabel = String(optUnknown(input, 'episodeLabel') || '')
    discordRPCService.updatePresence({
      title: String(optUnknown(input, 'title') || 'TV').slice(0, 128),
      episode: episodeLabel.slice(0, 64),
      totalEpisodes: '',
      stateLine: (episodeLabel || 'Movie').slice(0, 64),
      currentTime: Number(optUnknown(input, 'currentTime')) || 0,
      duration: Number(optUnknown(input, 'duration')) || 0,
      thumbnail: thumb,
      isPlaying: !!optUnknown(input, 'isPlaying'),
      providerName: 'TV',
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      isAdult: optUnknown(input, 'isAdult') === true,
    })
    return { success: true }
  }),

  gatewayStatus: protectedProcedure.query(() => {
    const hasToken = discordGatewayService.hasToken()
    return {
      hasToken,
      masked: hasToken ? maskToken(process.env.DISCORD_GATEWAY_TOKEN) : null,
      enabled: discordGatewayService.serviceEnabled,
    }
  }),

  gatewaySave: protectedProcedure
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

  gatewayRemove: protectedProcedure.mutation(async () => {
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

  rolesConfig: protectedProcedure.query(() => {
    return { workerUrl: CONFIG.DISCORD_ROLES_WORKER_URL || null }
  }),
})
