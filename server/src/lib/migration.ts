import { DatabaseWrapper } from '../db'
import { performWriteTransaction } from '../sync'
import { searchAnilistByTitle, getShowMetaById } from './anilist'
import { isTempShowId } from './temp-ids'
import { WatchlistRepository } from '../repositories/watchlist.repository'
import { ShowsMetaRepository } from '../repositories/shows-meta.repository'
import { dbGet, dbRun } from '../utils/db-utils'
import logger from '../logger'

const inFlightMigrations = new Map<string, Promise<string>>()

async function consolidateFromNumeric(db: DatabaseWrapper, numericId: string): Promise<string> {
  // Check if this numeric ID might be a MAL alias that should redirect to the canonical AniList ID
  const metaRow = dbGet<{ anilistId: number | null }>(
    db,
    'SELECT anilistId FROM shows_meta WHERE id = ? AND anilistId IS NOT NULL',
    [numericId]
  )

  // Determine the true anilistId for this numeric ID
  let trueAnilistId: number | undefined
  if (metaRow?.anilistId != null && String(metaRow.anilistId) !== numericId) {
    // shows_meta already has a different anilistId — this is clearly a MAL alias
    trueAnilistId = metaRow.anilistId
  } else if (!metaRow) {
    // No local shows_meta — only verify via AniList if there's existing data that could be a MAL alias
    if (WatchlistRepository.exists(db, numericId)) {
      const meta = await getShowMetaById(numericId)
      if (meta?.anilistId && meta.anilistId !== parseInt(numericId)) {
        trueAnilistId = meta.anilistId
      }
    }
  }

  if (trueAnilistId) {
    const canonicalId = String(trueAnilistId)
    if (WatchlistRepository.exists(db, numericId)) {
      // MAL alias is in the watchlist — migrate all entries to the canonical AniList ID
      logger.info(
        { aliasId: numericId, canonicalId },
        'Migrating watchlist from MAL alias to canonical ID'
      )
      await performWriteTransaction(db, (tx) => {
        const aliasWatchlist = WatchlistRepository.getById(tx, numericId)
        const aliasShowsMeta = ShowsMetaRepository.getById(tx, numericId)

        tx.run('UPDATE OR IGNORE watchlist SET id = ?, thumbnail = ? WHERE id = ?', [
          canonicalId,
          (aliasWatchlist as { thumbnail?: string } | null)?.thumbnail || '',
          numericId,
        ])
        tx.run('DELETE FROM watchlist WHERE id = ?', [numericId])
        tx.run(
          'UPDATE OR IGNORE shows_meta SET id = ?, anilistId = ?, thumbnail = ? WHERE id = ?',
          [
            canonicalId,
            trueAnilistId,
            (aliasShowsMeta as { thumbnail?: string } | null)?.thumbnail || '',
            numericId,
          ]
        )
        tx.run('DELETE FROM shows_meta WHERE id = ?', [numericId])
        tx.run('UPDATE OR IGNORE watched_episodes SET showId = ? WHERE showId = ?', [
          canonicalId,
          numericId,
        ])
        tx.run('DELETE FROM watched_episodes WHERE showId = ?', [numericId])
        tx.run('UPDATE OR IGNORE queue SET showId = ? WHERE showId = ?', [canonicalId, numericId])
        tx.run('DELETE FROM queue WHERE showId = ?', [numericId])
        tx.run('UPDATE OR IGNORE dismissed_notifications SET showId = ? WHERE showId = ?', [
          canonicalId,
          numericId,
        ])
        tx.run('DELETE FROM dismissed_notifications WHERE showId = ?', [numericId])
        tx.run('UPDATE OR IGNORE discovered_notifications SET showId = ? WHERE showId = ?', [
          canonicalId,
          numericId,
        ])
        tx.run('DELETE FROM discovered_notifications WHERE showId = ?', [numericId])
        tx.run('INSERT OR REPLACE INTO legacy_id_mapping (legacyId, numericId) VALUES (?, ?)', [
          numericId,
          canonicalId,
        ])
      })
      db.scheduleSave()
      return canonicalId
    }

    // Not in watchlist — check if canonical ID is in the watchlist and save a mapping
    if (WatchlistRepository.exists(db, canonicalId)) {
      const existing = dbGet<{ numericId: string }>(
        db,
        'SELECT numericId FROM legacy_id_mapping WHERE legacyId = ?',
        [numericId]
      )
      if (!existing || existing.numericId !== canonicalId) {
        dbRun(db, 'INSERT OR REPLACE INTO legacy_id_mapping (legacyId, numericId) VALUES (?, ?)', [
          numericId,
          canonicalId,
        ])
        db.scheduleSave()
        logger.info({ aliasId: numericId, canonicalId }, 'Mapped numeric alias to canonical ID')
      }
      return canonicalId
    }
  }

  if (WatchlistRepository.exists(db, numericId)) return numericId

  let legacyId: string | undefined

  // 1. Check legacy_id_mapping for a legacy ID in the watchlist that maps to this numeric ID
  const legacyRow = dbGet<{ legacyId: string }>(
    db,
    'SELECT legacyId FROM legacy_id_mapping WHERE numericId = ? AND legacyId IN (SELECT id FROM watchlist)',
    [numericId]
  )
  if (legacyRow) {
    legacyId = legacyRow.legacyId
  }

  // 2. If not found, check shows_meta by anilistId where the entry's id IS in the watchlist
  if (!legacyId && trueAnilistId) {
    const metaByAnilist = dbGet<{ id: string }>(
      db,
      'SELECT id FROM shows_meta WHERE anilistId = ? AND id IN (SELECT id FROM watchlist)',
      [trueAnilistId]
    )
    if (metaByAnilist) {
      legacyId = metaByAnilist.id
    }
  }

  if (!legacyId) return numericId

  logger.info({ legacyId, numericId }, 'Consolidating watchlist entry from legacy to numeric ID')

  const aniListId = parseInt(numericId)
  await performWriteTransaction(db, (tx) => {
    const legacyWatchlist = WatchlistRepository.getById(tx, legacyId)
    const legacyShowsMeta = ShowsMetaRepository.getById(tx, legacyId)

    tx.run('UPDATE OR IGNORE watchlist SET id = ?, thumbnail = ? WHERE id = ?', [
      numericId,
      (legacyWatchlist as { thumbnail?: string } | null)?.thumbnail || '',
      legacyId,
    ])
    tx.run('DELETE FROM watchlist WHERE id = ?', [legacyId])
    tx.run('UPDATE OR IGNORE shows_meta SET id = ?, anilistId = ?, thumbnail = ? WHERE id = ?', [
      numericId,
      aniListId,
      (legacyShowsMeta as { thumbnail?: string } | null)?.thumbnail || '',
      legacyId,
    ])
    tx.run('DELETE FROM shows_meta WHERE id = ?', [legacyId])
    tx.run('UPDATE OR IGNORE watched_episodes SET showId = ? WHERE showId = ?', [
      numericId,
      legacyId,
    ])
    tx.run('DELETE FROM watched_episodes WHERE showId = ?', [legacyId])
    tx.run('UPDATE OR IGNORE queue SET showId = ? WHERE showId = ?', [numericId, legacyId])
    tx.run('DELETE FROM queue WHERE showId = ?', [legacyId])
    tx.run('UPDATE OR IGNORE dismissed_notifications SET showId = ? WHERE showId = ?', [
      numericId,
      legacyId,
    ])
    tx.run('DELETE FROM dismissed_notifications WHERE showId = ?', [legacyId])
    tx.run('UPDATE OR IGNORE discovered_notifications SET showId = ? WHERE showId = ?', [
      numericId,
      legacyId,
    ])
    tx.run('DELETE FROM discovered_notifications WHERE showId = ?', [legacyId])
    tx.run('INSERT OR REPLACE INTO legacy_id_mapping (legacyId, numericId) VALUES (?, ?)', [
      legacyId,
      numericId,
    ])
  })
  db.scheduleSave()
  return numericId
}

async function migrateId(db: DatabaseWrapper, legacyId: string): Promise<string> {
  const isNumeric = /^\d+$/.test(legacyId)
  if (isNumeric) {
    return consolidateFromNumeric(db, legacyId)
  }

  try {
    // 1. Check if mapping already exists
    const mapping = dbGet<{ numericId: string }>(
      db,
      'SELECT numericId FROM legacy_id_mapping WHERE legacyId = ?',
      [legacyId]
    )
    if (mapping) {
      const mappedMeta = (await ShowsMetaRepository.getById(db, mapping.numericId)) as {
        anilistId?: number
      } | null
      const canonicalId = mappedMeta?.anilistId ? String(mappedMeta.anilistId) : undefined
      if (!canonicalId || canonicalId === mapping.numericId) {
        return consolidateFromNumeric(db, mapping.numericId)
      }

      await performWriteTransaction(db, (tx) => {
        const legacyWatchlist = WatchlistRepository.getById(tx, mapping.numericId)
        const legacyShowsMeta = ShowsMetaRepository.getById(tx, mapping.numericId)

        tx.run('UPDATE OR IGNORE watchlist SET id = ?, thumbnail = ? WHERE id = ?', [
          canonicalId,
          (legacyWatchlist as { thumbnail?: string } | null)?.thumbnail || '',
          mapping.numericId,
        ])
        tx.run('DELETE FROM watchlist WHERE id = ?', [mapping.numericId])
        tx.run(
          'UPDATE OR IGNORE shows_meta SET id = ?, anilistId = ?, thumbnail = ? WHERE id = ?',
          [
            canonicalId,
            parseInt(canonicalId),
            (legacyShowsMeta as { thumbnail?: string } | null)?.thumbnail || '',
            mapping.numericId,
          ]
        )
        tx.run('DELETE FROM shows_meta WHERE id = ?', [mapping.numericId])
        tx.run('UPDATE OR IGNORE watched_episodes SET showId = ? WHERE showId = ?', [
          canonicalId,
          mapping.numericId,
        ])
        tx.run('DELETE FROM watched_episodes WHERE showId = ?', [mapping.numericId])
        tx.run('UPDATE OR IGNORE queue SET showId = ? WHERE showId = ?', [
          canonicalId,
          mapping.numericId,
        ])
        tx.run('DELETE FROM queue WHERE showId = ?', [mapping.numericId])
        tx.run('UPDATE OR IGNORE dismissed_notifications SET showId = ? WHERE showId = ?', [
          canonicalId,
          mapping.numericId,
        ])
        tx.run('DELETE FROM dismissed_notifications WHERE showId = ?', [mapping.numericId])
        tx.run('UPDATE OR IGNORE discovered_notifications SET showId = ? WHERE showId = ?', [
          canonicalId,
          mapping.numericId,
        ])
        tx.run('DELETE FROM discovered_notifications WHERE showId = ?', [mapping.numericId])
        tx.run('UPDATE legacy_id_mapping SET numericId = ? WHERE legacyId = ?', [
          canonicalId,
          legacyId,
        ])
      })
      db.scheduleSave()
      logger.info(
        { legacyId, previousId: mapping.numericId, newId: canonicalId },
        'Canonicalized migrated show ID'
      )
      return canonicalId
    }

    // 2. We need to find the title/name of the show
    let showName: string | undefined

    // Try shows_meta by direct ID or anilistId
    const localMeta = (await ShowsMetaRepository.getById(db, legacyId)) as {
      name?: string
      anilistId?: number
    } | null
    if (localMeta && localMeta.name) {
      showName = localMeta.name
    } else {
      const metaByAnilist = dbGet<{ name: string; id: string }>(
        db,
        'SELECT id, name FROM shows_meta WHERE anilistId = ?',
        [parseInt(legacyId) || 0]
      )
      if (metaByAnilist && metaByAnilist.name) {
        showName = metaByAnilist.name
      } else {
        // Try watchlist
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

    // 3. Search AniList by title
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

    // 4. Perform the DB updates across all tables atomically
    await performWriteTransaction(db, (tx) => {
      tx.run('INSERT OR REPLACE INTO legacy_id_mapping (legacyId, numericId) VALUES (?, ?)', [
        legacyId,
        newId,
      ])

      const legacyWatchlist = WatchlistRepository.getById(tx, legacyId)
      if (legacyWatchlist) {
        const newWatchlistExists = WatchlistRepository.getById(tx, newId)
        if (newWatchlistExists) {
          WatchlistRepository.delete(tx, legacyId)
        } else {
          tx.run('UPDATE watchlist SET id = ?, thumbnail = ? WHERE id = ?', [
            newId,
            newThumbnail || (legacyWatchlist as { thumbnail?: string }).thumbnail || '',
            legacyId,
          ])
        }
      }

      const legacyShowsMeta = ShowsMetaRepository.getById(tx, legacyId)
      if (legacyShowsMeta) {
        const newShowsMetaExists = ShowsMetaRepository.getById(tx, newId)
        if (newShowsMetaExists) {
          tx.run('DELETE FROM shows_meta WHERE id = ?', [legacyId])
        } else {
          tx.run('UPDATE shows_meta SET id = ?, anilistId = ?, thumbnail = ? WHERE id = ?', [
            newId,
            aniListShow.id,
            newThumbnail || (legacyShowsMeta as { thumbnail?: string }).thumbnail || '',
            legacyId,
          ])
        }
      }

      tx.run('UPDATE OR IGNORE watched_episodes SET showId = ? WHERE showId = ?', [newId, legacyId])
      tx.run('DELETE FROM watched_episodes WHERE showId = ?', [legacyId])

      tx.run('UPDATE OR IGNORE queue SET showId = ? WHERE showId = ?', [newId, legacyId])
      tx.run('DELETE FROM queue WHERE showId = ?', [legacyId])

      tx.run('UPDATE OR IGNORE dismissed_notifications SET showId = ? WHERE showId = ?', [
        newId,
        legacyId,
      ])
      tx.run('DELETE FROM dismissed_notifications WHERE showId = ?', [legacyId])

      tx.run('UPDATE OR IGNORE discovered_notifications SET showId = ? WHERE showId = ?', [
        newId,
        legacyId,
      ])
      tx.run('DELETE FROM discovered_notifications WHERE showId = ?', [legacyId])
    })

    db.scheduleSave()
    logger.info({ legacyId, newId, showName }, 'Successfully migrated legacy show ID to numeric ID')
    return newId
  } catch (err) {
    logger.error({ err, legacyId }, 'Error migrating legacy show ID')
    return legacyId
  }
}

export function getMigratedId(db: DatabaseWrapper, legacyId: string): Promise<string> {
  if (isTempShowId(legacyId)) return Promise.resolve(legacyId)

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
