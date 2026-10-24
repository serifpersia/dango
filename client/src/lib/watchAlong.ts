import { WATCH_ROOM_ID, WATCH_TOKEN } from '../../../server/src/lib/watch-along'
import type { WatchSelection } from '../../../server/src/lib/watch-along'
import { tvWatchPath } from './tv'

export type { WatchSelection, WatchPlayback, WatchRoom } from '../../../server/src/lib/watch-along'
export {
  parseWatchPlayback,
  sameWatchSelection,
  watchPosition,
} from '../../../server/src/lib/watch-along'

export interface WatchSession {
  id: string
  token: string
  guestToken: string
  host: boolean
}

const SESSION_KEY = 'dango-watch-along'
const HOST_KEY = 'dango-watch-along-host'

function decodeWatchSession(value: unknown): WatchSession | null {
  if (!value || typeof value !== 'object') return null
  const saved = value as Record<string, unknown>
  if (
    typeof saved.id !== 'string' ||
    typeof saved.token !== 'string' ||
    typeof saved.guestToken !== 'string'
  )
    return null
  const guest = parseWatchInvite(`${saved.id}.${saved.guestToken}`, '')
  const auth = parseWatchInvite(`${saved.id}.${saved.token}`, '')
  return { ...guest, token: auth.token, host: saved.host === true }
}

export function readWatchSession(): WatchSession | null {
  try {
    return (
      decodeWatchSession(JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')) ??
      decodeWatchSession(JSON.parse(localStorage.getItem(HOST_KEY) || 'null'))
    )
  } catch {
    return null
  }
}

export function rememberWatchSession(session: WatchSession | null) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else sessionStorage.removeItem(SESSION_KEY)
    if (session?.host) localStorage.setItem(HOST_KEY, JSON.stringify(session))
  } catch {
    // ignore
  }
}

export function forgetWatchHost() {
  try {
    localStorage.removeItem(HOST_KEY)
  } catch {
    // ignore
  }
}

export function watchAlongPath(selection: WatchSelection): string {
  return selection.kind === 'tv' || selection.kind === 'movie'
    ? tvWatchPath(
        selection.kind,
        selection.showId,
        selection.kind === 'tv' ? selection.season : undefined,
        selection.kind === 'tv' ? Number(selection.episode) : undefined
      )
    : `/watch/${encodeURIComponent(selection.showId)}/${encodeURIComponent(selection.episode)}`
}

export function parseWatchInvite(input: string, workerUrl: string): WatchSession {
  let code = input.trim().replace(/^#/, '')
  if (code.includes('://')) {
    const url = new URL(code)
    if (
      url.origin !== new URL(workerUrl).origin ||
      !['/join', '/watch-along'].includes(url.pathname)
    )
      throw new Error('Use an invite from this dango watch-along service.')
    code = url.hash.slice(1)
  }
  const [id, token, extra] = code.split('.')
  if (!WATCH_ROOM_ID.test(id || '') || !WATCH_TOKEN.test(token || '') || extra !== undefined)
    throw new Error('Paste a complete watch-along invite link or room code.')
  return { id, token, guestToken: token, host: false }
}
