import { DatabaseWrapper } from '../../db.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'

export interface TrackerSyncStateEntry {
  lastSyncedAt: number
  remoteUpdatedAt: number
}

export type TrackerSyncState = Record<string, TrackerSyncStateEntry>

export async function readTrackerSyncState(
  db: DatabaseWrapper,
  key: string
): Promise<TrackerSyncState> {
  const row = await SettingsRepository.getByKey(db, key)
  if (!row?.value) return {}
  try {
    return JSON.parse(row.value) as TrackerSyncState
  } catch {
    return {}
  }
}

export function resolveStatus(
  localStatus: string,
  remoteStatus: string,
  remoteUpdated: number,
  localLastSync: number
): { status: string; pull: boolean } {
  if (remoteUpdated > localLastSync && remoteStatus !== localStatus) {
    return { status: remoteStatus, pull: true }
  }
  if (remoteStatus !== localStatus) {
    return { status: localStatus, pull: false }
  }
  return { status: localStatus, pull: false }
}
