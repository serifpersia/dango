export interface WatchSelection {
  kind?: 'anime' | 'tv' | 'movie'
  season?: number
  showId: string
  episode: string
  provider: string
  mode: 'sub' | 'dub'
  source: string
  title: string
}

export interface WatchPlayback {
  selection: WatchSelection
  position: number
  playing: boolean
  rate: number
}

export interface WatchRoom extends WatchPlayback {
  revision: number
  updatedAt: number
  expiresAt: number
  hostOnline: boolean
  members: { id: string; host: boolean; status: string; name?: string }[]
}

export const WATCH_ROOM_ID = /^[0-9a-f-]{36}$/
export const WATCH_TOKEN = /^[0-9a-f]{64}$/

export function parseWatchName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32)
    throw new Error('Display names must be at most 32 characters.')
  return value.trim().replace(/\s+/g, ' ')
}

export function parseWatchPlayback(value: unknown): WatchPlayback {
  if (!value || typeof value !== 'object') throw new Error('Invalid playback state')
  const v = value as Record<string, unknown>
  const s = v.selection as Record<string, unknown> | undefined
  const kind = s?.kind ?? 'anime'
  if (
    !s ||
    typeof s.showId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,160}$/.test(s.showId) ||
    s.showId.startsWith('dango-mt-') ||
    !['anime', 'tv', 'movie'].includes(String(kind)) ||
    (kind !== 'anime' && !/^\d+$/.test(s.showId)) ||
    (kind === 'tv' &&
      (!Number.isInteger(s.season) || Number(s.season) < 0 || Number(s.season) > 1000)) ||
    typeof s.episode !== 'string' ||
    !/^\d{1,5}(\.\d{1,3})?$/.test(s.episode) ||
    (kind !== 'anime' && (!/^\d+$/.test(s.episode) || Number(s.episode) < 1)) ||
    typeof s.provider !== 'string' ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(s.provider) ||
    !['sub', 'dub'].includes(String(s.mode)) ||
    typeof s.source !== 'string' ||
    (kind === 'anime' && !s.source.trim()) ||
    s.source.length > 200 ||
    typeof s.title !== 'string' ||
    s.title.length > 300 ||
    typeof v.position !== 'number' ||
    !Number.isFinite(v.position) ||
    v.position < 0 ||
    v.position > 86400 ||
    typeof v.playing !== 'boolean' ||
    typeof v.rate !== 'number' ||
    !Number.isFinite(v.rate) ||
    v.rate < 0.25 ||
    v.rate > 4
  )
    throw new Error('Invalid playback state')
  return {
    selection: {
      ...(s.kind ? { kind: kind as WatchSelection['kind'] } : {}),
      ...(kind === 'tv' ? { season: s.season as number } : {}),
      showId: s.showId,
      episode: s.episode,
      provider: s.provider,
      mode: s.mode as 'sub' | 'dub',
      source: s.source,
      title: s.title,
    },
    position: v.position,
    playing: v.playing,
    rate: v.rate,
  }
}

export function sameWatchSelection(a: WatchSelection, b: WatchSelection): boolean {
  return (
    (a.kind ?? 'anime') === (b.kind ?? 'anime') &&
    a.season === b.season &&
    a.showId === b.showId &&
    a.episode === b.episode &&
    a.provider === b.provider &&
    a.mode === b.mode &&
    a.source === b.source
  )
}

export function watchPosition(state: WatchPlayback & { updatedAt: number }, now: number): number {
  return (
    state.position + (state.playing ? (Math.max(0, now - state.updatedAt) / 1000) * state.rate : 0)
  )
}
