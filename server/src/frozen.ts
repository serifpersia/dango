import { profileService } from './profile-scope.js'
import { dbGet } from './utils/db-utils.js'
import type { DatabaseWrapper } from './db.js'

export const FROZEN_MODE_KEY = 'frozenMode'

const frozenState = profileService(() => ({ enabled: false }))

export function isFrozen(): boolean {
  return frozenState().enabled
}

export function setFrozen(enabled: boolean): void {
  frozenState().enabled = enabled
}

export async function initFrozen(db: DatabaseWrapper): Promise<void> {
  const row = dbGet<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', [
    FROZEN_MODE_KEY,
  ])
  setFrozen(row?.value === 'true')
}
