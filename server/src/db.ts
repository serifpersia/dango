import { DatabaseSync, StatementSync } from 'node:sqlite'
import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'fs'
import path from 'path'
import logger from './logger.js'

type BindableValue = string | number | bigint | null | Uint8Array

const txOwner = new AsyncLocalStorage<DatabaseWrapper>()

export class DatabaseWrapper {
  private db: DatabaseSync
  private isClosed = false
  private statementCache = new Map<string, StatementSync>()
  private txDepth = 0
  private txQueue: Promise<void> = Promise.resolve()

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
    const outer = this.txDepth === 0
    const level = this.txDepth
    this.run(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT dango_sp_${level}`)
    this.txDepth = level + 1
    try {
      txOwner.run(this, cb)
    } catch (e) {
      this.txDepth = level
      try {
        this.run(outer ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT dango_sp_${level}`)
      } catch {
        // ignore
      }
      throw e
    }
    this.txDepth = level
    this.run(outer ? 'COMMIT' : `RELEASE SAVEPOINT dango_sp_${level}`)
  }

  private acquireTxQueue(): Promise<() => void> {
    const prev = this.txQueue
    let release!: () => void
    const current = new Promise<void>((res) => {
      release = res
    })
    this.txQueue = prev.then(() => current)
    return prev.then(() => release)
  }

  public async transact(fn: (tx: DatabaseWrapper) => Promise<void>): Promise<void> {
    if (txOwner.getStore() === this) {
      const level = this.txDepth
      this.run(`SAVEPOINT dango_sp_${level}`)
      this.txDepth = level + 1
      try {
        await fn(this)
      } catch (e) {
        this.txDepth = level
        try {
          this.run(`ROLLBACK TO SAVEPOINT dango_sp_${level}`)
        } catch {
          // ignore
        }
        throw e
      }
      this.txDepth = level
      this.run(`RELEASE SAVEPOINT dango_sp_${level}`)
      return
    }
    const release = await this.acquireTxQueue()
    try {
      await txOwner.run(this, async () => {
        this.run('BEGIN IMMEDIATE')
        this.txDepth = 1
        try {
          await fn(this)
        } catch (e) {
          this.txDepth = 0
          try {
            this.run('ROLLBACK')
          } catch {
            // ignore
          }
          throw e
        }
        this.txDepth = 0
        this.run('COMMIT')
      })
    } finally {
      release()
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
