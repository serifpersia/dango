import logger from '../../logger.js'
import { googleDriveService } from '../../google.js'
import { githubSyncService } from '../../github-sync.js'
import type { DatabaseWrapper } from '../../db.js'
import { initSyncProvider, getActiveProvider, runFullSyncSequence } from '../../sync.js'
import { CONFIG } from '../../config.js'
import { rcloneService } from '../../rclone.js'
import { updateEnvFile } from '../../utils/env.utils.js'
import { protectedProcedure, router } from '../index.js'
import { defineSchema, reqObj } from '../validation.js'
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
    if (typeof obj.clientId !== 'string') throw new Error('clientId required')
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

export const authRouter = router({
  configStatus: protectedProcedure.query(async () => {
    const useWorker = !!CONFIG.GOOGLE_AUTH_WORKER_URL
    const hasLegacyConfig = !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET
    return { hasConfig: useWorker || hasLegacyConfig, useWorker }
  }),

  googleAuth: protectedProcedure.query(async () => {
    return {
      useWorker: !!CONFIG.GOOGLE_AUTH_WORKER_URL,
      hasCustomWorkerUrl: !!process.env.GOOGLE_AUTH_WORKER_URL,
      hasCustomClientId: !!process.env.GOOGLE_CLIENT_ID,
      hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    }
  }),

  saveGoogleAuth: protectedProcedure.input(googleAuthSaveInput()).mutation(async ({ input }) => {
    const { clientId, clientSecret, workerUrl } = input

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

  githubAuth: protectedProcedure.query(async () => {
    return { hasCustomClientId: !!process.env.GITHUB_CLIENT_ID }
  }),

  saveGithubAuth: protectedProcedure.input(githubAuthSaveInput()).mutation(async ({ input }) => {
    await updateEnvFile({ GITHUB_CLIENT_ID: input.clientId })
    return { success: true }
  }),

  rcloneSettings: protectedProcedure.query(async () => {
    const remotes = await rcloneService.listRemotes()
    return {
      remote: CONFIG.RCLONE_REMOTE || '',
      availableRemotes: remotes,
      activeRemote: rcloneService.isActive() ? rcloneService.getRemoteName() : null,
    }
  }),

  syncSettings: protectedProcedure.query(async () => {
    return {
      activeProvider: process.env.SYNC_PROVIDER || 'default',
      actualActiveProvider: getActiveProvider(),
      authenticatedProviders: {
        github: githubSyncService.isAuthenticated(),
        google: googleDriveService.isAuthenticated(),
        rclone: rcloneService.isActive(),
      },
    }
  }),

  saveSyncProvider: protectedProcedure.input(syncProviderInput()).mutation(async ({ input }) => {
    const { provider } = input

    const value = provider === 'default' ? '' : (provider as string)
    await updateEnvFile({ SYNC_PROVIDER: value })
    await initSyncProvider()
    return { success: true, activeProvider: process.env.SYNC_PROVIDER || 'default' }
  }),

  githubStatus: protectedProcedure.query(async () => {
    try {
      const user = await githubSyncService.getUserProfile()
      return {
        authenticated: !!user,
        user,
        device: githubSyncService.getDeviceState(),
        hasCustomClientId: !!process.env.GITHUB_CLIENT_ID,
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch GitHub auth status')
      return {
        authenticated: false,
        user: null,
        device: githubSyncService.getDeviceState(),
        hasCustomClientId: !!process.env.GITHUB_CLIENT_ID,
      }
    }
  }),

  githubStart: protectedProcedure.mutation(async ({ ctx }) => {
    const state = await githubSyncService.startDeviceAuth(ctx.db, (db, provider) =>
      runSyncFromCtx(ctx, db, provider)
    )
    return state
  }),

  githubPoll: protectedProcedure.query(async () => {
    return githubSyncService.getDeviceState()
  }),

  githubLogout: protectedProcedure.mutation(async () => {
    await githubSyncService.logout()
    await updateEnvFile({ SYNC_PROVIDER: '' })
    await initSyncProvider()
    return { success: true }
  }),

  saveRclone: protectedProcedure.input(rcloneSaveInput()).mutation(async ({ ctx, input }) => {
    const { remote } = input

    await updateEnvFile({
      RCLONE_REMOTE: remote as string,
      SYNC_PROVIDER: 'rclone',
    })
    await runSyncFromCtx(ctx, ctx.db, 'rclone')
    return { success: true }
  }),

  googleAuthUrl: protectedProcedure.query(async () => {
    const url = await googleDriveService.getAuthUrl()
    return { url }
  }),

  googleLogin: protectedProcedure.mutation(async ({ ctx }) => {
    if (googleDriveService.isAuthenticated()) {
      const user = await googleDriveService.getUserProfile()
      if (user) {
        await updateEnvFile({ SYNC_PROVIDER: 'google' })
        await runSyncFromCtx(ctx, ctx.db, 'google')
        return { url: null, authenticated: true }
      } else {
        logger.warn('Google tokens found but invalid. Clearing and requesting new auth.')
        await googleDriveService.logout()
      }
    }
    const url = await googleDriveService.getAuthUrl()
    return { url, authenticated: false }
  }),

  user: protectedProcedure.query(async () => {
    const user = await googleDriveService.getUserProfile()
    return user
  }),

  logout: protectedProcedure.mutation(async () => {
    await googleDriveService.logout()
    await updateEnvFile({ SYNC_PROVIDER: '' })
    await initSyncProvider()
    return { success: true }
  }),
})
