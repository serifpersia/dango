import { AsyncLocalStorage } from 'node:async_hooks'
import type { DatabaseWrapper } from './db.js'

export type ProfileDbs = {
  db: DatabaseWrapper
  mangaDb: DatabaseWrapper
  tvDb: DatabaseWrapper
  asmrDb: DatabaseWrapper
}

export type ProfileScope = {
  id: string
  root: string
  env: Record<string, string | undefined>
  dbs?: ProfileDbs
  owner?: boolean
  deleted?: boolean
  beginOAuth?: () => string
  claimCloud?: (provider: string, account: string | null) => void
  setCloudAvatar?: (image: string | null) => void
}

export const profileScope = new AsyncLocalStorage<ProfileScope>()

export function profileService<T>(create: () => T): () => T {
  const instances = new Map<string, T>()
  return () => {
    const id = profileScope.getStore()?.id ?? 'default'
    if (!instances.has(id)) instances.set(id, create())
    return instances.get(id)!
  }
}

export function profileEnv(key: string): string | undefined {
  const scope = profileScope.getStore()
  if (scope?.deleted) return undefined
  return scope
    ? (scope.env[key] ?? (key === 'GITHUB_CLIENT_ID' ? process.env[key] : undefined))
    : process.env[key]
}
