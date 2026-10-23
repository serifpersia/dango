import crypto from 'node:crypto'
import type { DatabaseWrapper } from '../../db.js'
import logger from '../../logger.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import { SHIPPED_DEFAULTS } from '../../shipped-defaults.js'
import { withTrackerLock } from './sync-lock.js'
import { withTrackerWrite } from './tracker-activity.js'

export const MAL_KEYS = {
  clientId: 'tracker_mal_client_id',
  clientSecret: 'tracker_mal_client_secret',
  tokens: 'tracker_mal_tokens',
  user: 'tracker_mal_user',
  pending: 'tracker_mal_oauth_pending',
} as const

export interface MalTokens {
  access_token: string
  refresh_token: string
  expiresAt: number
}
export interface MalListStatus {
  status: string
  num_episodes_watched: number
  is_rewatching?: boolean
  score?: number
  updated_at?: string
}
export interface MalAnime {
  id: number
  title: string
  main_picture?: { medium?: string; large?: string }
  num_episodes?: number
  my_list_status?: MalListStatus
}
export interface MalListEntry {
  node: MalAnime
  list_status: MalListStatus
}

export interface MalMangaListStatus {
  status: string
  num_chapters_read: number
  is_rewatching?: boolean
  score?: number
  updated_at?: string
}
export interface MalManga {
  id: number
  title: string
  main_picture?: { medium?: string; large?: string }
  num_chapters?: number
  num_volumes?: number
  alternative_titles?: { synonyms?: string[]; en?: string; ja?: string }
  my_list_status?: MalMangaListStatus
}
export interface MalMangaListEntry {
  node: MalManga
  list_status: MalMangaListStatus
}

export const MAL_TO_DANGO: Record<string, string> = {
  watching: 'Watching',
  completed: 'Completed',
  on_hold: 'On-Hold',
  dropped: 'Dropped',
  plan_to_watch: 'Planned',
}
const DANGO_TO_MAL: Record<string, string> = Object.fromEntries(
  Object.entries(MAL_TO_DANGO).map(([remote, local]) => [local, remote])
)

export const MAL_MANGA_TO_DANGO: Record<string, string> = {
  reading: 'Reading',
  completed: 'Completed',
  on_hold: 'On-Hold',
  dropped: 'Dropped',
  plan_to_read: 'Planned',
}
const DANGO_TO_MAL_MANGA: Record<string, string> = Object.fromEntries(
  Object.entries(MAL_MANGA_TO_DANGO).map(([remote, local]) => [local, remote])
)

async function setting(db: DatabaseWrapper, key: string): Promise<string> {
  return (await SettingsRepository.getByKey(db, key))?.value || ''
}

export type MalMode = 'worker' | 'local'

export async function credentialSettings(db: DatabaseWrapper) {
  const storedId = await setting(db, MAL_KEYS.clientId)
  const storedSecret = await setting(db, MAL_KEYS.clientSecret)
  const clientId = storedId || process.env.MAL_CLIENT_ID || ''
  const clientSecret = storedSecret || process.env.MAL_CLIENT_SECRET || ''
  const workerUrl = (
    process.env.MAL_AUTH_WORKER_URL ||
    SHIPPED_DEFAULTS.MAL_AUTH_WORKER_URL ||
    ''
  ).replace(/\/+$/, '')
  // A complete custom app wins; otherwise the worker holds Dango's app secret.
  const mode: MalMode = clientId && clientSecret ? 'local' : workerUrl ? 'worker' : 'local'
  return {
    mode,
    workerUrl,
    hasWorker: !!workerUrl,
    clientId: mode === 'local' ? clientId : '',
    clientSecret: mode === 'local' ? clientSecret : '',
    hasSecret: !!clientSecret,
    hasCustomId: !!storedId,
  }
}

async function credentials(db: DatabaseWrapper) {
  const { clientId, clientSecret } = await credentialSettings(db)
  if (!clientId) throw new Error('Enter your MyAnimeList client ID in Trackers first.')
  return { clientId, clientSecret }
}

function parseTokens(data: unknown): MalTokens {
  const tokens = data as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!tokens?.access_token || !tokens.refresh_token || !tokens.expires_in)
    throw new Error('Invalid MyAnimeList token response.')
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  }
}

async function workerRequest<T>(workerUrl: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${workerUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok)
    throw new Error(
      `MyAnimeList authentication failed (${response.status}). ${data.error || 'Check your app configuration or reconnect.'}`
    )
  return data as T
}

async function exchange(db: DatabaseWrapper, fields: Record<string, string>): Promise<MalTokens> {
  const { clientId, clientSecret } = await credentials(db)
  const body = new URLSearchParams({ ...fields, client_id: clientId })
  if (clientSecret) body.set('client_secret', clientSecret)
  const response = await fetch('https://myanimelist.net/v1/oauth2/token', {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok)
    throw new Error(
      `MyAnimeList authentication failed (${response.status}). Check your app configuration or reconnect.`
    )
  return parseTokens(await response.json())
}

export const MAL_CALLBACK_PATH = '/api/tracker/mal/callback'

export async function beginMalLogin(db: DatabaseWrapper, redirectUri: string) {
  const redirect = new URL(redirectUri)
  if (
    !['http:', 'https:'].includes(redirect.protocol) ||
    redirect.username ||
    redirect.password ||
    redirect.pathname !== MAL_CALLBACK_PATH ||
    redirect.search ||
    redirect.hash
  ) {
    throw new Error('Use the server callback URL as the MyAnimeList redirect URI.')
  }
  const { mode, workerUrl, clientId } = await credentialSettings(db)
  // MAL supports PKCE's plain method. A 128-character random verifier meets RFC 7636.
  const verifier = crypto.randomBytes(64).toString('hex')
  const state = `mal:${crypto.randomBytes(32).toString('hex')}`
  await SettingsRepository.upsert(
    db,
    MAL_KEYS.pending,
    JSON.stringify({ state, verifier, redirectUri, expiresAt: Date.now() + 10 * 60 * 1000 })
  )
  if (mode === 'worker') {
    const target = new URL(`${workerUrl}/auth-url`)
    target.search = new URLSearchParams({
      return_to: redirectUri,
      state,
      code_challenge: verifier,
      code_challenge_method: 'plain',
    }).toString()
    const response = await fetch(target, { signal: AbortSignal.timeout(20000) })
    const data = (await response.json().catch(() => ({}))) as { url?: string }
    if (!response.ok || !data.url)
      throw new Error(
        `MyAnimeList login is unavailable (${response.status}). Try again, or use your own app in Trackers.`
      )
    const authorize = new URL(data.url)
    if (authorize.protocol !== 'https:' || authorize.hostname !== 'myanimelist.net')
      throw new Error('MyAnimeList login returned an unexpected URL.')
    return { url: authorize.toString(), state }
  }
  const url = new URL('https://myanimelist.net/v1/oauth2/authorize')
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    state,
    redirect_uri: redirectUri,
    code_challenge: verifier,
    code_challenge_method: 'plain',
  }).toString()
  return { url: url.toString(), state }
}

export function finishMalLogin(db: DatabaseWrapper, code: string, state: string) {
  return withTrackerLock(db, 'mal', () => completeMalLogin(db, code, state))
}

async function completeMalLogin(db: DatabaseWrapper, code: string, state: string) {
  // Consume state before making network requests so a callback cannot be replayed.
  let pending:
    { state: string; verifier: string; redirectUri: string; expiresAt: number } | undefined
  await db.transact(async (tx) => {
    const raw = await setting(tx, MAL_KEYS.pending)
    if (raw) pending = JSON.parse(raw)
    if (!pending || pending.state !== state || pending.expiresAt < Date.now())
      throw new Error('MyAnimeList login expired or has invalid state. Connect again.')
    await SettingsRepository.deleteByKey(tx, MAL_KEYS.pending)
  })
  const { mode, workerUrl } = await credentialSettings(db)
  const tokens =
    mode === 'worker'
      ? parseTokens(
          await workerRequest(workerUrl, '/exchange', {
            code,
            code_verifier: pending!.verifier,
          })
        )
      : await exchange(db, {
          grant_type: 'authorization_code',
          code,
          code_verifier: pending!.verifier,
          redirect_uri: pending!.redirectUri,
        })
  const response = await fetch('https://api.myanimelist.net/v2/users/@me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`Could not read your MyAnimeList profile (${response.status}).`)
  const viewer = (await response.json()) as { id: number; name: string; picture?: string }
  const user = { id: viewer.id, name: viewer.name, avatar: viewer.picture }
  await db.transact(async (tx) => {
    await SettingsRepository.upsert(tx, MAL_KEYS.tokens, JSON.stringify(tokens))
    await SettingsRepository.upsert(tx, MAL_KEYS.user, JSON.stringify(user))
    await SettingsRepository.deleteByKey(tx, 'tracker_mal_sync_state')
  })
  return user
}

const refreshes = new WeakMap<DatabaseWrapper, Promise<MalTokens>>()

export class MalTracker {
  private db: DatabaseWrapper

  constructor(db: DatabaseWrapper) {
    this.db = db
  }

  private async tokens(force = false): Promise<MalTokens> {
    const raw = await setting(this.db, MAL_KEYS.tokens)
    if (!raw) throw new Error('MyAnimeList is not connected. Connect your account in Trackers.')
    const tokens = JSON.parse(raw) as MalTokens
    if (!force && tokens.expiresAt > Date.now() + 60000) return tokens
    const existing = refreshes.get(this.db)
    if (existing) return existing
    const refresh = (async () => {
      const { mode, workerUrl } = await credentialSettings(this.db)
      const updated =
        mode === 'worker'
          ? parseTokens(
              await workerRequest(workerUrl, '/refresh', {
                refresh_token: tokens.refresh_token,
              })
            )
          : await exchange(this.db, {
              grant_type: 'refresh_token',
              refresh_token: tokens.refresh_token,
            })
      // A disconnected account must not be silently reconnected by an in-flight refresh.
      if ((await setting(this.db, MAL_KEYS.tokens)) !== raw)
        throw new Error('MyAnimeList connection changed. Retry sync.')
      await SettingsRepository.upsert(this.db, MAL_KEYS.tokens, JSON.stringify(updated))
      return updated
    })()
    refreshes.set(this.db, refresh)
    try {
      return await refresh
    } finally {
      refreshes.delete(this.db)
    }
  }

  async request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const tokens = await this.tokens()
    const response = await fetch(`https://api.myanimelist.net/v2/${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 401 && attempt === 0) {
      await this.tokens(true)
      return this.request(path, init, attempt + 1)
    }
    if (response.status === 429 && attempt < 3) {
      const waitSeconds = Math.min(Number(response.headers.get('retry-after')) || 60, 60)
      logger.warn({ waitSeconds, path }, '[MyAnimeList] Rate limited, waiting before retry')
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))
      return this.request(path, init, attempt + 1)
    }
    if (!response.ok) {
      logger.warn({ status: response.status, path }, '[MyAnimeList] Request failed')
      throw new Error(
        response.status === 429
          ? 'MyAnimeList rate limit reached. Pending episode updates will retry automatically.'
          : `MyAnimeList request failed (${response.status}). Reconnect if access has expired.`
      )
    }
    return (await response.json()) as T
  }

  getAnime(id: number) {
    return this.request<MalAnime>(`anime/${id}?fields=my_list_status,num_episodes`)
  }

  async fetchList(): Promise<MalListEntry[]> {
    const entries: MalListEntry[] = []
    let offset = 0
    while (true) {
      const page = await this.request<{ data: MalListEntry[]; paging?: { next?: string } }>(
        `users/@me/animelist?fields=list_status,num_episodes&limit=1000&offset=${offset}&nsfw=true`
      )
      entries.push(...page.data)
      if (!page.paging?.next || !page.data.length) break
      // Construct the next URL ourselves; never send bearer tokens to a supplied URL.
      offset += page.data.length
    }
    return entries
  }

  update(id: number, progress: number, status: string, opts: { rewatching?: boolean } = {}) {
    const remoteStatus = DANGO_TO_MAL[status]
    if (!remoteStatus) throw new Error(`Unsupported tracker status: ${status}`)
    const body = new URLSearchParams({
      status: remoteStatus,
      num_watched_episodes: String(progress),
    })
    if (opts.rewatching !== undefined) body.set('is_rewatching', String(opts.rewatching))
    return withTrackerWrite(this.db, 'mal', () =>
      this.request<MalListStatus>(`anime/${id}/my_list_status`, {
        method: 'PUT',
        body,
      })
    )
  }

  deleteAnime(id: number) {
    return withTrackerWrite(this.db, 'mal', () =>
      this.request(`anime/${id}/my_list_status`, { method: 'DELETE' })
    )
  }

  async fetchMangaList(): Promise<MalMangaListEntry[]> {
    const entries: MalMangaListEntry[] = []
    let offset = 0
    while (true) {
      const page = await this.request<{ data: MalMangaListEntry[]; paging?: { next?: string } }>(
        `users/@me/mangalist?fields=list_status,num_chapters&limit=1000&offset=${offset}&nsfw=true`
      )
      entries.push(...page.data)
      if (!page.paging?.next || !page.data.length) break
      offset += page.data.length
    }
    return entries
  }

  searchManga(title: string) {
    return this.request<{ data: { node: MalManga }[] }>(
      `manga?q=${encodeURIComponent(title)}&limit=5&fields=title,alternative_titles`
    ).then((page) => page.data.map((entry) => entry.node))
  }

  updateManga(id: number, progress: number, status: string, opts: { rewatching?: boolean } = {}) {
    const remoteStatus = DANGO_TO_MAL_MANGA[status]
    if (!remoteStatus) throw new Error(`Unsupported tracker status: ${status}`)
    const body = new URLSearchParams({
      status: remoteStatus,
      num_chapters_read: String(progress),
    })
    if (opts.rewatching !== undefined) body.set('is_rewatching', String(opts.rewatching))
    return withTrackerWrite(this.db, 'mal', () =>
      this.request<MalMangaListStatus>(`manga/${id}/my_list_status`, {
        method: 'PUT',
        body,
      })
    )
  }

  deleteManga(id: number) {
    return withTrackerWrite(this.db, 'mal', () =>
      this.request(`manga/${id}/my_list_status`, { method: 'DELETE' })
    )
  }
}
