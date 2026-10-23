import type { DatabaseWrapper } from '../../db.js'

export type TrackerProvider = 'anilist' | 'mal'
export interface TrackerActivity {
  provider: TrackerProvider
  updating: boolean
}

type Listener = (activity: TrackerActivity) => void
type State = { active: Record<TrackerProvider, number>; listeners: Set<Listener> }
const PROVIDERS: TrackerProvider[] = ['anilist', 'mal']
const activity = new WeakMap<DatabaseWrapper, State>()

function state(db: DatabaseWrapper): State {
  let value = activity.get(db)
  if (!value) {
    value = { active: { anilist: 0, mal: 0 }, listeners: new Set() }
    activity.set(db, value)
  }
  return value
}

function publish(db: DatabaseWrapper, provider: TrackerProvider) {
  const value = state(db)
  for (const listener of value.listeners) {
    // A disconnected observer must never interrupt the tracker request.
    try {
      listener({ provider, updating: value.active[provider] > 0 })
    } catch {
      /* Observer has disconnected. */
    }
  }
}

export function subscribeTrackerActivity(db: DatabaseWrapper, listener: Listener) {
  const value = state(db)
  value.listeners.add(listener)
  for (const provider of PROVIDERS) listener({ provider, updating: value.active[provider] > 0 })
  return () => {
    value.listeners.delete(listener)
  }
}

export async function withTrackerWrite<T>(
  db: DatabaseWrapper,
  provider: TrackerProvider,
  write: () => Promise<T>
): Promise<T> {
  const value = state(db)
  if (value.active[provider]++ === 0) publish(db, provider)
  try {
    return await write()
  } finally {
    if (--value.active[provider] === 0) publish(db, provider)
  }
}
