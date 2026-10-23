import type { DatabaseWrapper } from '../../db.js'
import { withTrackerWrite } from './tracker-activity.js'

export type RemotePushUpdate = {
  mediaId: number
  status: string | undefined
  progress: number
}

export type RemoteDeleteEntry = { showId: string; entryId: number }

export type RemoteSyncClient = {
  batchUpdateMediaEntries: (
    entries: { mediaId: number; status?: string; progress?: number }[]
  ) => Promise<unknown>
  batchDeleteMediaEntries: (entryIds: number[]) => Promise<unknown>
}

export function collectMediaIds(
  localIds: Iterable<number>,
  remoteIds: Iterable<number>,
  syncState: Record<string, unknown>
): Set<number> {
  return new Set<number>([
    ...localIds,
    ...remoteIds,
    ...Object.keys(syncState)
      .map((k) => Number.parseInt(k, 10))
      .filter((n) => Number.isFinite(n)),
  ])
}

export function assertDeleteCap(opts: {
  totalDeletes: number
  localItemCount: number
  fetched: number
  message: string
}): void {
  const deleteCap = Math.max(5, Math.ceil(opts.localItemCount * 0.1))
  if (opts.totalDeletes > deleteCap) {
    throw new Error(opts.message)
  }
}

export async function pushRemoteChanges(
  db: DatabaseWrapper,
  tracker: RemoteSyncClient,
  pushUpdates: RemotePushUpdate[],
  remoteDeleteEntryIds: RemoteDeleteEntry[]
): Promise<void> {
  const batchSize = 10

  await withTrackerWrite(db, 'anilist', async () => {
    for (let i = 0; i < pushUpdates.length; i += batchSize) {
      await tracker.batchUpdateMediaEntries(pushUpdates.slice(i, i + batchSize))
    }

    const deleteBatch = remoteDeleteEntryIds.map((r) => r.entryId)
    for (let i = 0; i < deleteBatch.length; i += batchSize) {
      await tracker.batchDeleteMediaEntries(deleteBatch.slice(i, i + batchSize))
    }
  })
}
