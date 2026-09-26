import { initTRPC } from '@trpc/server'
import type { TrpcContext } from './context.js'
import { lanAuthRequiredError } from './errors.js'

const t = initTRPC.context<TrpcContext>().create({
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      cause: error.cause ?? null,
    },
  }),
})

export const router = t.router
export const publicProcedure = t.procedure

const lanGuard = t.middleware(({ ctx, next }) => {
  if (!ctx.lanAuthed) throw lanAuthRequiredError()
  return next({ ctx })
})

export const protectedProcedure = t.procedure.use(lanGuard)
