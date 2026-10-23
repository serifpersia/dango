import { MAL_KEYS, beginMalLogin, credentialSettings } from '../../lib/tracker/mal-tracker.js'
import { syncMyAnimeList } from '../../lib/tracker/mal-sync.service.js'
import { syncMyAnimeListManga } from '../../lib/tracker/mal-manga-sync.service.js'
import { withTrackerLock } from '../../lib/tracker/sync-lock.js'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import logger from '../../logger.js'
import { performWriteTransactionAsync } from '../../db/transaction.js'
import { AniListTracker } from '../../lib/tracker/anilist-tracker.js'
import {
  syncAniList,
  importFromMalUsername,
  importFromUsername,
} from '../../lib/tracker/anime-sync/index.js'
import {
  syncAniListManga,
  importFromUsernameManga,
  importMangaFromMalUsername,
} from '../../lib/tracker/manga-sync/index.js'
import { defineSchema, reqObj } from '../validation.js'
import {
  badRequest,
  failed,
  notFound,
  tooManyRequests,
  unauthorized,
  unavailable,
} from '../errors.js'

const TRACKER_TOKEN_KEY = 'tracker_anilist_token'
const TRACKER_USER_KEY = 'tracker_anilist_user'

function optBody(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  return reqObj(value)
}

export type TrackerTokenInput = { token?: unknown; code?: unknown; redirectUri?: unknown }

const trackerTokenInput = () =>
  defineSchema<TrackerTokenInput, TrackerTokenInput>((value) => {
    const obj = optBody(value)
    return { token: obj.token, code: obj.code, redirectUri: obj.redirectUri }
  })

export type TrackerSyncInput = { provider?: unknown }

const trackerSyncInput = () =>
  defineSchema<TrackerSyncInput, TrackerSyncInput>((value) => ({
    provider: optBody(value).provider,
  }))

export type TrackerUsernameInput = { username?: unknown; erase?: unknown }

const trackerUsernameInput = () =>
  defineSchema<TrackerUsernameInput, TrackerUsernameInput>((value) => {
    const obj = optBody(value)
    return { username: obj.username, erase: obj.erase }
  })

export type TrackerMalInput = {
  username?: unknown
  erase?: unknown
  useOfflineDb?: unknown
  skipFallback?: unknown
}

const trackerMalInput = () =>
  defineSchema<TrackerMalInput, TrackerMalInput>((value) => {
    const obj = optBody(value)
    return {
      username: obj.username,
      erase: obj.erase,
      useOfflineDb: obj.useOfflineDb,
      skipFallback: obj.skipFallback,
    }
  })

export type TrackerMangaSyncInput = { direction?: unknown }

const trackerMangaSyncInput = () =>
  defineSchema<TrackerMangaSyncInput, TrackerMangaSyncInput>((value) => ({
    direction: optBody(value).direction,
  }))

function mapImportError(message: string): TRPCError {
  if (message.includes('private') || message.includes('not found')) {
    return notFound(message)
  }
  if (message.includes('blocked') || message.includes('HTTP 429')) {
    return tooManyRequests(message)
  }
  return failed(message)
}

export const trackerRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    try {
      const tokenRow = await SettingsRepository.getByKey(ctx.db, TRACKER_TOKEN_KEY)
      const userRow = await SettingsRepository.getByKey(ctx.db, TRACKER_USER_KEY)
      let user: unknown = null
      if (userRow?.value) {
        try {
          user = JSON.parse(userRow.value)
        } catch (e) {
          logger.warn({ err: e }, 'The stored tracker user is not valid json')
          user = null
        }
      }
      const malTokens = await SettingsRepository.getByKey(ctx.db, MAL_KEYS.tokens)
      const malUser = await SettingsRepository.getByKey(ctx.db, MAL_KEYS.user)
      return {
        anilist: {
          connected: !!tokenRow?.value,
          user,
        },
        mal: {
          connected: !!malTokens?.value,
          user: malUser?.value
            ? (JSON.parse(malUser.value) as { id: number; name: string; avatar?: string })
            : null,
        },
      }
    } catch {
      throw failed('Failed to read tracker status')
    }
  }),

  anilistAuth: protectedProcedure.input(trackerTokenInput()).mutation(async ({ ctx, input }) => {
    const accessToken = typeof input.token === 'string' ? input.token.trim() : ''
    if (!accessToken) {
      throw badRequest('Access token is required')
    }
    try {
      const tracker = new AniListTracker(accessToken)
      const viewer = await tracker.getViewer()
      await performWriteTransactionAsync(ctx.db, async (tx) => {
        await SettingsRepository.upsert(tx, TRACKER_TOKEN_KEY, accessToken)
        await SettingsRepository.upsert(tx, TRACKER_USER_KEY, JSON.stringify(viewer))
      })
      return { success: true, user: viewer }
    } catch (err) {
      throw unauthorized(err instanceof Error ? err.message : 'Authentication failed')
    }
  }),

  anilistDisconnect: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      await performWriteTransactionAsync(ctx.db, async (tx) => {
        await SettingsRepository.upsert(tx, TRACKER_TOKEN_KEY, '')
        await SettingsRepository.upsert(tx, TRACKER_USER_KEY, '')
      })
      return { success: true }
    } catch {
      throw failed('Failed to disconnect')
    }
  }),

  sync: protectedProcedure.input(trackerSyncInput()).mutation(async ({ ctx, input }) => {
    const { provider = 'anilist' } = input
    if (provider !== 'anilist' && provider !== 'mal') {
      throw badRequest(`Provider "${provider}" is not supported yet`)
    }
    try {
      const summary =
        provider === 'mal'
          ? await syncMyAnimeList(ctx.db, { deletions: true })
          : await syncAniList(ctx.db, { deletions: true })
      return { success: true, summary }
    } catch (err) {
      throw failed(err instanceof Error ? err.message : 'Sync failed')
    }
  }),

  malConfig: protectedProcedure.query(async ({ ctx }) => {
    const { mode, clientId, hasSecret, hasCustomId, hasWorker } = await credentialSettings(ctx.db)
    return { mode, clientId, hasSecret, hasCustomId, hasWorker }
  }),

  malSaveConfig: protectedProcedure
    .input(
      defineSchema<
        { clientId: string; clientSecret?: string },
        { clientId: string; clientSecret?: string }
      >((value) => {
        const obj = reqObj(value)
        if (typeof obj.clientId !== 'string') throw badRequest('Invalid MAL client ID')
        if (obj.clientSecret !== undefined && typeof obj.clientSecret !== 'string')
          throw badRequest('Invalid client secret')
        return {
          clientId: obj.clientId.trim(),
          clientSecret: obj.clientSecret as string | undefined,
        }
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.clientId) {
        if ((await credentialSettings(ctx.db)).mode !== 'worker')
          throw badRequest('MAL client ID and secret are required')
        return { success: true }
      }
      if (!input.clientSecret?.trim()) throw badRequest('MAL client secret is required')
      const clientSecret = input.clientSecret.trim()
      await withTrackerLock(ctx.db, 'mal', () =>
        ctx.db.transact(async (tx) => {
          const old = (await SettingsRepository.getByKey(tx, MAL_KEYS.clientId))?.value || ''
          if (old && old !== input.clientId) {
            for (const key of [
              MAL_KEYS.tokens,
              MAL_KEYS.user,
              MAL_KEYS.pending,
              MAL_KEYS.clientSecret,
            ])
              await SettingsRepository.deleteByKey(tx, key)
          }
          await SettingsRepository.upsert(tx, MAL_KEYS.clientId, input.clientId)
          await SettingsRepository.upsert(tx, MAL_KEYS.clientSecret, clientSecret)
        })
      )
      return { success: true }
    }),

  malClearConfig: protectedProcedure.mutation(async ({ ctx }) => {
    await withTrackerLock(ctx.db, 'mal', () =>
      ctx.db.transact(async (tx) => {
        for (const key of [
          MAL_KEYS.clientId,
          MAL_KEYS.clientSecret,
          MAL_KEYS.tokens,
          MAL_KEYS.user,
          MAL_KEYS.pending,
          'tracker_mal_sync_state',
        ])
          await SettingsRepository.deleteByKey(tx, key)
      })
    )
    return { success: true }
  }),

  malLogin: protectedProcedure
    .input(
      defineSchema<{ redirectUri: string }, { redirectUri: string }>((value) => {
        const obj = reqObj(value)
        if (typeof obj.redirectUri !== 'string') throw badRequest('Redirect URI is required')
        return { redirectUri: obj.redirectUri }
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await beginMalLogin(ctx.db, input.redirectUri)
      } catch (err) {
        throw badRequest(err instanceof Error ? err.message : 'Could not start MAL login')
      }
    }),

  malDisconnect: protectedProcedure.mutation(async ({ ctx }) => {
    await withTrackerLock(ctx.db, 'mal', () =>
      ctx.db.transact(async (tx) => {
        for (const key of [
          MAL_KEYS.tokens,
          MAL_KEYS.user,
          MAL_KEYS.pending,
          'tracker_mal_sync_state',
        ])
          await SettingsRepository.deleteByKey(tx, key)
      })
    )
    return { success: true }
  }),

  anilistImport: protectedProcedure
    .input(trackerUsernameInput())
    .mutation(async ({ ctx, input }) => {
      const { username, erase } = input
      if (!username || typeof username !== 'string') {
        throw badRequest('Username is required')
      }
      try {
        const count = await importFromUsername(ctx.db, username.trim(), erase === true)
        return { success: true, count }
      } catch (err) {
        throw failed(err instanceof Error ? err.message : 'Import failed')
      }
    }),

  malImport: protectedProcedure.input(trackerMalInput()).mutation(async ({ ctx, input }) => {
    const { username, erase, useOfflineDb, skipFallback } = input
    if (!username || typeof username !== 'string') {
      throw badRequest('MAL username is required')
    }
    try {
      const count = await importFromMalUsername(ctx.db, username.trim(), {
        erase: erase === true,
        useOfflineDb: useOfflineDb !== false,
        skipFallback: skipFallback === true,
      })
      return { success: true, count }
    } catch (err) {
      throw mapImportError(err instanceof Error ? err.message : 'Import failed')
    }
  }),

  mangaSync: protectedProcedure.input(trackerMangaSyncInput()).mutation(async ({ ctx, input }) => {
    const { direction } = input
    try {
      const mangaDb = ctx.mangaDb
      if (!mangaDb || mangaDb.isClosedCheck()) {
        throw unavailable('Manga database is not ready')
      }
      const syncDirection = direction === 'pull-only' ? 'pull-only' : 'two-way'
      const result = await syncAniListManga(ctx.db, mangaDb, {
        direction: syncDirection,
        deletions: true,
      })
      return {
        success: true,
        summary: result.summary,
        details: result.details,
        direction: syncDirection,
      }
    } catch (err) {
      if (err instanceof TRPCError) throw err
      throw failed(err instanceof Error ? err.message : 'Manga sync failed')
    }
  }),

  mangaMalSync: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const mangaDb = ctx.mangaDb
      if (!mangaDb || mangaDb.isClosedCheck()) {
        throw unavailable('Manga database is not ready')
      }
      const summary = await syncMyAnimeListManga(ctx.db, mangaDb, { deletions: true })
      return { success: true, summary }
    } catch (err) {
      if (err instanceof TRPCError) throw err
      throw failed(err instanceof Error ? err.message : 'Manga sync failed')
    }
  }),

  mangaImport: protectedProcedure.input(trackerUsernameInput()).mutation(async ({ ctx, input }) => {
    const { username, erase } = input
    if (!username || typeof username !== 'string') {
      throw badRequest('Username is required')
    }
    try {
      const mangaDb = ctx.mangaDb
      if (!mangaDb || mangaDb.isClosedCheck()) {
        throw unavailable('Manga database is not ready')
      }
      const count = await importFromUsernameManga(ctx.db, mangaDb, username.trim(), erase === true)
      return { success: true, count }
    } catch (err) {
      if (err instanceof TRPCError) throw err
      throw failed(err instanceof Error ? err.message : 'Import failed')
    }
  }),

  mangaMalImport: protectedProcedure
    .input(trackerUsernameInput())
    .mutation(async ({ ctx, input }) => {
      const { username, erase } = input
      if (!username || typeof username !== 'string') {
        throw badRequest('Username is required')
      }
      try {
        const mangaDb = ctx.mangaDb
        if (!mangaDb || mangaDb.isClosedCheck()) {
          throw unavailable('Manga database is not ready')
        }
        const result = await importMangaFromMalUsername(
          ctx.db,
          mangaDb,
          username.trim(),
          erase === true
        )
        return { success: true, ...result }
      } catch (err) {
        if (err instanceof TRPCError) throw err
        throw mapImportError(err instanceof Error ? err.message : 'Import failed')
      }
    }),
})
