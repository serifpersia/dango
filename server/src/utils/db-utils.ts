import { DatabaseWrapper } from '../db.js'

export const dbAll = <T = unknown>(
  db: DatabaseWrapper,
  sql: string,
  params: unknown[] = []
): T[] => {
  return db.all<T>(sql, params as (string | number | bigint | null | Uint8Array)[])
}

export const dbGet = <T = unknown>(
  db: DatabaseWrapper,
  sql: string,
  params: unknown[] = []
): T | undefined => {
  return db.get<T>(sql, params as (string | number | bigint | null | Uint8Array)[])
}

export const dbRun = (db: DatabaseWrapper, sql: string, params: unknown[] = []): void => {
  db.run(sql, params as (string | number | bigint | null | Uint8Array)[])
}

export async function adultNonListIds(
  db: DatabaseWrapper,
  progressTable: 'tv_progress' | 'manga_progress' | 'asmr_progress',
  libraryTable: 'tv_library' | 'manga_library' | 'asmr_library',
  keyCol: 'mediaId' | 'mangaId' | 'workId',
  adultPred: string
): Promise<string[]> {
  const rows = await dbAll<{ id: string }>(
    db,
    `SELECT DISTINCT p."${keyCol}" as id
       FROM "${progressTable}" p
       LEFT JOIN "${libraryTable}" l ON l.id = p."${keyCol}"
       WHERE ${adultPred}
         AND l.id IS NULL`
  )
  return rows.map((r) => r.id)
}
