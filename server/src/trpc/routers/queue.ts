import { protectedProcedure, router } from '../index.js'
import { QueueRepository } from '../../repositories/queue.repository.js'
import { ShowsMetaRepository } from '../../repositories/shows-meta.repository.js'
import { performWriteTransactionAsync } from '../../sync.js'
import { getMigratedId } from '../../lib/migration.js'
import {
  queueAddInput,
  queueBatchInput,
  queueRemoveInput,
  queueRemoveManyInput,
  queueReorderInput,
  type QueueMeta,
} from '../validation.js'

function applyMeta(meta: QueueMeta) {
  return meta.showName || meta.showThumbnail || meta.nativeName || meta.englishName || meta.type
}

export const queueRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await QueueRepository.getAll(ctx.db)
    return rows.map((row) => ({
      ...row,
      _id: row.showId,
      id: row.id,
      thumbnail: row.thumbnail || '',
    }))
  }),

  add: protectedProcedure.input(queueAddInput()).mutation(async ({ ctx, input }) => {
    const showId = await getMigratedId(ctx.db, input.showId)
    const episodeNumber = input.episodeNumber
    const existing = await QueueRepository.getByEpisode(ctx.db, showId, episodeNumber)
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      if (applyMeta(input)) {
        await ShowsMetaRepository.upsert(tx, {
          id: showId,
          name: input.showName || '',
          thumbnail: input.showThumbnail || '',
          nativeName: input.nativeName,
          englishName: input.englishName,
          type: input.type,
        })
      }
      if (existing) {
        await QueueRepository.removeEpisode(tx, showId, episodeNumber)
      } else {
        await QueueRepository.addToEnd(tx, showId, episodeNumber)
      }
    })
    return { success: true, queued: !existing }
  }),

  addBatch: protectedProcedure.input(queueBatchInput()).mutation(async ({ ctx, input }) => {
    const showId = await getMigratedId(ctx.db, input.showId)
    const normalized = [...new Set(input.episodeNumbers)]
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      if (applyMeta(input)) {
        await ShowsMetaRepository.upsert(tx, {
          id: showId,
          name: input.showName || '',
          thumbnail: input.showThumbnail || '',
          nativeName: input.nativeName,
          englishName: input.englishName,
          type: input.type,
        })
      }
      await QueueRepository.addManyToEnd(
        tx,
        normalized.map((episodeNumber) => ({ showId, episodeNumber }))
      )
    })
    return { success: true, added: normalized.length }
  }),

  remove: protectedProcedure.input(queueRemoveInput()).mutation(async ({ ctx, input }) => {
    const showId = await getMigratedId(ctx.db, input.showId)
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      await QueueRepository.removeEpisode(tx, showId, input.episodeNumber)
    })
    return { success: true }
  }),

  removeMany: protectedProcedure.input(queueRemoveManyInput()).mutation(async ({ ctx, input }) => {
    const showId = await getMigratedId(ctx.db, input.showId)
    let removed: string[] = []
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      removed = ((await QueueRepository.getByShow(tx, showId)) || []).map((ep) => ep.episodeNumber)
      const toRemove =
        Array.isArray(input.episodeNumbers) && input.episodeNumbers.length
          ? [...new Set(input.episodeNumbers)]
          : removed
      await QueueRepository.removeMany(tx, showId, toRemove)
    })
    return { success: true, removed: removed.length }
  }),

  clear: protectedProcedure.mutation(async ({ ctx }) => {
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      await QueueRepository.clear(tx)
    })
    return { success: true }
  }),

  reorder: protectedProcedure.input(queueReorderInput()).mutation(async ({ ctx, input }) => {
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      await QueueRepository.reorder(tx, input)
    })
    return { success: true }
  }),
})
