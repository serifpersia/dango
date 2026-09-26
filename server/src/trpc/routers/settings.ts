import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import { performWriteTransactionAsync } from '../../sync.js'
import { discordRPCService } from '../../discord-rpc.js'
import logger from '../../logger.js'
import { offlineDb } from '../../lib/offline-db.js'
import { translateTexts } from '../../lib/translate.js'
import { getMachineId } from '../../utils/machine-id.js'
import { getMalImportStatus, requestMalImportCancel } from '../../lib/mal-import.js'
import { defineSchema, reqObj } from '../validation.js'
import { keyInput, setSettingInput } from '../validation.js'

export const SETTING_DEFAULTS: Record<string, string> = {
  discordRPCEnabled: 'true',
  discordRPCHideMature: 'true',
  ignoreAdultContent: 'true',
  mangaIgnoreAdultContent: 'true',
  tvIgnoreAdultContent: 'true',
  asmrIgnoreAdultContent: 'true',
}

const autoUpdateInput = () =>
  defineSchema<{ enabled: boolean }, { enabled: boolean }>((value) => {
    const obj = reqObj(value)
    if (typeof obj.enabled !== 'boolean') throw new Error('enabled must be a boolean')
    return { enabled: obj.enabled }
  })

type TranslateInput = { texts?: unknown; source?: unknown; target?: unknown }

const translateInput = () =>
  defineSchema<TranslateInput, TranslateInput>((value) => {
    if (value === undefined || value === null) return {}
    const obj = reqObj(value)
    return { texts: obj.texts, source: obj.source, target: obj.target }
  })

export const settingsRouter = router({
  getByKey: protectedProcedure.input(keyInput()).query(async ({ ctx, input }) => {
    const row = await SettingsRepository.getByKey(ctx.db, input.key)
    const value = row ? row.value : (SETTING_DEFAULTS[input.key] ?? null)
    return { value }
  }),

  set: protectedProcedure.input(setSettingInput()).mutation(async ({ ctx, input }) => {
    const key = input.key
    const value = String(input.value ?? '')
    const shouldDelete = value === '' && key === 'tracker_anilist_client_id'
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      if (shouldDelete) await SettingsRepository.deleteByKey(tx, key)
      else await SettingsRepository.upsert(tx, key, value)
    })
    if (key === 'discordRPCEnabled') {
      discordRPCService.setEnabled(input.value === 'true' || input.value === true)
    }
    if (key === 'discordRPCHideMature') {
      discordRPCService.setHideMature(input.value === 'true' || input.value === true)
    }
    return { success: true }
  }),

  offlineDbInfo: protectedProcedure.query(async ({ ctx }) => {
    return await offlineDb.getOfflineDbInfo(ctx.db)
  }),

  setOfflineDbAutoUpdate: protectedProcedure
    .input(autoUpdateInput())
    .mutation(async ({ ctx, input }) => {
      await SettingsRepository.upsert(ctx.db, 'offlineDbAutoUpdateEnabled', String(input.enabled))
      return { success: true, enabled: input.enabled }
    }),

  triggerOfflineDbUpdate: protectedProcedure.mutation(async ({ ctx }) => {
    const info = await offlineDb.getOfflineDbInfo(ctx.db)
    if (info.isRefreshing) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Offline database refresh already in progress',
      })
    }
    offlineDb.refreshDatabase(ctx.db).catch((err) => {
      logger.warn({ err: err?.message }, 'Manual offline database update failed')
    })
    return { message: 'Offline database refresh started' }
  }),

  installationId: protectedProcedure.query(() => {
    try {
      return { id: getMachineId() }
    } catch (err) {
      logger.error({ err }, 'Failed to get machine ID')
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to get machine ID' })
    }
  }),

  translate: protectedProcedure.input(translateInput()).mutation(async ({ input }) => {
    const texts = input.texts
    const source = input.source ?? 'ja'
    const target = input.target ?? 'en'
    if (!Array.isArray(texts) || texts.length === 0) {
      return { translations: {} }
    }
    return {
      translations: await translateTexts(texts, String(source), String(target)),
    }
  }),

  malImportStatus: protectedProcedure.query(() => {
    return getMalImportStatus()
  }),

  malImportCancel: protectedProcedure.mutation(() => {
    return requestMalImportCancel()
  }),
})
