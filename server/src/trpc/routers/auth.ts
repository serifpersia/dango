import { profileEnv, profileScope } from '../../profile-scope.js'
import logger from '../../logger.js'
import { getGoogleDriveService } from '../../google.js'
import { getGitHubSyncService } from '../../github-sync.js'
import type { DatabaseWrapper } from '../../db.js'
import { initSyncProvider, getActiveProvider, runFullSyncSequence } from '../../sync.js'
import { CONFIG } from '../../config.js'
import { getRcloneService } from '../../rclone.js'
import { updateEnvFile } from '../../utils/env.utils.js'
import { protectedProcedure, ownerProcedure, router } from '../index.js'
import { defineSchema, reqObj } from '../validation.js'
import { badRequest } from '../errors.js'
import { isSafeExternalUrl } from '../../utils/security.utils.js'
import type { TrpcContext } from '../context.js'

type SyncProvider = 'github' | 'google' | 'rclone' | 'none'

async function runSyncFromCtx(
  ctx: TrpcContext,
  database: DatabaseWrapper,
  preferredProvider?: SyncProvider
) {
  const remoteFolder = CONFIG.IS_DEV ? CONFIG.REMOTE_FOLDER_DEV : CONFIG.REMOTE_FOLDER_PROD

  await runFullSyncSequence(
    { db: database, mangaDb: ctx.mangaDb, tvDb: ctx.tvDb, asmrDb: ctx.asmrDb },
    { remoteFolder, preferredProvider }
  )
}

const googleAuthSaveInput = () =>
  defineSchema<
    { clientId?: unknown; clientSecret?: unknown; workerUrl?: unknown },
    { clientId?: unknown; clientSecret?: unknown; workerUrl?: unknown }
  >((value) => {
    const obj = reqObj(value)
    return { clientId: obj.clientId, clientSecret: obj.clientSecret, workerUrl: obj.workerUrl }
  })

const githubAuthSaveInput = () =>
  defineSchema<{ clientId: string }, { clientId: string }>((value) => {
    const obj = reqObj(value)
    if (typeof obj.clientId !== 'string') throw badRequest('clientId required')
    return { clientId: obj.clientId }
  })

const syncProviderInput = () =>
  defineSchema<{ provider?: unknown }, { provider?: unknown }>((value) => ({
    provider: reqObj(value).provider,
  }))

const rcloneSaveInput = () =>
  defineSchema<{ remote?: unknown }, { remote?: unknown }>((value) => ({
    remote: reqObj(value).remote,
  }))

const serverPortInput = () =>
  defineSchema<{ port?: unknown }, { port?: unknown }>((value) => ({
    port: reqObj(value).port,
  }))

export const authRouter = router({
  configStatus: protectedProcedure.query(async () => {
    const useWorker = !!CONFIG.GOOGLE_AUTH_WORKER_URL
    const hasLegacyConfig = !!profileEnv('GOOGLE_CLIENT_ID') && !!profileEnv('GOOGLE_CLIENT_SECRET')
    return { hasConfig: useWorker || hasLegacyConfig, useWorker }
  }),

  googleAuth: protectedProcedure.query(async () => {
    return {
      useWorker: !!CONFIG.GOOGLE_AUTH_WORKER_URL,
      hasCustomWorkerUrl: !!profileEnv('GOOGLE_AUTH_WORKER_URL'),
      hasCustomClientId: !!profileEnv('GOOGLE_CLIENT_ID'),
      hasClientSecret: !!profileEnv('GOOGLE_CLIENT_SECRET'),
    }
  }),

  saveGoogleAuth: protectedProcedure.input(googleAuthSaveInput()).mutation(async ({ input }) => {
    const { clientId, clientSecret, workerUrl } = input
    if (workerUrl && profileScope.getStore()?.owner === false && !isSafeExternalUrl(workerUrl).safe)
      throw badRequest('Use a public HTTP or HTTPS authentication worker URL')

    const updates: Record<string, string> = {}

    if (typeof clientId === 'string') {
      updates.GOOGLE_CLIENT_ID = clientId
    }

    if (typeof clientSecret === 'string') {
      updates.GOOGLE_CLIENT_SECRET = clientSecret
    }

    if (typeof workerUrl === 'string') {
      updates.GOOGLE_AUTH_WORKER_URL = workerUrl
    }

    await updateEnvFile(updates)
    if (typeof workerUrl === 'string') {
      ;(CONFIG as { GOOGLE_AUTH_WORKER_URL: string }).GOOGLE_AUTH_WORKER_URL = workerUrl
    }
    if (typeof clientId === 'string') {
      ;(CONFIG as { GOOGLE_CLIENT_ID?: string }).GOOGLE_CLIENT_ID = clientId || undefined
    }
    if (typeof clientSecret === 'string') {
      ;(CONFIG as { GOOGLE_CLIENT_SECRET?: string }).GOOGLE_CLIENT_SECRET =
        clientSecret || undefined
    }
    await initSyncProvider()
    return { success: true }
  }),

  saveGithubAuth: protectedProcedure.input(githubAuthSaveInput()).mutation(async ({ input }) => {
    await updateEnvFile({ GITHUB_CLIENT_ID: input.clientId })
    return { success: true }
  }),

  rcloneSettings: ownerProcedure.query(async () => {
    const remotes = await getRcloneService().listRemotes()
    return {
      remote: CONFIG.RCLONE_REMOTE || '',
      availableRemotes: remotes,
      activeRemote: getRcloneService().isActive() ? getRcloneService().getRemoteName() : null,
    }
  }),

  syncSettings: protectedProcedure.query(async () => {
    return {
      activeProvider: profileEnv('SYNC_PROVIDER') || 'default',
      actualActiveProvider: getActiveProvider(),
      authenticatedProviders: {
        github: getGitHubSyncService().isAuthenticated(),
        google: getGoogleDriveService().isAuthenticated(),
        rclone: getRcloneService().isActive(),
      },
    }
  }),

  saveSyncProvider: protectedProcedure.input(syncProviderInput()).mutation(async ({ input }) => {
    const { provider } = input
    if (!['default', 'none', 'github', 'google', 'rclone'].includes(String(provider)))
      throw badRequest('Invalid sync provider')

    const value = provider === 'default' ? '' : (provider as string)
    await updateEnvFile({ SYNC_PROVIDER: value })
    await initSyncProvider()
    return { success: true, activeProvider: profileEnv('SYNC_PROVIDER') || 'default' }
  }),

  githubStatus: protectedProcedure.query(async () => {
    try {
      const user = await getGitHubSyncService().getUserProfile()
      return {
        authenticated: !!user,
        user,
        device: getGitHubSyncService().getDeviceState(),
        hasCustomClientId: !!profileEnv('GITHUB_CLIENT_ID'),
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch GitHub auth status')
      return {
        authenticated: false,
        user: null,
        device: getGitHubSyncService().getDeviceState(),
        hasCustomClientId: !!profileEnv('GITHUB_CLIENT_ID'),
      }
    }
  }),

  githubStart: protectedProcedure.mutation(async ({ ctx }) => {
    const state = await getGitHubSyncService().startDeviceAuth(ctx.db, (db, provider) =>
      runSyncFromCtx(ctx, db, provider)
    )
    return state
  }),

  githubPoll: protectedProcedure.query(async () => {
    return getGitHubSyncService().getDeviceState()
  }),

  githubLogout: protectedProcedure.mutation(async () => {
    await getGitHubSyncService().logout()
    await updateEnvFile({ SYNC_PROVIDER: '' })
    await initSyncProvider()
    return { success: true }
  }),

  saveRclone: ownerProcedure.input(rcloneSaveInput()).mutation(async ({ ctx, input }) => {
    const { remote } = input

    await updateEnvFile({
      RCLONE_REMOTE: remote as string,
      SYNC_PROVIDER: 'rclone',
    })
    await runSyncFromCtx(ctx, ctx.db, 'rclone')
    return { success: true }
  }),

  setServerPort: ownerProcedure.input(serverPortInput()).mutation(async ({ input }) => {
    const port = Number(input.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw badRequest('Port must be an integer between 1 and 65535')
    }
    await updateEnvFile({ PORT: String(port) })
    logger.info({ port }, 'Server port saved. Restart required to apply.')
    return { success: true, port }
  }),

  googleLogin: protectedProcedure.mutation(async ({ ctx }) => {
    if (getGoogleDriveService().isAuthenticated()) {
      const user = await getGoogleDriveService().getUserProfile()
      if (user) {
        await updateEnvFile({ SYNC_PROVIDER: 'google' })
        await runSyncFromCtx(ctx, ctx.db, 'google')
        return { url: null, authenticated: true }
      } else {
        logger.warn('Google tokens found but invalid. Clearing and requesting new auth.')
        await getGoogleDriveService().logout()
      }
    }
    const url = new URL(await getGoogleDriveService().getAuthUrl())
    const state = profileScope.getStore()?.beginOAuth?.()
    if (state) url.searchParams.set('state', state)
    return { url: url.toString(), authenticated: false }
  }),

  user: protectedProcedure.query(async () => {
    const user = await getGoogleDriveService().getUserProfile()
    return user
  }),

  logout: protectedProcedure.mutation(async () => {
    await getGoogleDriveService().logout()
    await updateEnvFile({ SYNC_PROVIDER: '' })
    await initSyncProvider()
    return { success: true }
  }),
})
