import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import { performWriteTransactionAsync } from '../../sync.js'
import { AniListTracker } from '../../lib/tracker/anilist-tracker.js'
import {
  syncAniList,
  importFromMalUsername,
  importFromUsername,
} from '../../lib/tracker/sync.service.js'
import {
  syncAniListManga,
  importFromUsernameManga,
  importMangaFromMalUsername,
} from '../../lib/tracker/manga-sync.service.js'
import { defineSchema, reqObj } from '../validation.js'

const TRACKER_TOKEN_KEY = 'tracker_anilist_token'
const TRACKER_USER_KEY = 'tracker_anilist_user'

function badRequest(message: string): TRPCError {
  return new TRPCError({ code: 'BAD_REQUEST', message })
}

function failed(message: string): TRPCError {
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message })
}

function unavailable(message: string): TRPCError {
  return new TRPCError({ code: 'SERVICE_UNAVAILABLE', message })
}

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
    return new TRPCError({ code: 'NOT_FOUND', message })
  }
  if (message.includes('blocked') || message.includes('HTTP 429')) {
    return new TRPCError({ code: 'TOO_MANY_REQUESTS', message })
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
        } catch {
          user = null
        }
      }
      return { anilist: { connected: !!tokenRow?.value, user } }
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
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: err instanceof Error ? err.message : 'Authentication failed',
      })
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
    if (provider !== 'anilist') {
      throw badRequest(`Provider "${provider}" is not supported yet`)
    }
    try {
      const summary = await syncAniList(ctx.db)
      return { success: true, summary }
    } catch (err) {
      throw failed(err instanceof Error ? err.message : 'Sync failed')
    }
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
