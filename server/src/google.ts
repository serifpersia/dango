import { profileService, profileScope } from './profile-scope.js'
import fs from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import logger from './logger.js'
import { CONFIG } from './config.js'
import { DatabaseWrapper } from './db.js'
import { fetchWithRetry, HttpError, decodeMaybeGzip, parseJsonBody } from './utils/http.utils.js'
import { exportTables, importTables, normalizePayload, readPayloadVersion } from './sync-payload.js'
import {
  SYNC_KINDS,
  type SyncBackend,
  type SyncBackendOpts,
  type SyncKind,
} from './sync-backend.js'

type GoogleTokenSet = {
  access_token?: string
  refresh_token?: string
  scope?: string
  token_type?: string
  expiry_date?: number
  expires_in?: number
}

type GoogleDriveFile = {
  id: string
  name: string
}

const GOOGLE_REQUEST_TIMEOUT_MS = 120000

interface GoogleRequestConfig {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  url: string
  params?: Record<string, string | number | boolean | undefined>
  data?: unknown
  headers?: Record<string, string>
  responseType?: 'json' | 'text' | 'stream'
}

interface GoogleRequestResult<T> {
  data: T
  status: number
  headers: Headers
}

export class GoogleDriveService implements SyncBackend {
  readonly name = 'google' as const
  readonly label = 'Google'
  private tokens: GoogleTokenSet = {}
  private folderIdCache: Map<string, string> = new Map()

  constructor() {
    if (!CONFIG.GOOGLE_AUTH_WORKER_URL && !CONFIG.GOOGLE_CLIENT_ID) {
      logger.error('GOOGLE_AUTH_WORKER_URL is missing and no GOOGLE_CLIENT_ID fallback!')
    }
    this.loadTokens()
  }

  private useWorker(): boolean {
    return !!CONFIG.GOOGLE_AUTH_WORKER_URL
  }

  private loadTokens() {
    if (fs.existsSync(CONFIG.TOKEN_PATH)) {
      try {
        this.tokens = JSON.parse(fs.readFileSync(CONFIG.TOKEN_PATH, 'utf-8'))
      } catch (error) {
        logger.error({ err: error }, 'Failed to load Google tokens')
      }
    }
  }

  private saveTokens(tokens: GoogleTokenSet) {
    if (profileScope.getStore()?.deleted) return
    const merged = { ...this.tokens, ...tokens }
    if (merged.expires_in && !merged.expiry_date) {
      merged.expiry_date = Date.now() + merged.expires_in * 1000
    }
    this.tokens = merged

    try {
      fs.writeFileSync(CONFIG.TOKEN_PATH, JSON.stringify(this.tokens))
    } catch (error) {
      logger.error({ err: error }, 'Failed to save refreshed tokens')
    }
  }

  private getGoogleClientConfig() {
    return {
      clientId: CONFIG.GOOGLE_CLIENT_ID || '',
      clientSecret: CONFIG.GOOGLE_CLIENT_SECRET || '',
    }
  }

  private async postJson<T>(url: string, payload: unknown): Promise<T> {
    if (profileScope.getStore()?.deleted) throw new Error('Profile has been deleted')
    const response = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      { timeoutMs: GOOGLE_REQUEST_TIMEOUT_MS }
    )
    if (!response.ok) throw new HttpError(response.status)
    return parseJsonBody<T>(response)
  }

  private async postForm<T>(url: string, params: URLSearchParams): Promise<T> {
    if (profileScope.getStore()?.deleted) throw new Error('Profile has been deleted')
    const response = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      },
      { timeoutMs: GOOGLE_REQUEST_TIMEOUT_MS }
    )
    if (!response.ok) throw new HttpError(response.status)
    return parseJsonBody<T>(response)
  }

  private async refreshViaWorker(): Promise<boolean> {
    if (!this.tokens.refresh_token) return false
    try {
      const data = await this.postJson<GoogleTokenSet>(`${CONFIG.GOOGLE_AUTH_WORKER_URL}/refresh`, {
        refresh_token: this.tokens.refresh_token,
      })
      this.saveTokens(data)
      return true
    } catch (error) {
      if (error instanceof HttpError && (error.status === 400 || error.status === 401)) {
        logger.warn('Worker refresh failed. Token may be revoked. Logging out.')
        await this.logout()
      }
      throw error
    }
  }

  private async refreshAccessToken() {
    if (!this.tokens.refresh_token) {
      throw new Error('Missing refresh token')
    }

    if (this.useWorker()) {
      await this.refreshViaWorker()
      return
    }

    const { clientId, clientSecret } = this.getGoogleClientConfig()
    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth credentials are not configured')
    }
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: this.tokens.refresh_token,
      grant_type: 'refresh_token',
    })

    try {
      const data = await this.postForm<GoogleTokenSet>(
        'https://oauth2.googleapis.com/token',
        params
      )

      this.saveTokens(data)
    } catch (error) {
      if (error instanceof HttpError && (error.status === 400 || error.status === 401)) {
        logger.warn('Failed to refresh Google access token. Token may be revoked. Logging out.')
        await this.logout()
      }
      throw error
    }
  }

  private async ensureAccessToken() {
    const expiresSoon = !this.tokens.expiry_date || Date.now() >= this.tokens.expiry_date - 60_000
    if (!this.tokens.access_token || expiresSoon) {
      await this.refreshAccessToken()
    }
  }

  private withParams(url: string, params?: GoogleRequestConfig['params']): string {
    if (!params) return url
    const parsed = new URL(url)
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue
      parsed.searchParams.set(key, String(value))
    }
    return parsed.toString()
  }

  private serializeBody(data: unknown): { body?: BodyInit; duplex?: 'half' } {
    if (data === undefined || data === null) return {}
    if (typeof data === 'string') return { body: data }
    if (data instanceof Uint8Array || data instanceof Readable) {
      return { body: data as unknown as BodyInit, duplex: 'half' }
    }
    return { body: JSON.stringify(data) }
  }

  private async googleRequest<T>(config: GoogleRequestConfig): Promise<GoogleRequestResult<T>> {
    if (profileScope.getStore()?.deleted) throw new Error('Profile has been deleted')
    await this.ensureAccessToken()

    try {
      const { body, duplex } = this.serializeBody(config.data)
      const response = await fetchWithRetry(
        this.withParams(config.url, config.params),
        {
          method: config.method,
          headers: {
            Authorization: `Bearer ${this.tokens.access_token}`,
            ...(config.headers ?? {}),
          },
          ...(body !== undefined ? { body } : {}),
          ...(duplex ? { duplex } : {}),
        },
        { timeoutMs: GOOGLE_REQUEST_TIMEOUT_MS }
      )
      if (!response.ok) {
        try {
          await response.body?.cancel()
        } catch {
          // ignore
        }
        throw new HttpError(response.status)
      }
      if (config.responseType === 'stream') {
        if (!response.body) throw new HttpError(response.status, 'Empty upstream body')
        return {
          data: Readable.from(
            response.body as unknown as AsyncIterable<Uint8Array>
          ) as unknown as T,
          status: response.status,
          headers: response.headers,
        }
      }
      if (config.responseType === 'text') {
        return {
          data: (await response.text()) as unknown as T,
          status: response.status,
          headers: response.headers,
        }
      }
      const text = decodeMaybeGzip(Buffer.from(await response.arrayBuffer())).toString('utf8')
      return {
        data: (text ? JSON.parse(text) : undefined) as T,
        status: response.status,
        headers: response.headers,
      }
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        logger.warn('Google API request failed with auth error. Logging out.')
        await this.logout()
      }
      throw error
    }
  }

  public isAuthenticated(): boolean {
    return !!this.tokens.refresh_token
  }

  public async getAuthUrl(): Promise<string> {
    if (this.useWorker()) {
      try {
        const url = new URL(`${CONFIG.GOOGLE_AUTH_WORKER_URL}/auth-url`)
        url.searchParams.set('redirect_uri', CONFIG.GOOGLE_REDIRECT_URI)
        const response = await fetchWithRetry(url, {}, { timeoutMs: GOOGLE_REQUEST_TIMEOUT_MS })
        if (!response.ok) throw new HttpError(response.status)
        const data = await parseJsonBody<{ url?: string }>(response)
        if (data?.url) return data.url
      } catch (error) {
        logger.error({ err: error }, 'Worker /auth-url failed, falling back to local')
      }
    }

    const { clientId } = this.getGoogleClientConfig()
    if (!clientId) throw new Error('Google OAuth credentials are not configured')
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', CONFIG.GOOGLE_REDIRECT_URI)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    url.searchParams.set('scope', CONFIG.GOOGLE_SCOPES.join(' '))
    return url.toString()
  }

  public async handleCallback(code: string) {
    if (this.useWorker()) {
      try {
        const data = await this.postJson<GoogleTokenSet>(
          `${CONFIG.GOOGLE_AUTH_WORKER_URL}/exchange`,
          { code, redirect_uri: CONFIG.GOOGLE_REDIRECT_URI }
        )
        this.saveTokens(data)
        return this.tokens
      } catch (error) {
        logger.error({ err: error }, 'Worker /exchange failed')
        throw error
      }
    }

    const { clientId, clientSecret } = this.getGoogleClientConfig()
    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: CONFIG.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    })

    const data = await this.postForm<GoogleTokenSet>('https://oauth2.googleapis.com/token', params)

    this.saveTokens(data)
    return this.tokens
  }

  public async getUserProfile() {
    if (!this.isAuthenticated()) return null

    try {
      const res = await this.googleRequest<{
        id: string
        name: string
        email?: string
        picture?: string
      }>({
        method: 'GET',
        url: 'https://www.googleapis.com/oauth2/v2/userinfo',
      })
      profileScope.getStore()?.setCloudAvatar?.(res.data.picture ?? null)
      return res.data
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch user profile')
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        logger.warn('Google authentication token is invalid or expired. Logging out.')
        await this.logout()
      }
      return null
    }
  }

  public async logout() {
    profileScope.getStore()?.setCloudAvatar?.(null)
    profileScope.getStore()?.claimCloud?.('google', null)
    if (fs.existsSync(CONFIG.TOKEN_PATH)) {
      fs.unlinkSync(CONFIG.TOKEN_PATH)
    }
    this.tokens = {}
    this.folderIdCache.clear()
  }

  public async ensureFolder(folderName: string): Promise<string> {
    if (!this.isAuthenticated()) throw new Error('Not authenticated')

    const cachedId = this.folderIdCache.get(folderName)
    if (cachedId) return cachedId

    const existing = await this.findFile(
      folderName,
      undefined,
      'application/vnd.google-apps.folder'
    )
    if (existing) {
      this.folderIdCache.set(folderName, existing.id)
      return existing.id
    }

    const fileMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    }

    try {
      const res = await this.googleRequest<{ id: string }>({
        method: 'POST',
        url: 'https://www.googleapis.com/drive/v3/files',
        params: { fields: 'id' },
        data: fileMetadata,
        headers: { 'Content-Type': 'application/json' },
      })
      const id = res.data.id!
      this.folderIdCache.set(folderName, id)
      return id
    } catch (error) {
      logger.error({ err: error }, `Failed to create folder ${folderName}`)
      throw error
    }
  }

  public async listFiles(folderId: string): Promise<GoogleDriveFile[]> {
    if (!this.isAuthenticated()) return []

    try {
      const res = await this.googleRequest<{ files?: GoogleDriveFile[] }>({
        method: 'GET',
        url: 'https://www.googleapis.com/drive/v3/files',
        params: {
          q: `'${folderId}' in parents and trashed = false`,
          fields: 'files(id, name)',
          spaces: 'drive',
        },
      })
      return res.data.files || []
    } catch (error) {
      logger.error({ err: error }, 'Failed to list files in folder')
      return []
    }
  }

  public async deleteFile(fileId: string): Promise<void> {
    if (!this.isAuthenticated()) return

    try {
      await this.googleRequest({
        method: 'DELETE',
        url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      })
    } catch (error) {
      logger.warn({ err: error }, `Failed to delete file ${fileId}`)
    }
  }

  public async findFile(
    filename: string,
    parentId?: string,
    mimeType?: string
  ): Promise<GoogleDriveFile | null> {
    if (!this.isAuthenticated()) return null

    const safeName = filename.replace(/'/g, "\\'")
    let query = `name = '${safeName}' and trashed = false`
    if (parentId) {
      const safeParentId = parentId.replace(/'/g, "\\'")
      query += ` and '${safeParentId}' in parents`
    }
    if (mimeType) {
      const safeMimeType = mimeType.replace(/'/g, "\\'")
      query += ` and mimeType = '${safeMimeType}'`
    }

    try {
      const res = await this.googleRequest<{ files?: GoogleDriveFile[] }>({
        method: 'GET',
        url: 'https://www.googleapis.com/drive/v3/files',
        params: {
          q: query,
          fields: 'files(id, name)',
          spaces: 'drive',
          orderBy: 'createdTime desc',
        },
      })
      if (res.data.files && res.data.files.length > 0) {
        if (res.data.files.length > 1) {
          logger.warn(`Multiple files found for ${filename}, using the most recent one.`)
        }
        return { id: res.data.files[0].id!, name: res.data.files[0].name! }
      }
      return null
    } catch (error) {
      logger.error({ err: error }, `Error while searching for file ${filename}`)
      throw error
    }
  }

  public async downloadFile(fileId: string, destPath: string): Promise<void> {
    if (!this.isAuthenticated()) throw new Error('Not authenticated')

    const dest = fs.createWriteStream(destPath)
    try {
      const res = await this.googleRequest<NodeJS.ReadableStream>({
        method: 'GET',
        url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
        params: { alt: 'media' },
        responseType: 'stream',
      })
      await pipeline(res.data, dest)
    } catch (error) {
      dest.destroy()
      throw error
    }
  }

  public async uploadFile(
    filePath: string,
    filename: string,
    mimeType: string = 'application/octet-stream',
    parentId?: string,
    existingFileId?: string
  ) {
    if (!this.isAuthenticated()) throw new Error('Not authenticated')

    let targetId = existingFileId
    if (!targetId) {
      const existing = await this.findFile(filename, parentId, mimeType)
      if (existing) targetId = existing.id
    }

    const media = {
      mimeType,
      body: fs.createReadStream(filePath),
    }

    try {
      if (targetId) {
        await this.googleRequest({
          method: 'PATCH',
          url: `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(targetId)}`,
          params: { uploadType: 'media' },
          data: media.body,
          headers: { 'Content-Type': media.mimeType },
        })
      } else {
        const resource: { name: string; parents?: string[] } = { name: filename }
        if (parentId) {
          resource.parents = [parentId]
        }
        const created = await this.googleRequest<{ id: string }>({
          method: 'POST',
          url: 'https://www.googleapis.com/drive/v3/files',
          params: { fields: 'id' },
          data: resource,
          headers: { 'Content-Type': 'application/json' },
        })

        await this.googleRequest({
          method: 'PATCH',
          url: `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(created.data.id)}`,
          params: { uploadType: 'media' },
          data: media.body,
          headers: { 'Content-Type': media.mimeType },
        })
      }
    } catch (error) {
      logger.error({ err: error }, `Failed to upload file ${filename}`)
      throw error
    }
  }

  private getSyncFilename(kind: SyncKind): string {
    const names: Record<SyncKind, string | undefined> = {
      anime: (CONFIG as { GOOGLE_SYNC_FILENAME?: string }).GOOGLE_SYNC_FILENAME,
      manga: (CONFIG as { MANGA_GOOGLE_SYNC_FILENAME?: string }).MANGA_GOOGLE_SYNC_FILENAME,
      tv: (CONFIG as { TV_GOOGLE_SYNC_FILENAME?: string }).TV_GOOGLE_SYNC_FILENAME,
      asmr: (CONFIG as { ASMR_GOOGLE_SYNC_FILENAME?: string }).ASMR_GOOGLE_SYNC_FILENAME,
    }
    return names[kind] || `${kind === 'anime' ? '' : `${kind}.`}sync.json`
  }

  private async findFileInAppData(filename: string): Promise<GoogleDriveFile | null> {
    if (!this.isAuthenticated()) return null
    const safeName = filename.replace(/'/g, "\\'")
    try {
      const res = await this.googleRequest<{ files?: GoogleDriveFile[] }>({
        method: 'GET',
        url: 'https://www.googleapis.com/drive/v3/files',
        params: {
          q: `name = '${safeName}' and trashed = false`,
          fields: 'files(id, name)',
          spaces: 'appDataFolder',
          orderBy: 'createdTime desc',
        },
      })
      if (res.data.files && res.data.files.length > 0) {
        return { id: res.data.files[0].id!, name: res.data.files[0].name! }
      }
      return null
    } catch (error) {
      logger.error({ err: error }, `Error searching appDataFolder for ${filename}`)
      throw error
    }
  }

  private async downloadJson(fileId: string): Promise<unknown> {
    const res = await this.googleRequest<string>({
      method: 'GET',
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      params: { alt: 'media' },
      responseType: 'text',
    })
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data
  }

  private async uploadJson(filename: string, payload: unknown, existingId?: string) {
    const content = JSON.stringify(payload, null, 2)
    if (existingId) {
      await this.googleRequest({
        method: 'PATCH',
        url: `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingId)}`,
        params: { uploadType: 'media' },
        data: content,
        headers: { 'Content-Type': 'application/json' },
      })
      return
    }
    const created = await this.googleRequest<{ id: string }>({
      method: 'POST',
      url: 'https://www.googleapis.com/drive/v3/files',
      params: { fields: 'id' },
      data: { name: filename, parents: ['appDataFolder'] },
      headers: { 'Content-Type': 'application/json' },
    })
    await this.googleRequest({
      method: 'PATCH',
      url: `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(created.data.id)}`,
      params: { uploadType: 'media' },
      data: content,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async version(kind: SyncKind, _opts: SyncBackendOpts): Promise<number> {
    if (!this.isAuthenticated()) return 0
    const file = await this.findFileInAppData(this.getSyncFilename(kind))
    if (!file) return 0
    try {
      const payload = (await this.downloadJson(file.id)) as {
        version?: number
        tables?: { sync_metadata?: Array<{ key: string; value: number | string }> }
      }
      const row = payload?.tables?.sync_metadata?.find((r) => r.key === 'db_version')
      const v = row?.value
      return typeof v === 'number' ? v : Number(v || payload?.version || 0)
    } catch {
      return 0
    }
  }

  async up(kind: SyncKind, db: DatabaseWrapper, _opts: SyncBackendOpts): Promise<void> {
    if (!this.isAuthenticated()) return
    const config = SYNC_KINDS[kind]
    const filename = this.getSyncFilename(kind)
    const payload = exportTables(db, config.tables)
    const existing = await this.findFileInAppData(filename)
    await this.uploadJson(filename, payload, existing?.id)
  }

  async down(kind: SyncKind, db: DatabaseWrapper, _opts: SyncBackendOpts): Promise<number> {
    if (!this.isAuthenticated()) return 0
    const config = SYNC_KINDS[kind]
    const file = await this.findFileInAppData(this.getSyncFilename(kind))
    if (!file) return 0
    const raw = await this.downloadJson(file.id)
    const payload = normalizePayload(raw, config.tables, `Google ${config.label || 'anime'}`)
    importTables(db, config.tables, payload, {
      libraryTables: config.libraryTables,
      backupName: config.backupName,
    })
    return readPayloadVersion(payload)
  }
}

export const getGoogleDriveService = profileService(() => new GoogleDriveService())
