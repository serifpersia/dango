import { protectedProcedure } from '../index.js'
import type { DatabaseWrapper } from '../../db.js'
import type { TrpcContext } from '../context.js'
import { badRequest, unavailable } from '../errors.js'
import {
  defineSchema,
  optStr,
  readIds,
  readLimit,
  readPage,
  reqObj,
  reqStr,
  type Schema,
} from '../validation.js'

export type LibraryRow = { status?: string | null }

export type LibraryRepo<Row extends LibraryRow> = {
  getById: (db: DatabaseWrapper, id: string) => Row | undefined | Promise<Row | undefined>
  getAll: (
    db: DatabaseWrapper,
    status?: string,
    limit?: number,
    offset?: number
  ) => Row[] | Promise<Row[]>
  getCount: (db: DatabaseWrapper, status?: string) => number | Promise<number>
  getIds: (db: DatabaseWrapper) => string[] | Promise<string[]>
  updateStatus: (db: DatabaseWrapper, id: string, status: string) => unknown
  updateStatusMany: (db: DatabaseWrapper, ids: string[], status: string) => unknown
  delete: (db: DatabaseWrapper, id: string) => unknown
  deleteMany: (db: DatabaseWrapper, ids: string[]) => unknown
}

export type LibraryRouterConfig<Row extends LibraryRow, Add, In extends { status?: unknown }> = {
  db: (ctx: TrpcContext) => DatabaseWrapper
  write: (db: DatabaseWrapper, runnable: (tx: DatabaseWrapper) => Promise<void>) => Promise<void>
  repo: LibraryRepo<Row> & { upsert: (db: DatabaseWrapper, data: Add) => unknown }
  progress: {
    deleteByKey: (db: DatabaseWrapper, id: string) => unknown
    deleteMany: (db: DatabaseWrapper, ids: string[]) => unknown
  }
  statuses: readonly string[]
  afterSave?: (ctx: TrpcContext, id: string) => void
  defaultStatus: string
  add: {
    input: Schema<In, In>
    build: (input: In, status: string) => { id: string; row: Add }
  }
}

const listInput = () =>
  defineSchema<
    { status?: string; page: number; limit: number },
    { status?: string; page: number; limit: number }
  >((value) => {
    const obj = reqObj(value)
    return {
      status: optStr(obj, 'status'),
      page: readPage(obj),
      limit: readLimit(obj, 24, 100),
    }
  })

const idInput = () =>
  defineSchema<{ id: string }, { id: string }>((value) => ({
    id: reqStr(reqObj(value), 'id'),
  }))

const removeInput = () =>
  defineSchema<string | { id: string }, string>((value) => {
    if (typeof value === 'string') {
      if (value.length === 0) throw badRequest('id must be a string')
      return value
    }
    return reqStr(reqObj(value), 'id')
  })

const removeManyInput = () =>
  defineSchema<string[] | { ids: string[] }, string[]>((value) => readIds(value))

const statusInput = () =>
  defineSchema<{ id: string; status: string }, { id: string; status: string }>((value) => {
    const obj = reqObj(value)
    return { id: reqStr(obj, 'id'), status: reqStr(obj, 'status') }
  })

const batchStatusInput = () =>
  defineSchema<{ ids: string[]; status: string }, { ids: string[]; status: string }>((value) => {
    const obj = reqObj(value)
    return { ids: readIds(obj), status: reqStr(obj, 'status') }
  })

export function createLibraryRouter<Row extends LibraryRow, Add, In extends { status?: unknown }>(
  config: LibraryRouterConfig<Row, Add, In>
) {
  const { repo, progress, statuses, defaultStatus } = config

  const kindDb = (ctx: TrpcContext): DatabaseWrapper => {
    const db = config.db(ctx)
    if (!db || db.isClosedCheck()) {
      throw unavailable('database is not ready')
    }
    return db
  }

  return {
    list: protectedProcedure.input(listInput()).query(async ({ ctx, input }) => {
      const offset = (input.page - 1) * input.limit
      const rows = await repo.getAll(kindDb(ctx), input.status, input.limit, offset)
      const total = await repo.getCount(kindDb(ctx), input.status)
      return { data: rows, total, page: input.page, limit: input.limit }
    }),

    ids: protectedProcedure.query(async ({ ctx }) => ({ ids: await repo.getIds(kindDb(ctx)) })),

    check: protectedProcedure.input(idInput()).query(async ({ ctx, input }) => {
      const item = await repo.getById(kindDb(ctx), input.id)
      return { inLibrary: !!item, status: item?.status ?? null }
    }),

    add: protectedProcedure.input(config.add.input).mutation(async ({ ctx, input }) => {
      const value = input as In
      const status =
        typeof value.status === 'string' && statuses.includes(value.status)
          ? value.status
          : defaultStatus
      const { id, row } = config.add.build(value, status)
      await config.write(kindDb(ctx), async (tx) => {
        await repo.upsert(tx, row)
      })
      config.afterSave?.(ctx, id)
      return { success: true, id }
    }),

    remove: protectedProcedure.input(removeInput()).mutation(async ({ ctx, input }) => {
      await config.write(kindDb(ctx), async (tx) => {
        await repo.delete(tx, input)
        await progress.deleteByKey(tx, input)
      })
      return { success: true }
    }),

    setStatus: protectedProcedure.input(statusInput()).mutation(async ({ ctx, input }) => {
      if (!statuses.includes(input.status)) {
        throw badRequest('id and a valid status are required')
      }
      await config.write(kindDb(ctx), async (tx) => {
        await repo.updateStatus(tx, input.id, input.status)
      })
      config.afterSave?.(ctx, input.id)
      return { success: true }
    }),

    batchStatus: protectedProcedure.input(batchStatusInput()).mutation(async ({ ctx, input }) => {
      if (!statuses.includes(input.status)) {
        throw badRequest('a valid status is required')
      }
      const ids = input.ids.map((id) => String(id))
      await config.write(kindDb(ctx), async (tx) => {
        await repo.updateStatusMany(tx, ids, input.status)
      })
      for (const id of ids) config.afterSave?.(ctx, id)
      return { success: true, updated: ids.length }
    }),

    removeMany: protectedProcedure.input(removeManyInput()).mutation(async ({ ctx, input }) => {
      const ids = input.map((id) => String(id))
      await config.write(kindDb(ctx), async (tx) => {
        await repo.deleteMany(tx, ids)
        await progress.deleteMany(tx, ids)
      })
      return { success: true, removed: ids.length }
    }),
  }
}
