import { protectedProcedure, router } from '../index.js'
import { defineSchema, optStr, reqObj } from '../validation.js'
import logger from '../../logger.js'
import { parseJsonBody } from '../../utils/http.utils.js'

export interface RadioStation {
  id: string
  name: string
  streamUrl: string
  homepage?: string
  favicon?: string
  tags?: string
  codec?: string
  bitrate?: number
  source: 'listen.moe' | 'radio-browser'
  gateway?: string
}

const LISTEN_MOE_STATIONS: RadioStation[] = [
  {
    id: 'listenmoe-jpop',
    name: 'LISTEN.moe JPOP',
    streamUrl: 'https://listen.moe/fallback',
    homepage: 'https://listen.moe/',
    tags: 'anime,j-pop,jpop',
    codec: 'MP3',
    source: 'listen.moe',
    gateway: 'wss://listen.moe/gateway_v2',
  },
  {
    id: 'listenmoe-kpop',
    name: 'LISTEN.moe KPOP',
    streamUrl: 'https://listen.moe/kpop/fallback',
    homepage: 'https://listen.moe/',
    tags: 'k-pop,kpop',
    codec: 'MP3',
    source: 'listen.moe',
    gateway: 'wss://listen.moe/kpop/gateway_v2',
  },
]

const FEATURED_STATIONS: RadioStation[] = [
  {
    id: 'stereo-anime',
    name: 'stereo anime',
    streamUrl: 'https://radio.stereoanime.com/listen/stereoanime/128',
    tags: 'anime',
    codec: 'MP3',
    bitrate: 128,
    source: 'radio-browser',
  },
  {
    id: 'jpop-sakura',
    name: 'J-Pop Sakura (asia DREAM radio)',
    streamUrl: 'https://quincy.torontocast.com:2070/stream.mp3',
    tags: 'j-pop,jpop',
    codec: 'MP3',
    bitrate: 128,
    source: 'radio-browser',
  },
  {
    id: 'n-kpop',
    name: '0 N - K-Pop on Radio',
    streamUrl: 'https://0n-kpop.radionetz.de/0n-kpop.mp3',
    tags: 'k-pop,kpop',
    codec: 'MP3',
    bitrate: 128,
    source: 'radio-browser',
  },
  {
    id: 'bigb-kpop',
    name: 'Big B Radio - Kpop',
    streamUrl: 'https://antares.dribbcast.com/proxy/kpop?mp=/s',
    tags: 'k-pop,kpop',
    codec: 'MP3',
    bitrate: 192,
    source: 'radio-browser',
  },
]

const RB_MIRRORS = ['https://de1.api.radio-browser.info', 'https://nl1.api.radio-browser.info']

async function rbFetch(path: string): Promise<unknown[]> {
  let lastErr: unknown = null
  for (const base of RB_MIRRORS) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { 'User-Agent': 'dango/1.0' },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) throw new Error(`radio-browser ${res.status}`)
      return parseJsonBody<unknown[]>(res)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

interface RbStation {
  stationuuid?: string
  name?: string
  url_resolved?: string
  homepage?: string
  favicon?: string
  tags?: string
  codec?: string
  bitrate?: number
}

function toStation(s: RbStation): RadioStation | null {
  const url = s.url_resolved || ''
  if (!url.startsWith('https://')) return null
  return {
    id: s.stationuuid || url,
    name: s.name || 'Unknown station',
    streamUrl: url,
    homepage: s.homepage || undefined,
    favicon: s.favicon && s.favicon.startsWith('https://') ? s.favicon : undefined,
    tags: s.tags || undefined,
    codec: s.codec || undefined,
    bitrate: s.bitrate || undefined,
    source: 'radio-browser',
  }
}

export type RadioSearchInput = { q?: string }

const radioSearchInput = () =>
  defineSchema<RadioSearchInput, RadioSearchInput>((value) => {
    const obj = reqObj(value)
    const out: RadioSearchInput = {}
    const q = optStr(obj, 'q')
    if (q !== undefined) out.q = q
    return out
  })

export const radioRouter = router({
  stations: protectedProcedure.query(async ({ ctx }) => {
    try {
      const cached = ctx.apiCache.get<RadioStation[]>('route-radio-stations')
      if (cached) return { stations: cached }
      const stations = [...LISTEN_MOE_STATIONS, ...FEATURED_STATIONS]
      ctx.apiCache.set('route-radio-stations', stations, 3600)
      return { stations }
    } catch (err) {
      logger.error({ err }, '[Radio] stations failed')
      return { stations: LISTEN_MOE_STATIONS }
    }
  }),

  search: protectedProcedure.input(radioSearchInput()).query(async ({ ctx, input }) => {
    try {
      const q = String(input.q || '').trim()
      if (!q) return { stations: [] as RadioStation[] }
      const cacheKey = `route-radio-search-${q.toLowerCase()}`
      const cached = ctx.apiCache.get<RadioStation[]>(cacheKey)
      if (cached) return { stations: cached }
      const raw = (await rbFetch(
        `/json/stations/search?name=${encodeURIComponent(q)}&hidebroken=true&order=clickcount&reverse=true&limit=25`
      )) as RbStation[]
      const stations = raw
        .map(toStation)
        .filter((s): s is RadioStation => s !== null)
        .slice(0, 25)
      ctx.apiCache.set(cacheKey, stations, 300)
      return { stations }
    } catch (err) {
      logger.error({ err }, '[Radio] search failed')
      return { stations: [] as RadioStation[] }
    }
  }),
})
