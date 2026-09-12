import { DatabaseWrapper } from '../db'
import { dbAll, dbGet, dbRun } from '../utils/db-utils'

export interface LocalEpisode {
  id: number
  localId: string
  episodeNumber: number
  season: number
  filePath: string
  fileName: string
  fileSize: number | null
  durationSeconds: number | null
  scanTime: string
}

export const LocalEpisodesRepository = {
  getById: (db: DatabaseWrapper, id: number) =>
    dbGet<LocalEpisode>(db, 'SELECT * FROM local_episodes WHERE id = ?', [id]),

  getByLocalId: (db: DatabaseWrapper, localId: string) =>
    dbAll<LocalEpisode>(
      db,
      'SELECT * FROM local_episodes WHERE localId = ? ORDER BY COALESCE(season, 1) ASC, episodeNumber ASC',
      [localId]
    ),

  getByFilePath: (db: DatabaseWrapper, filePath: string) =>
    dbGet<LocalEpisode>(db, 'SELECT * FROM local_episodes WHERE filePath = ?', [filePath]),

  getEpisodesForShow: (db: DatabaseWrapper, localId: string) =>
    dbAll<LocalEpisode>(
      db,
      'SELECT * FROM local_episodes WHERE localId = ? ORDER BY COALESCE(season, 1) ASC, episodeNumber ASC',
      [localId]
    ),

  upsert: (
    db: DatabaseWrapper,
    data: {
      localId: string
      episodeNumber: number
      season?: number
      filePath: string
      fileName: string
      fileSize?: number | null
      durationSeconds?: number | null
    }
  ) =>
    dbRun(
      db,
      `INSERT INTO local_episodes (localId, episodeNumber, season, filePath, fileName, fileSize, durationSeconds, scanTime)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(filePath) DO UPDATE SET
          episodeNumber = EXCLUDED.episodeNumber,
          season = EXCLUDED.season,
          fileName = EXCLUDED.fileName,
          fileSize = COALESCE(EXCLUDED.fileSize, local_episodes.fileSize),
          durationSeconds = COALESCE(EXCLUDED.durationSeconds, local_episodes.durationSeconds),
          scanTime = CURRENT_TIMESTAMP`,
      [
        data.localId,
        data.episodeNumber,
        data.season ?? 1,
        data.filePath,
        data.fileName,
        data.fileSize ?? null,
        data.durationSeconds ?? null,
      ]
    ),

  deleteByLocalId: (db: DatabaseWrapper, localId: string) =>
    dbRun(db, 'DELETE FROM local_episodes WHERE localId = ?', [localId]),

  deleteByFilePath: (db: DatabaseWrapper, filePath: string) =>
    dbRun(db, 'DELETE FROM local_episodes WHERE filePath = ?', [filePath]),

  deleteByIds: (db: DatabaseWrapper, ids: number[]) => {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(',')
    dbRun(db, `DELETE FROM local_episodes WHERE id IN (${placeholders})`, ids)
  },

  deleteOrphaned: (db: DatabaseWrapper) =>
    dbRun(
      db,
      'DELETE FROM local_episodes WHERE localId NOT IN (SELECT localId FROM local_show_mapping)'
    ),
}
