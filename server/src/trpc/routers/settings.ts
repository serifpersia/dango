import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import { performWriteTransactionAsync } from '../../db/transaction.js'
import logger from '../../logger.js'
import { translateTexts } from '../../lib/translate.js'
import { requestMalImportCancel } from '../../lib/mal-import.js'
import { defineSchema, reqObj } from '../validation.js'
import { badRequest, conflict } from '../errors.js'
import { keyInput, setSettingInput } from '../validation.js'
import { isPrivateTrackerSetting } from '../../lib/tracker/local-settings.js'

export const SETTING_DEFAULTS: Record<string, string> = {
  discordRPCEnabled: 'true',
  discordRPCHideMature: 'true',
  dangoGaze: 'true',
  ignoreAdultContent: 'true',
  mangaIgnoreAdultContent: 'true',
  tvIgnoreAdultContent: 'true',
  asmrIgnoreAdultContent: 'true',
}

const autoUpdateInput = () =>
  defineSchema<{ enabled: boolean }, { enabled: boolean }>((value) => {
    const obj = reqObj(value)
    if (typeof obj.enabled !== 'boolean') throw badRequest('enabled must be a boolean')
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
    if (isPrivateTrackerSetting(input.key))
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Tracker credentials are private.' })
    const row = await SettingsRepository.getByKey(ctx.db, input.key)
    const value = row ? row.value : (SETTING_DEFAULTS[input.key] ?? null)
    return { value }
  }),

  set: protectedProcedure.input(setSettingInput()).mutation(async ({ ctx, input }) => {
    const key = input.key
    if (isPrivateTrackerSetting(key))
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Use the tracker account settings to manage credentials.',
      })
    const value = String(input.value ?? '')
    const shouldDelete = value === '' && key === 'tracker_anilist_client_id'
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      if (shouldDelete) await SettingsRepository.deleteByKey(tx, key)
      else await SettingsRepository.upsert(tx, key, value)
    })
    if (key === 'discordRPCEnabled') {
      ctx.discordRPC.setEnabled(input.value === 'true' || input.value === true)
    }
    if (key === 'discordRPCHideMature') {
      ctx.discordRPC.setHideMature(input.value === 'true' || input.value === true)
    }
    return { success: true }
  }),

  offlineDbInfo: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.offlineDb.getOfflineDbInfo(ctx.db)
  }),

  setOfflineDbAutoUpdate: protectedProcedure
    .input(autoUpdateInput())
    .mutation(async ({ ctx, input }) => {
      await SettingsRepository.upsert(ctx.db, 'offlineDbAutoUpdateEnabled', String(input.enabled))
      return { success: true, enabled: input.enabled }
    }),

  triggerOfflineDbUpdate: protectedProcedure.mutation(async ({ ctx }) => {
    const info = await ctx.offlineDb.getOfflineDbInfo(ctx.db)
    if (info.isRefreshing) {
      throw conflict('Offline database refresh already in progress')
    }
    ctx.offlineDb.refreshDatabase(ctx.db).catch((err) => {
      logger.warn({ err: err?.message }, 'Manual offline database update failed')
    })
    return { message: 'Offline database refresh started' }
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

  malImportCancel: protectedProcedure.mutation(() => {
    return requestMalImportCancel()
  }),
})
