import { DatabaseSync, StatementSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import logger from './logger.js'

type BindableValue = string | number | bigint | null | Uint8Array

export class DatabaseWrapper {
  private db: DatabaseSync
  private isClosed = false
  private statementCache = new Map<string, StatementSync>()

  constructor(_dbPath: string, db: DatabaseSync) {
    this.db = db
  }

  public static async create(dbPath: string): Promise<DatabaseWrapper> {
    try {
      const dir = path.dirname(dbPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      const db = new DatabaseSync(dbPath)
      return new DatabaseWrapper(dbPath, db)
    } catch (e) {
      logger.error({ err: e }, `Failed to initialize database at ${dbPath}`)
      throw e
    }
  }

  public scheduleSave() {}

  public async saveNow() {}

  public configure(option: string, value: unknown) {
    if (option === 'busyTimeout') {
      this.db.exec(`PRAGMA busy_timeout = ${value}`)
    }
  }

  public serialize(cb: () => void) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      cb()
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  public close(cb?: (err: Error | null) => void) {
    if (this.isClosed) {
      if (cb) cb(null)
      return
    }
    try {
      this.isClosed = true
      this.statementCache.clear()
      this.db.close()
      if (cb) cb(null)
    } catch (e) {
      logger.error({ err: e }, 'Error during database close')
      if (cb) cb(e as Error)
    }
  }

  public isClosedCheck(): boolean {
    return this.isClosed
  }

  private getPreparedStatement(query: string): StatementSync {
    let stmt = this.statementCache.get(query)
    if (!stmt) {
      if (this.statementCache.size > 100) {
        this.statementCache.clear()
      }
      stmt = this.db.prepare(query)
      this.statementCache.set(query, stmt)
    }
    return stmt
  }

  public run(query: string, params: BindableValue[] = []): void {
    if (this.isClosed) {
      throw new Error('Database is closed')
    }
    const stmt = this.getPreparedStatement(query)
    if (params.length > 0) {
      stmt.run(...params)
    } else {
      stmt.run()
    }
  }

  public get<T = unknown>(query: string, params: BindableValue[] = []): T | undefined {
    if (this.isClosed) {
      throw new Error('Database is closed')
    }
    const stmt = this.getPreparedStatement(query)
    if (params.length > 0) {
      return stmt.get(...params) as T | undefined
    }
    return stmt.get() as T | undefined
  }

  public all<T = unknown>(query: string, params: BindableValue[] = []): T[] {
    if (this.isClosed) {
      throw new Error('Database is closed')
    }
    const stmt = this.getPreparedStatement(query)
    if (params.length > 0) {
      return stmt.all(...params) as T[]
    }
    return stmt.all() as T[]
  }

  public prepare(query: string) {
    const stmt = this.getPreparedStatement(query)

    return {
      run: (...args: BindableValue[]) => {
        stmt.run(...args)
      },
      all: <T = unknown>(): T[] => {
        return stmt.all() as T[]
      },
      get: <T = unknown>(): T | undefined => {
        return stmt.get() as T | undefined
      },
      finalize: () => {},
    }
  }

  public backup(backupPath: string) {
    try {
      if (fs.existsSync(backupPath)) {
        fs.rmSync(backupPath, { force: true })
      }
      this.db.exec(`VACUUM INTO '${backupPath}'`)
    } catch (e) {
      logger.error({ err: e, backupPath }, 'Database backup failed via VACUUM INTO')
      throw e
    }
  }

  public checkpoint() {
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch (e) {
      logger.error({ err: e }, 'Database WAL checkpoint failed')
      throw e
    }
  }
}
