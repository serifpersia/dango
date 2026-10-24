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
