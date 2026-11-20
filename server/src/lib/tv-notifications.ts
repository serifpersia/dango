import { airTimestampMs, showTimezone, type TvMazeData } from './tvmaze.js'

export interface SeenEpisode {
  season: number
  episode: number
  currentTime?: number | null
  completed?: number | null
}

export interface PendingAiredSummary {
  season: number
  episode: number
  latestSeason: number
  latestEpisode: number
  pendingCount: number
  latestAiredMs: number
}

export interface NextAiringSummary {
  season: number
  episode: number
  airingAt: number
  name?: string
}

export interface TvEpisodeSummary {
  pending: PendingAiredSummary | null
  next: NextAiringSummary | null
}
interface DatedEpisode {
  season: number
  episode: number
  ms: number
  name?: string
}

const RELEASE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const byEpisode = (a: DatedEpisode, b: DatedEpisode) => a.season - b.season || a.episode - b.episode

export function summarizeTvEpisodes(
  maze: TvMazeData,
  progress: SeenEpisode[],
  nowMs: number
): TvEpisodeSummary {
  const tz = showTimezone(maze.show)
  const seen = new Set(
    progress
      .filter((p) => Number(p.completed) === 1 || Number(p.currentTime) > 0)
      .map((p) => `${p.season}:${p.episode}`)
  )

  const episodes: DatedEpisode[] = []
  for (const ep of maze.episodes) {
    if (typeof ep.season !== 'number' || ep.season < 1) continue
    if (typeof ep.number !== 'number' || ep.number < 1) continue
    if (seen.has(`${ep.season}:${ep.number}`)) continue
    const ms = airTimestampMs(ep, tz)
    if (ms == null) continue
    episodes.push({ season: ep.season, episode: ep.number, ms, name: ep.name ?? undefined })
  }

  const aired = episodes
    .filter((e) => e.ms <= nowMs && e.ms >= nowMs - RELEASE_WINDOW_MS)
    .sort(byEpisode)
  const upcoming = episodes.filter((e) => e.ms > nowMs).sort((a, b) => a.ms - b.ms)

  let pending: PendingAiredSummary | null = null
  if (aired.length > 0) {
    const first = aired[0]
    const last = aired[aired.length - 1]
    pending = {
      season: first.season,
      episode: first.episode,
      latestSeason: last.season,
      latestEpisode: last.episode,
      pendingCount: aired.length,
      latestAiredMs: Math.max(...aired.map((e) => e.ms)),
    }
  }

  const nextEp = upcoming[0]
  const next = nextEp
    ? {
        season: nextEp.season,
        episode: nextEp.episode,
        airingAt: Math.floor(nextEp.ms / 1000),
        name: nextEp.name,
      }
    : null

  return { pending, next }
}
