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
