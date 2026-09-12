import { DatabaseWrapper } from '../db'
import { dbAll, dbGet, dbRun } from '../utils/db-utils'

export interface LocalShowMapping {
  localId: string
  anilistId: number | null
  malId: number | null
  folderPath: string
  folderName: string
  detectedTitle: string
  detectedSeason: number
  scanTime: string
}

export const LocalShowMappingRepository = {
  getById: (db: DatabaseWrapper, localId: string) =>
    dbGet<LocalShowMapping>(db, 'SELECT * FROM local_show_mapping WHERE localId = ?', [localId]),

  getByFolderPath: (db: DatabaseWrapper, folderPath: string) =>
    dbGet<LocalShowMapping>(db, 'SELECT * FROM local_show_mapping WHERE folderPath = ?', [
      folderPath,
    ]),

  getByAnilistId: (db: DatabaseWrapper, anilistId: number) =>
    dbGet<LocalShowMapping>(db, 'SELECT * FROM local_show_mapping WHERE anilistId = ?', [
      anilistId,
    ]),

  getByMalId: (db: DatabaseWrapper, malId: number) =>
    dbGet<LocalShowMapping>(db, 'SELECT * FROM local_show_mapping WHERE malId = ?', [malId]),

  getAll: (db: DatabaseWrapper) =>
    dbAll<LocalShowMapping>(db, 'SELECT * FROM local_show_mapping ORDER BY folderName'),

  getUnmatched: (db: DatabaseWrapper) =>
    dbAll<LocalShowMapping>(
      db,
      'SELECT * FROM local_show_mapping WHERE anilistId IS NULL AND malId IS NULL ORDER BY folderName'
    ),

  upsert: (
    db: DatabaseWrapper,
    data: {
      localId: string
      folderPath: string
      folderName: string
      detectedTitle: string
      detectedSeason?: number
      anilistId?: number | null
      malId?: number | null
    }
  ) =>
    dbRun(
      db,
      `INSERT INTO local_show_mapping (localId, anilistId, malId, folderPath, folderName, detectedTitle, detectedSeason, scanTime)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(localId) DO UPDATE SET
          anilistId = COALESCE(EXCLUDED.anilistId, local_show_mapping.anilistId),
          malId = COALESCE(EXCLUDED.malId, local_show_mapping.malId),
          folderPath = EXCLUDED.folderPath,
          folderName = EXCLUDED.folderName,
          detectedTitle = EXCLUDED.detectedTitle,
          detectedSeason = EXCLUDED.detectedSeason,
          scanTime = CURRENT_TIMESTAMP`,
      [
        data.localId,
        data.anilistId ?? null,
        data.malId ?? null,
        data.folderPath,
        data.folderName,
        data.detectedTitle,
        data.detectedSeason ?? 1,
      ]
    ),

  updateAnilistId: (db: DatabaseWrapper, localId: string, anilistId: number) =>
    dbRun(db, 'UPDATE local_show_mapping SET anilistId = ? WHERE localId = ?', [
      anilistId,
      localId,
    ]),

  updateMalId: (db: DatabaseWrapper, localId: string, malId: number) =>
    dbRun(db, 'UPDATE local_show_mapping SET malId = ? WHERE localId = ?', [malId, localId]),

  clearLinks: (db: DatabaseWrapper, localId: string) =>
    dbRun(db, 'UPDATE local_show_mapping SET anilistId = NULL, malId = NULL WHERE localId = ?', [
      localId,
    ]),

  delete: (db: DatabaseWrapper, localId: string) =>
    dbRun(db, 'DELETE FROM local_show_mapping WHERE localId = ?', [localId]),

  deleteByFolderPath: (db: DatabaseWrapper, folderPath: string) =>
    dbRun(db, 'DELETE FROM local_show_mapping WHERE folderPath = ?', [folderPath]),
}
