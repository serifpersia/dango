import { DatabaseWrapper } from '../db'
import { dbAll, dbGet, dbRun } from '../utils/db-utils'

export interface LocalSubtitle {
  id: number
  episodeId: number
  filePath: string
  language: string
  format: string
}

export const LocalSubtitlesRepository = {
  getById: (db: DatabaseWrapper, id: number) =>
    dbGet<LocalSubtitle>(db, 'SELECT * FROM local_subtitles WHERE id = ?', [id]),

  getByEpisodeId: (db: DatabaseWrapper, episodeId: number) =>
    dbAll<LocalSubtitle>(
      db,
      'SELECT * FROM local_subtitles WHERE episodeId = ? ORDER BY language ASC',
      [episodeId]
    ),

  getByEpisodeIds: (db: DatabaseWrapper, episodeIds: number[]) => {
    if (episodeIds.length === 0) return []
    const placeholders = episodeIds.map(() => '?').join(',')
    return dbAll<LocalSubtitle>(
      db,
      `SELECT * FROM local_subtitles WHERE episodeId IN (${placeholders}) ORDER BY episodeId, language ASC`,
      episodeIds
    )
  },

  upsert: (
    db: DatabaseWrapper,
    data: {
      episodeId: number
      filePath: string
      language: string
      format: string
    }
  ) =>
    dbRun(
      db,
      `INSERT INTO local_subtitles (episodeId, filePath, language, format)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(filePath) DO UPDATE SET
          episodeId = EXCLUDED.episodeId,
          language = EXCLUDED.language,
          format = EXCLUDED.format`,
      [data.episodeId, data.filePath, data.language, data.format]
    ),

  deleteByEpisodeId: (db: DatabaseWrapper, episodeId: number) =>
    dbRun(db, 'DELETE FROM local_subtitles WHERE episodeId = ?', [episodeId]),

  deleteByEpisodeIds: (db: DatabaseWrapper, episodeIds: number[]) => {
    if (episodeIds.length === 0) return
    const placeholders = episodeIds.map(() => '?').join(',')
    dbRun(db, `DELETE FROM local_subtitles WHERE episodeId IN (${placeholders})`, episodeIds)
  },

  deleteByFilePaths: (db: DatabaseWrapper, filePaths: string[]) => {
    if (filePaths.length === 0) return
    const placeholders = filePaths.map(() => '?').join(',')
    dbRun(db, `DELETE FROM local_subtitles WHERE filePath IN (${placeholders})`, filePaths)
  },
}
