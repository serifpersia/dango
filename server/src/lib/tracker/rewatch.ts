import type { DatabaseWrapper } from '../../db.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'

export type RewatchProvider = 'anilist' | 'mal'
export type RewatchMarkers = Record<RewatchProvider, Set<string>>

const PREFIX = 'tracker_rewatch_'
const PROVIDERS: RewatchProvider[] = ['anilist', 'mal']

export function rewatchKey(provider: RewatchProvider, id: string): string {
  return `${PREFIX}${provider}_${id}`
}

export function isRewatchSetting(key: unknown): boolean {
  return typeof key === 'string' && key.startsWith(PREFIX)
}

export async function readRewatchMarkers(db: DatabaseWrapper): Promise<RewatchMarkers> {
  const markers: RewatchMarkers = { anilist: new Set(), mal: new Set() }
  const rows = await SettingsRepository.getByPrefix(db, PREFIX)
  for (const row of rows) {
    for (const provider of PROVIDERS) {
      const prefix = `${PREFIX}${provider}_`
      if (row.key.startsWith(prefix)) markers[provider].add(row.key.slice(prefix.length))
    }
  }
  return markers
}

export function isRewatching(
  markers: RewatchMarkers,
  provider: RewatchProvider,
  id: string
): boolean {
  return markers[provider].has(id)
}

export async function setRewatching(
  db: DatabaseWrapper,
  provider: RewatchProvider,
  id: string
): Promise<void> {
  await SettingsRepository.upsert(db, rewatchKey(provider, id), '1')
}

export async function clearRewatching(
  db: DatabaseWrapper,
  provider: RewatchProvider,
  id: string
): Promise<void> {
  await SettingsRepository.deleteByKey(db, rewatchKey(provider, id))
}

export async function clearRewatchForShow(db: DatabaseWrapper, id: string): Promise<void> {
  for (const provider of PROVIDERS) await clearRewatching(db, provider, id)
}
