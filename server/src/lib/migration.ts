import { DatabaseWrapper } from '../db.js'
import { performWriteTransactionAsync } from '../db/transaction.js'
import { searchAnilistByTitle, getShowMetaById } from './anilist/index.js'
import { isTempShowId } from './temp-ids.js'
import { WatchlistRepository } from '../repositories/watchlist.repository.js'
import { ShowsMetaRepository } from '../repositories/shows-meta.repository.js'
import { LegacyIdMappingRepository } from '../repositories/legacy-id-mapping.repository.js'
import { rewriteShowId } from '../repositories/show-id.repository.js'
import logger from '../logger.js'

const migrationsByDb = new WeakMap<DatabaseWrapper, Map<string, Promise<string>>>()

async function consolidateFromNumeric(db: DatabaseWrapper, numericId: string): Promise<string> {
  const anilistId = await ShowsMetaRepository.getAnilistId(db, numericId)

  let trueAnilistId: number | undefined
  if (anilistId != null && String(anilistId) !== numericId) {
    trueAnilistId = anilistId
  } else if (anilistId == null) {
    if (await WatchlistRepository.exists(db, numericId)) {
      const meta = await getShowMetaById(numericId)
      if (meta?.anilistId && meta.anilistId !== parseInt(numericId)) {
        trueAnilistId = meta.anilistId
      }
    }
  }

  if (trueAnilistId) {
    const canonicalId = String(trueAnilistId)
    if (await WatchlistRepository.exists(db, numericId)) {
      logger.info(
        { aliasId: numericId, canonicalId },
        'Migrating watchlist from MAL alias to canonical ID'
      )
      await performWriteTransactionAsync(db, async (tx) => {
        await rewriteShowId(tx, numericId, canonicalId, { anilistId: trueAnilistId })
        LegacyIdMappingRepository.set(tx, numericId, canonicalId)
      })
      return canonicalId
    }

    if (await WatchlistRepository.exists(db, canonicalId)) {
      const existing = LegacyIdMappingRepository.getNumericId(db, numericId)
      if (existing !== canonicalId) {
        LegacyIdMappingRepository.set(db, numericId, canonicalId)
        logger.info({ aliasId: numericId, canonicalId }, 'Mapped numeric alias to canonical ID')
      }
      return canonicalId
    }
  }

  if (await WatchlistRepository.exists(db, numericId)) return numericId

  let legacyId: string | undefined

  const legacyRow = LegacyIdMappingRepository.getLegacyId(db, numericId)
  if (legacyRow) {
    legacyId = legacyRow
  }

  if (!legacyId && trueAnilistId) {
    legacyId =
      (await ShowsMetaRepository.getWatchlistedIdByAnilistId(db, trueAnilistId)) ?? undefined
  }

  if (!legacyId) return numericId

  logger.info({ legacyId, numericId }, 'Consolidating watchlist entry from legacy to numeric ID')

  const aniListId = parseInt(numericId)
  await performWriteTransactionAsync(db, async (tx) => {
    await rewriteShowId(tx, legacyId, numericId, { anilistId: aniListId })
    LegacyIdMappingRepository.set(tx, legacyId, numericId)
  })
  return numericId
}

async function migrateId(db: DatabaseWrapper, legacyId: string): Promise<string> {
  const isNumeric = /^\d+$/.test(legacyId)
  if (isNumeric) {
    return consolidateFromNumeric(db, legacyId)
  }

  try {
    const mappedNumericId = LegacyIdMappingRepository.getNumericId(db, legacyId)
    if (mappedNumericId) {
      const mapping = { numericId: mappedNumericId }
      const mappedMeta = (await ShowsMetaRepository.getById(db, mapping.numericId)) as {
        anilistId?: number
      } | null
      const canonicalId = mappedMeta?.anilistId ? String(mappedMeta.anilistId) : undefined
      if (!canonicalId || canonicalId === mapping.numericId) {
        return consolidateFromNumeric(db, mapping.numericId)
      }

      await performWriteTransactionAsync(db, async (tx) => {
        await rewriteShowId(tx, mapping.numericId, canonicalId, {
          anilistId: parseInt(canonicalId),
        })
        LegacyIdMappingRepository.setNumericId(tx, legacyId, canonicalId)
      })
      logger.info(
        { legacyId, previousId: mapping.numericId, newId: canonicalId },
        'Canonicalized migrated show ID'
      )
      return canonicalId
    }

    let showName: string | undefined

    const localMeta = (await ShowsMetaRepository.getById(db, legacyId)) as {
      name?: string
      anilistId?: number
    } | null
    if (localMeta && localMeta.name) {
      showName = localMeta.name
    } else {
      const metaByAnilist = await ShowsMetaRepository.getByAnilistId(db, parseInt(legacyId) || 0)
      if (metaByAnilist?.name) {
        showName = metaByAnilist.name
      } else {
        const watchlistEntry = await WatchlistRepository.getById(db, legacyId)
        if (watchlistEntry && watchlistEntry.name) {
          showName = watchlistEntry.name
        }
      }
    }

    if (!showName) {
      logger.warn({ id: legacyId }, 'No show name found for legacy ID migration')
      return legacyId
    }

    const aniListShow = await searchAnilistByTitle(showName)
    if (!aniListShow) {
      logger.warn({ id: legacyId, showName }, 'No AniList match found for legacy ID migration')
      return legacyId
    }

    const newId = String(aniListShow.id)

    let newThumbnail: string | undefined
    try {
      const freshMeta = await getShowMetaById(newId)
      newThumbnail = freshMeta?.thumbnail
    } catch {
      newThumbnail = undefined
    }

    await performWriteTransactionAsync(db, async (tx) => {
      LegacyIdMappingRepository.set(tx, legacyId, newId)
      await rewriteShowId(tx, legacyId, newId, {
        anilistId: aniListShow.id,
        thumbnail: newThumbnail,
      })
    })

    logger.info({ legacyId, newId, showName }, 'Successfully migrated legacy show ID to numeric ID')
    return newId
  } catch (err) {
    logger.error({ err, legacyId }, 'Error migrating legacy show ID')
    return legacyId
  }
}

export function getMigratedId(db: DatabaseWrapper, legacyId: string): Promise<string> {
  let inFlightMigrations = migrationsByDb.get(db)
  if (!inFlightMigrations) {
    inFlightMigrations = new Map()
    migrationsByDb.set(db, inFlightMigrations)
  }
  if (isTempShowId(legacyId)) return Promise.resolve(legacyId)

  if (/^(mal-\d+|-\d+)$/i.test(legacyId)) {
    const mapping = LegacyIdMappingRepository.getNumericId(db, legacyId)
    if (mapping) return consolidateFromNumeric(db, mapping)
    return Promise.resolve(legacyId)
  }

  if (/^\d+$/.test(legacyId)) {
    const existing = inFlightMigrations.get(legacyId)
    if (existing) return existing

    const migration = migrateId(db, legacyId)
    inFlightMigrations.set(legacyId, migration)
    migration.then(
      () => inFlightMigrations.delete(legacyId),
      () => inFlightMigrations.delete(legacyId)
    )
    return migration
  }

  const existing = inFlightMigrations.get(legacyId)
  if (existing) return existing

  const migration = migrateId(db, legacyId)
  inFlightMigrations.set(legacyId, migration)
  migration.then(
    () => inFlightMigrations.delete(legacyId),
    () => inFlightMigrations.delete(legacyId)
  )
  return migration
}
