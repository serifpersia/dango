import { getActiveProfileId, profileStorage } from './profileStorage'

export interface ProviderCreds {
  cookie: string
  ua: string
}

const IDS_KEY = 'auth:provider-ids'

function readIds(): string[] {
  try {
    const raw = profileStorage.getItem(IDS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []
  } catch {
    return []
  }
}

function writeIds(ids: string[]): void {
  profileStorage.setItem(IDS_KEY, JSON.stringify([...new Set(ids)]))
}

export function getProviderCreds(id: string): ProviderCreds {
  migrateLegacyProviderAuth()
  return {
    cookie: profileStorage.getItem(`auth:${id}:cookie`) ?? '',
    ua: profileStorage.getItem(`auth:${id}:ua`) ?? '',
  }
}

export function setProviderCreds(id: string, creds: Partial<ProviderCreds>): void {
  if (creds.cookie !== undefined) profileStorage.setItem(`auth:${id}:cookie`, creds.cookie)
  if (creds.ua !== undefined) profileStorage.setItem(`auth:${id}:ua`, creds.ua)
  const ids = readIds()
  if (!ids.includes(id)) writeIds([...ids, id])
}

export function clearProviderCreds(id: string): void {
  profileStorage.removeItem(`auth:${id}:cookie`)
  profileStorage.removeItem(`auth:${id}:ua`)
  writeIds(readIds().filter((entry) => entry !== id))
}

export function listAuthProviderIds(): string[] {
  migrateLegacyProviderAuth()
  return readIds()
}

let migratedProfile: string | null = null

export function migrateLegacyProviderAuth(): void {
  const profile = getActiveProfileId()
  if (migratedProfile === profile) return
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.key !== 'function') return
    migratedProfile = profile
    const prefix = profile === 'default' ? '' : `dango:profile:${profile}:`
    const ids = new Set(readIds())
    const legacyKeys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) legacyKeys.push(key)
    }
    for (const key of legacyKeys) {
      const match = /^([a-z0-9][a-z0-9-]*)_(cookie|ua)$/i.exec(key.slice(prefix.length))
      if (!match) continue
      const [, id, part] = match
      const value = localStorage.getItem(key)
      if (value !== null) profileStorage.setItem(`auth:${id}:${part}`, value)
      localStorage.removeItem(key)
      ids.add(id)
    }
    writeIds([...ids])
  } catch {
    // ignore storage access failures
  }
}

migrateLegacyProviderAuth()
