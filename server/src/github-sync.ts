import { profileService, profileEnv, profileScope } from './profile-scope.js'
import logger from './logger.js'
import { DatabaseWrapper } from './db.js'
import { updateEnvFile } from './utils/env.utils.js'
import { CONFIG } from './config.js'
import { SHIPPED_DEFAULTS } from './shipped-defaults.js'
import { exportTables, importTables, normalizePayload, readPayloadVersion } from './sync-payload.js'
import type { SyncPayload } from './sync-payload.js'
import {
  SYNC_KINDS,
  withLabel,
  type SyncBackend,
  type SyncBackendOpts,
  type SyncKind,
} from './sync-backend.js'

const log = logger.child({ module: 'GitHubSync' })

const REPO_NAME = 'dango-sync-data'
const LEGACY_REPO_NAME = 'aniweb-sync-data'
const GITHUB_SCOPES = ['repo', 'delete_repo']
const GITHUB_API_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2026-03-10',
}

const SYNC_FILENAMES: Record<SyncKind, string> = {
  anime: 'sync.json',
  manga: 'manga.sync.json',
  tv: 'tv.sync.json',
  asmr: 'asmr.sync.json',
}

const nativeImport = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string
) => Promise<T>

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
  const id = profileEnv('GITHUB_CLIENT_ID') || SHIPPED_DEFAULTS.GITHUB_CLIENT_ID || ''
  if (!id) {
    throw new Error('GITHUB_CLIENT_ID is not configured')
  }
  return id
}

function getSyncFilename(kind: SyncKind): string {
  const base = SYNC_FILENAMES[kind]
  return CONFIG.IS_DEV ? base.replace(/\.json$/, '.dev.json') : base
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

class GitHubSyncService implements SyncBackend {
  readonly name = 'github' as const
  readonly label = 'GitHub'
  private deviceState: DeviceFlowState = { status: 'idle' }

  isAuthenticated() {
    return !!profileEnv('GITHUB_TOKEN')
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
        const { updateEnvFile } = await import('./utils/env.utils.js')
        await updateEnvFile({ SYNC_PROVIDER: 'github' })
        await runSyncSequence(db, 'github')
        return this.deviceState
      } else {
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

    void this.runDeviceAuth(db, runSyncSequence, resolveVerification!)
    await verificationReady

    return this.deviceState
  }

  async getUserProfile() {
    if (!profileEnv('GITHUB_TOKEN')) return null

    try {
      const octokit = await loadOctokit(profileEnv('GITHUB_TOKEN')!)
      const { data } = await octokit.rest.users.getAuthenticated({
        headers: GITHUB_API_HEADERS,
      })
      profileScope.getStore()?.setCloudAvatar?.(data.avatar_url ?? null)
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
    profileScope.getStore()?.setCloudAvatar?.(null)
    profileScope.getStore()?.claimCloud?.('github', null)
    await updateEnvFile({ GITHUB_TOKEN: '' })
    this.deviceState = { status: 'idle' }
  }

  async version(kind: SyncKind, _opts: SyncBackendOpts): Promise<number> {
    const payload = await this.fetchSyncPayload(kind)
    return payload ? readPayloadVersion(payload) : 0
  }

  async up(kind: SyncKind, db: DatabaseWrapper, _opts: SyncBackendOpts): Promise<void> {
    const config = SYNC_KINDS[kind]
    const filename = getSyncFilename(kind)
    const payload = exportTables(db, config.tables)
    const octokit = await this.getOctokit()
    const owner = await this.ensureRepo(octokit)
    const existing = await this.getSyncFile(octokit, owner, filename)
    const content = Buffer.from(JSON.stringify(payload, null, 2), 'utf8').toString('base64')

    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo: REPO_NAME,
      path: filename,
      message: `Sync dango ${withLabel(config.label, 'data')} v${payload.version}`,
      content,
      sha: existing?.sha,
      headers: GITHUB_API_HEADERS,
    })
  }

  async down(kind: SyncKind, db: DatabaseWrapper, _opts: SyncBackendOpts): Promise<number> {
    const config = SYNC_KINDS[kind]
    const payload = await this.fetchSyncPayload(kind)
    if (!payload) {
      return 0
    }

    importTables(db, config.tables, payload, {
      libraryTables: config.libraryTables,
      backupName: config.backupName,
    })
    return readPayloadVersion(payload)
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

      const user = await this.getUserProfile()
      await runSyncSequence(db, 'github')
      this.deviceState = { status: 'success', user: user || undefined }
    } catch (err) {
      this.deviceState = {
        status: 'error',
        error: err instanceof Error ? err.message : 'GitHub device authentication failed.',
      }
      resolveVerification()
      log.error({ err }, 'GitHub device authentication failed')
    }
  }

  private async getOctokit(): Promise<OctokitInstance> {
    if (!profileEnv('GITHUB_TOKEN')) {
      throw new Error('GitHub token is not configured.')
    }

    return loadOctokit(profileEnv('GITHUB_TOKEN')!)
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
    owner: string,
    filePath: string
  ): Promise<{ content: string; sha: string } | null> {
    try {
      const response = await octokit.rest.repos.getContent({
        owner,
        repo: REPO_NAME,
        path: filePath,
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

  private async fetchSyncPayload(kind: SyncKind): Promise<SyncPayload<string> | null> {
    const octokit = await this.getOctokit()
    const owner = await this.ensureRepo(octokit)
    const file = await this.getSyncFile(octokit, owner, getSyncFilename(kind))

    if (!file) {
      return null
    }

    return normalizePayload(
      JSON.parse(file.content),
      SYNC_KINDS[kind].tables,
      `GitHub ${withLabel(SYNC_KINDS[kind].label, 'sync')}`
    )
  }
}

export const getGitHubSyncService = profileService(() => new GitHubSyncService())
