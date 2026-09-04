import logger from './logger'
import { DatabaseWrapper } from './db'
import { dbAll } from './utils/db-utils'
import { updateEnvFile } from './utils/env.utils'
import { CONFIG } from './config'

const log = logger.child({ module: 'GitHubSync' })

const REPO_NAME = 'dango-sync-data'
const LEGACY_REPO_NAME = 'aniweb-sync-data'
const GITHUB_SCOPES = ['repo', 'delete_repo']
const GITHUB_API_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2026-03-10',
}

const SYNC_TABLES = [
  'watchlist',
  'watched_episodes',
  'queue',
  'settings',
  'shows_meta',
  'sync_metadata',
  'dismissed_notifications',
  'discovered_notifications',
] as const

const nativeImport = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string
) => Promise<T>

type SyncTable = (typeof SYNC_TABLES)[number]
type Row = Record<string, string | number | null>
type SyncPayload = {
  version: number
  exportedAt: string
  tables: Record<SyncTable, Row[]>
}

type DeviceVerification = {
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

type DeviceFlowState = {
  status: 'idle' | 'pending' | 'success' | 'error'
  verification?: DeviceVerification
  error?: string
  user?: { login: string; name?: string | null; avatarUrl?: string | null }
}

type OctokitInstance = {
  rest: {
    users: {
      getAuthenticated: (params?: { headers?: typeof GITHUB_API_HEADERS }) => Promise<{
        data: { login: string; name?: string | null; avatar_url?: string | null }
      }>
    }
    repos: {
      get: (params: {
        owner: string
        repo: string
        headers?: typeof GITHUB_API_HEADERS
      }) => Promise<unknown>
      createForAuthenticatedUser: (params: {
        name: string
        private: boolean
        auto_init: boolean
        description: string
        headers?: typeof GITHUB_API_HEADERS
      }) => Promise<unknown>
      update: (params: {
        owner: string
        repo: string
        name?: string
        description?: string
        headers?: typeof GITHUB_API_HEADERS
      }) => Promise<unknown>
      delete: (params: {
        owner: string
        repo: string
        headers?: typeof GITHUB_API_HEADERS
      }) => Promise<unknown>
      createOrUpdateFileContents: (params: {
        owner: string
        repo: string
        path: string
        message: string
        content: string
        sha?: string
        headers?: typeof GITHUB_API_HEADERS
      }) => Promise<unknown>
      getContent: (params: {
        owner: string
        repo: string
        path: string
        headers?: typeof GITHUB_API_HEADERS
      }) => Promise<{ data: unknown }>
    }
  }
}

function getGitHubClientId() {
  const id = process.env.GITHUB_CLIENT_ID || ''
  if (!id) {
    throw new Error('GITHUB_CLIENT_ID is not configured')
  }
  return id
}

function getSyncFilename() {
  return CONFIG.IS_DEV ? 'sync.dev.json' : 'sync.json'
}

async function loadOctokit(token: string): Promise<OctokitInstance> {
  const { Octokit } = await nativeImport<typeof import('@octokit/rest')>('@octokit/rest')
  return new Octokit({
    auth: token,
    request: {
      headers: GITHUB_API_HEADERS,
    },
  }) as OctokitInstance
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error && 'status' in error) {
    return Number((error as { status: unknown }).status)
  }
  return undefined
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}

function getRowsFromAll<T = unknown>(db: DatabaseWrapper, sql: string): T[] {
  return dbAll<T>(db, sql)
}

function readVersion(payload: SyncPayload): number {
  const versionRow = payload.tables.sync_metadata.find((row) => row.key === 'db_version')
  const value = versionRow?.value
  return typeof value === 'number' ? value : Number(value || payload.version || 0)
}

function normalizePayload(input: unknown): SyncPayload {
  if (!input || typeof input !== 'object' || !('tables' in input)) {
    throw new Error('Invalid GitHub sync payload.')
  }

  const payload = input as SyncPayload
  for (const table of SYNC_TABLES) {
    if (!Array.isArray(payload.tables?.[table])) {
      throw new Error(`Invalid GitHub sync payload: missing ${table}.`)
    }
  }

  return payload
}

class GitHubSyncService {
  private deviceState: DeviceFlowState = { status: 'idle' }
  private devicePromise: Promise<void> | null = null

  isAuthenticated() {
    return !!process.env.GITHUB_TOKEN
  }

  async migrateFromAniWebSync(): Promise<void> {
    if (!this.isAuthenticated()) return

    try {
      const octokit = await this.getOctokit()
      const { data: user } = await octokit.rest.users.getAuthenticated({
        headers: GITHUB_API_HEADERS,
      })

      try {
        await octokit.rest.repos.get({
          owner: user.login,
          repo: LEGACY_REPO_NAME,
          headers: GITHUB_API_HEADERS,
        })
      } catch (err) {
        if (getErrorStatus(err) === 404) {
          log.info('No legacy aniweb-sync-data repo found. Skipping migration.')
          return
        }
        throw err
      }

      log.info('Found legacy aniweb-sync-data repo. Renaming to dango-sync-data...')

      const existingNew = await octokit.rest.repos
        .get({
          owner: user.login,
          repo: REPO_NAME,
          headers: GITHUB_API_HEADERS,
        })
        .catch(() => null)

      if (existingNew) {
        log.info('dango-sync-data repo already exists. Deleting legacy repo.')
        await octokit.rest.repos.delete({
          owner: user.login,
          repo: LEGACY_REPO_NAME,
          headers: GITHUB_API_HEADERS,
        })
        log.info('Deleted legacy aniweb-sync-data repo.')
        return
      }

      await octokit.rest.repos.update({
        owner: user.login,
        repo: LEGACY_REPO_NAME,
        name: REPO_NAME,
        description: 'Private dango synchronization data.',
        headers: GITHUB_API_HEADERS,
      })

      log.info('Renamed aniweb-sync-data to dango-sync-data.')
    } catch (err) {
      log.error({ err }, 'GitHub sync migration failed')
    }
  }

  getDeviceState(): DeviceFlowState {
    return this.deviceState
  }

  async startDeviceAuth(
    db: DatabaseWrapper,
    runSyncSequence: (
      db: DatabaseWrapper,
      provider?: 'github' | 'google' | 'rclone' | 'none'
    ) => Promise<void>
  ): Promise<DeviceFlowState> {
    if (this.isAuthenticated()) {
      const user = await this.getUserProfile()
      if (user) {
        this.deviceState = {
          status: 'success',
          user: user,
        }
        const { updateEnvFile } = await import('./utils/env.utils')
        await updateEnvFile({ SYNC_PROVIDER: 'github' })
        await runSyncSequence(db, 'github')
        return this.deviceState
      } else {
        // Token exists but is invalid/expired, clear it
        log.warn('Saved GitHub token is invalid or expired. Clearing for new auth.')
        await this.logout()
      }
    }

    if (this.deviceState.status === 'pending') {
      return this.deviceState
    }

    this.deviceState = { status: 'pending' }

    let resolveVerification: () => void
    const verificationReady = new Promise<void>((resolve) => {
      resolveVerification = resolve
    })

    this.devicePromise = this.runDeviceAuth(db, runSyncSequence, resolveVerification!)
    await verificationReady

    return this.deviceState
  }

  async getUserProfile() {
    if (!process.env.GITHUB_TOKEN) return null

    try {
      const octokit = await loadOctokit(process.env.GITHUB_TOKEN)
      const { data } = await octokit.rest.users.getAuthenticated({
        headers: GITHUB_API_HEADERS,
      })
      return {
        login: data.login,
        name: data.name,
        avatarUrl: data.avatar_url,
      }
    } catch (err) {
      if (getErrorStatus(err) === 401) {
        log.warn('GitHub token is invalid or expired. Logging out.')
        await this.logout()
      }
      return null
    }
  }

  async logout() {
    await updateEnvFile({ GITHUB_TOKEN: '' })
    delete process.env.GITHUB_TOKEN
    this.deviceState = { status: 'idle' }
  }

  async getRemoteVersion(): Promise<number> {
    const payload = await this.fetchSyncPayload()
    return payload ? readVersion(payload) : 0
  }

  async syncUp(db: DatabaseWrapper): Promise<void> {
    const payload = await this.exportDatabase(db)
    const octokit = await this.getOctokit()
    const owner = await this.ensureRepo(octokit)
    const existing = await this.getSyncFile(octokit, owner)
    const content = Buffer.from(JSON.stringify(payload, null, 2), 'utf8').toString('base64')

    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo: REPO_NAME,
      path: getSyncFilename(),
      message: `Sync dango data v${payload.version}`,
      content,
      sha: existing?.sha,
      headers: GITHUB_API_HEADERS,
    })
  }

  async syncDown(db: DatabaseWrapper): Promise<number> {
    const payload = await this.fetchSyncPayload()
    if (!payload) {
      return 0
    }

    this.importDatabase(db, payload)
    return readVersion(payload)
  }

  private async runDeviceAuth(
    db: DatabaseWrapper,
    runSyncSequence: (
      db: DatabaseWrapper,
      provider?: 'github' | 'google' | 'rclone' | 'none'
    ) => Promise<void>,
    resolveVerification: () => void
  ) {
    try {
      const { createOAuthDeviceAuth } = await nativeImport<
        typeof import('@octokit/auth-oauth-device')
      >('@octokit/auth-oauth-device')
      const auth = createOAuthDeviceAuth({
        clientId: getGitHubClientId(),
        scopes: GITHUB_SCOPES,
        onVerification: (verification) => {
          this.deviceState = {
            status: 'pending',
            verification: {
              user_code: verification.user_code,
              verification_uri: verification.verification_uri,
              expires_in: verification.expires_in,
              interval: verification.interval,
            },
          }
          resolveVerification()
        },
      })

      const authentication = await auth({ type: 'oauth' })
      await updateEnvFile({ GITHUB_TOKEN: authentication.token, SYNC_PROVIDER: 'github' })
      process.env.GITHUB_TOKEN = authentication.token

      const user = await this.getUserProfile()
      this.deviceState = {
        status: 'success',
        user: user || undefined,
      }

      try {
        await runSyncSequence(db, 'github')
      } catch (err) {
        log.error({ err }, 'Post-GitHub-login sync failed')
      }
    } catch (err) {
      this.deviceState = {
        status: 'error',
        error: err instanceof Error ? err.message : 'GitHub device authentication failed.',
      }
      resolveVerification()
      log.error({ err }, 'GitHub device authentication failed')
    } finally {
      this.devicePromise = null
    }
  }

  private async getOctokit(): Promise<OctokitInstance> {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error('GitHub token is not configured.')
    }

    return loadOctokit(process.env.GITHUB_TOKEN)
  }

  private async ensureRepo(octokit: OctokitInstance): Promise<string> {
    const { data: user } = await octokit.rest.users.getAuthenticated({
      headers: GITHUB_API_HEADERS,
    })

    try {
      await octokit.rest.repos.get({
        owner: user.login,
        repo: REPO_NAME,
        headers: GITHUB_API_HEADERS,
      })
    } catch (err) {
      if (getErrorStatus(err) !== 404) {
        throw err
      }

      await octokit.rest.repos.createForAuthenticatedUser({
        name: REPO_NAME,
        private: true,
        auto_init: true,
        description: 'Private dango synchronization data.',
        headers: GITHUB_API_HEADERS,
      })
    }

    return user.login
  }

  private async getSyncFile(
    octokit: OctokitInstance,
    owner: string
  ): Promise<{ content: string; sha: string } | null> {
    try {
      const response = await octokit.rest.repos.getContent({
        owner,
        repo: REPO_NAME,
        path: getSyncFilename(),
        headers: GITHUB_API_HEADERS,
      })

      const data = response.data as { content?: string; sha?: string; type?: string }
      if (data.type !== 'file' || !data.content || !data.sha) {
        return null
      }

      return {
        content: Buffer.from(data.content, 'base64').toString('utf8'),
        sha: data.sha,
      }
    } catch (err) {
      if (getErrorStatus(err) === 404) {
        return null
      }
      throw err
    }
  }

  private async fetchSyncPayload(): Promise<SyncPayload | null> {
    const octokit = await this.getOctokit()
    const owner = await this.ensureRepo(octokit)
    const file = await this.getSyncFile(octokit, owner)

    if (!file) {
      return null
    }

    return normalizePayload(JSON.parse(file.content))
  }

  private async exportDatabase(db: DatabaseWrapper): Promise<SyncPayload> {
    const tables = {} as Record<SyncTable, Row[]>

    for (const table of SYNC_TABLES) {
      tables[table] = await getRowsFromAll<Row>(db, `SELECT * FROM ${quoteIdentifier(table)}`)
    }

    return {
      version: readVersion({ version: 0, exportedAt: '', tables }),
      exportedAt: new Date().toISOString(),
      tables,
    }
  }

  private importDatabase(db: DatabaseWrapper, payload: SyncPayload) {
    db.serialize(() => {
      for (const table of SYNC_TABLES) {
        db.run(`DELETE FROM ${quoteIdentifier(table)}`)
      }

      for (const table of SYNC_TABLES) {
        for (const row of payload.tables[table]) {
          const columns = Object.keys(row)
          if (columns.length === 0) continue

          const columnSql = columns.map(quoteIdentifier).join(', ')
          const placeholders = columns.map(() => '?').join(', ')
          const values = columns.map((column) => row[column])
          db.run(
            `INSERT INTO ${quoteIdentifier(table)} (${columnSql}) VALUES (${placeholders})`,
            values
          )
        }
      }
    })
  }
}

export const githubSyncService = new GitHubSyncService()
