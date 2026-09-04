import fs from 'fs'
import path from 'path'
import http from 'http'
import https from 'https'
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'
import { pipeline } from 'stream/promises'
import logger from './logger'
import { CONFIG } from './config'
import { DatabaseWrapper } from './db'
import { dbAll } from './utils/db-utils'

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

const httpAgent = new http.Agent({ keepAlive: false })
const httpsAgent = new https.Agent({ keepAlive: false })
httpsAgent.setMaxListeners(100)
httpAgent.setMaxListeners(100)

const googleAxios = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 30000,
})

export class GoogleDriveService {
  private tokens: GoogleTokenSet = {}
  private folderIdCache: Map<string, string> = new Map()

  constructor() {
    // Client ID/secret now live in Cloudflare Worker (GOOGLE_AUTH_WORKER_URL).
    // Legacy user-owned .env credentials are optional fallback only.
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
    // Legacy fallback only. Preferred path is Worker (no secret in dango).
    return {
      clientId: CONFIG.GOOGLE_CLIENT_ID || '',
      clientSecret: CONFIG.GOOGLE_CLIENT_SECRET || '',
    }
  }

  private async refreshViaWorker(): Promise<boolean> {
    if (!this.tokens.refresh_token) return false
    try {
      const { data } = await googleAxios.post<GoogleTokenSet>(
        `${CONFIG.GOOGLE_AUTH_WORKER_URL}/refresh`,
        { refresh_token: this.tokens.refresh_token },
        { headers: { 'Content-Type': 'application/json' } }
      )
      this.saveTokens(data)
      return true
    } catch (error) {
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 400 || error.response?.status === 401)
      ) {
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

    // Preferred: secret stays in Worker
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
      const { data } = await googleAxios.post<GoogleTokenSet>(
        'https://oauth2.googleapis.com/token',
        params.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      )

      this.saveTokens(data)
    } catch (error) {
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 400 || error.response?.status === 401)
      ) {
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

  private async googleRequest<T>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    await this.ensureAccessToken()

    try {
      return await googleAxios.request<T>({
        ...config,
        headers: {
          Authorization: `Bearer ${this.tokens.access_token}`,
          ...(config.headers ?? {}),
        },
      })
    } catch (error) {
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 401 || error.response?.status === 403)
      ) {
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
    // Preferred: Worker builds URL with bundled client_id, no secret needed here
    if (this.useWorker()) {
      try {
        const { data } = await googleAxios.get<{ url: string }>(
          `${CONFIG.GOOGLE_AUTH_WORKER_URL}/auth-url`,
          { params: { redirect_uri: CONFIG.GOOGLE_REDIRECT_URI } }
        )
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
    // Preferred: Worker exchanges code with secret, dango never sees secret
    if (this.useWorker()) {
      try {
        const { data } = await googleAxios.post<GoogleTokenSet>(
          `${CONFIG.GOOGLE_AUTH_WORKER_URL}/exchange`,
          { code, redirect_uri: CONFIG.GOOGLE_REDIRECT_URI },
          { headers: { 'Content-Type': 'application/json' } }
        )
        this.saveTokens(data)
        return this.tokens
      } catch (error) {
        logger.error({ err: error }, 'Worker /exchange failed')
        throw error
      }
    }

    // Legacy fallback: user-owned client_id/secret in .env
    const { clientId, clientSecret } = this.getGoogleClientConfig()
    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: CONFIG.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    })

    const { data } = await googleAxios.post<GoogleTokenSet>(
      'https://oauth2.googleapis.com/token',
      params.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    )

    this.saveTokens(data)
    return this.tokens
  }

  public async getUserProfile() {
    if (!this.isAuthenticated()) return null

    try {
      const res = await this.googleRequest({
        method: 'GET',
        url: 'https://www.googleapis.com/oauth2/v2/userinfo',
      })
      return res.data
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch user profile')
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 401 || error.response?.status === 403)
      ) {
        logger.warn('Google authentication token is invalid or expired. Logging out.')
        await this.logout()
      }
      return null
    }
  }

  public async logout() {
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

  // ---- New JSON sync (same payload as GitHub, stored in hidden appDataFolder) ----
  private getSyncFilename(): string {
    return (CONFIG as { GOOGLE_SYNC_FILENAME?: string }).GOOGLE_SYNC_FILENAME || 'sync.json'
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

  async getRemoteVersion(): Promise<number> {
    if (!this.isAuthenticated()) return 0
    const file = await this.findFileInAppData(this.getSyncFilename())
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

  async syncUp(db: DatabaseWrapper): Promise<void> {
    if (!this.isAuthenticated()) return
    const payload = await this.exportDatabase(db)
    const existing = await this.findFileInAppData(this.getSyncFilename())
    await this.uploadJson(this.getSyncFilename(), payload, existing?.id)
  }

  async syncDown(db: DatabaseWrapper): Promise<number> {
    if (!this.isAuthenticated()) return 0
    const file = await this.findFileInAppData(this.getSyncFilename())
    if (!file) return 0
    const payload = (await this.downloadJson(file.id)) as {
      version: number
      exportedAt: string
      tables: Record<string, Array<Record<string, string | number | null>>>
    }
    this.importDatabase(db, payload as never)
    const row = (
      payload.tables?.sync_metadata as Array<{ key: string; value: number }> | undefined
    )?.find((r) => r.key === 'db_version')
    return Number(row?.value || payload.version || 0)
  }

  private async exportDatabase(db: DatabaseWrapper) {
    const tables = [
      'watchlist',
      'watched_episodes',
      'queue',
      'settings',
      'shows_meta',
      'sync_metadata',
      'dismissed_notifications',
      'discovered_notifications',
    ] as const
    const out = {} as Record<(typeof tables)[number], unknown[]>
    for (const table of tables) {
      out[table] = dbAll(db, `SELECT * FROM "${table.replace(/"/g, '""')}"`)
    }
    const versionRow = (out.sync_metadata as Array<{ key: string; value: number }>).find(
      (r) => r.key === 'db_version'
    )
    return {
      version: Number(versionRow?.value || 0),
      exportedAt: new Date().toISOString(),
      tables: out,
    }
  }

  private importDatabase(
    db: DatabaseWrapper,
    payload: {
      tables: Record<string, Array<Record<string, string | number | null>>>
    }
  ) {
    const tables = [
      'watchlist',
      'watched_episodes',
      'queue',
      'settings',
      'shows_meta',
      'sync_metadata',
      'dismissed_notifications',
      'discovered_notifications',
    ] as const
    db.serialize(() => {
      for (const table of tables) {
        db.run(`DELETE FROM "${table}"`)
      }
      for (const table of tables) {
        for (const row of payload.tables[table] || []) {
          const columns = Object.keys(row)
          if (columns.length === 0) continue
          const columnSql = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ')
          const placeholders = columns.map(() => '?').join(', ')
          const values = columns.map((c) => row[c])
          db.run(`INSERT INTO "${table}" (${columnSql}) VALUES (${placeholders})`, values)
        }
      }
    })
  }
}

export const googleDriveService = new GoogleDriveService()
