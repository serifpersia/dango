import { fetchWithRetry, parseJsonBody } from '../utils/http.utils.js'
import type { TmdbEpisode } from './tmdb.js'

const TVMAZE_BASE = 'https://api.tvmaze.com'

export interface TvMazeEpisode {
  season?: number | null
  number?: number | null
  name?: string | null
  airdate?: string | null
  airtime?: string | null
  airtimestamp?: number | null
}

export interface TvMazeShow {
  id: number
  schedule?: { time?: string | null; days?: string[] | null } | null
  country?: { timezone?: string | null } | null
  webChannel?: { country?: { timezone?: string | null } | null } | null
}

export interface TvMazeData {
  show: TvMazeShow
  episodes: TvMazeEpisode[]
}

const TTL_MS = 30 * 60 * 1000
const cache = new Map<string, { exp: number; value: TvMazeData | null }>()

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetchWithRetry(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
      { timeoutMs: 10000 }
    )
    if (!res.ok) return null
    return await parseJsonBody<T | null>(res)
  } catch {
    return null
  }
}

export async function tvmazeShowByImdb(imdbId: string): Promise<TvMazeData | null> {
  const key = `tvmaze:${imdbId}`
  const hit = cache.get(key)
  if (hit && hit.exp > Date.now()) return hit.value

  let value: TvMazeData | null = null
  const show = await fetchJson<TvMazeShow>(
    `${TVMAZE_BASE}/lookup/shows?imdb=${encodeURIComponent(imdbId)}`
  )
  if (show?.id != null) {
    const episodes = await fetchJson<TvMazeEpisode[]>(`${TVMAZE_BASE}/shows/${show.id}/episodes`)
    if (episodes) value = { show, episodes }
  }
  cache.set(key, { exp: Date.now() + TTL_MS, value })
  return value
}

export function showTimezone(show: TvMazeShow): string | null {
  return show.country?.timezone ?? show.webChannel?.country?.timezone ?? null
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(utcMs)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second')
  )
  return wall - utcMs
}

export function airDateMidnightMs(airdate: string, tz: string | null): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(airdate)
  if (!m) return Number.NaN
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0)
  if (!tz) return guess
  try {
    return guess - tzOffsetMs(guess, tz)
  } catch {
    return guess
  }
}

export function airTimestampMs(
  ep: { airdate?: string | null; airtimestamp?: number | null },
  tz: string | null
): number | null {
  if (typeof ep.airtimestamp === 'number' && ep.airtimestamp > 0) return ep.airtimestamp * 1000
  const airdate = typeof ep.airdate === 'string' && ep.airdate !== '' ? ep.airdate : null
  if (!airdate) return null
  const ms = airDateMidnightMs(airdate, tz)
  return Number.isFinite(ms) ? ms : null
}

export interface NextAiring {
  episode_number: number
  season_number: number
  air_date: string | null
  name?: string
  air_timestamp: number | null
}

export function pickNextAiring(
  episodes: TvMazeEpisode[],
  show: TvMazeShow,
  today: string
): NextAiring | null {
  const tz = showTimezone(show)
  let best: { ep: TvMazeEpisode; ms: number } | null = null
  for (const ep of episodes) {
    const airdate = typeof ep.airdate === 'string' && ep.airdate !== '' ? ep.airdate : null
    if (!airdate || airdate <= today) continue
    if (typeof ep.season !== 'number' || typeof ep.number !== 'number') continue
    const ms = airTimestampMs(ep, tz)
    if (ms == null) continue
    if (!best || ms < best.ms) best = { ep, ms }
  }
  if (!best) return null
  return {
    episode_number: best.ep.number as number,
    season_number: best.ep.season as number,
    air_date: best.ep.airdate ?? null,
    name: best.ep.name ?? undefined,
    air_timestamp: best.ms,
  }
}

export interface ResolvedEpisodes<T extends TmdbEpisode> {
  aired: T[]
  nextAiring: NextAiring | null
}

export function resolveEpisodesWithTvMaze<T extends TmdbEpisode>(
  tmdbEpisodes: T[],
  data: TvMazeData | null,
  season: number,
  today: string
): ResolvedEpisodes<T> {
  const tz = data ? showTimezone(data.show) : null
  const byKey = new Map<string, TvMazeEpisode>()
  for (const ep of data?.episodes ?? []) {
    if (typeof ep.season === 'number' && typeof ep.number === 'number') {
      byKey.set(`${ep.season}:${ep.number}`, ep)
    }
  }

  const aired: T[] = []
  const upcoming: { ep: T; airDate: string; ms: number }[] = []
  for (const ep of tmdbEpisodes) {
    const maze = byKey.get(`${season}:${ep.episode_number}`)
    const airDate =
      maze?.airdate && typeof maze.airdate === 'string' && maze.airdate !== ''
        ? maze.airdate
        : typeof ep.air_date === 'string' && ep.air_date !== ''
          ? ep.air_date
          : null
    if (airDate && airDate <= today) {
      aired.push({ ...ep, air_date: airDate })
    } else if (airDate) {
      upcoming.push({
        ep,
        airDate,
        ms:
          airTimestampMs({ airdate: airDate, airtimestamp: maze?.airtimestamp ?? null }, tz) ??
          Number.NaN,
      })
    }
  }

  let nextAiring: NextAiring | null = null
  const dated = upcoming.filter((u) => Number.isFinite(u.ms)).sort((a, b) => a.ms - b.ms)
  if (dated.length > 0) {
    const next = dated[0]
    nextAiring = {
      episode_number: next.ep.episode_number,
      season_number: season,
      air_date: next.airDate,
      name: next.ep.name,
      air_timestamp: next.ms,
    }
  }

  if (!nextAiring && data) {
    const seasonNext = pickNextAiring(
      (data.episodes ?? []).filter((ep) => ep.season === season || typeof ep.season !== 'number'),
      data.show,
      today
    )
    if (seasonNext && seasonNext.season_number === season) nextAiring = seasonNext
  }

  return { aired, nextAiring }
}
