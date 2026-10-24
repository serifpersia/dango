import { initTRPC } from '@trpc/server'
import type { TrpcContext } from './context.js'
import { lanAuthRequiredError } from './errors.js'
import { TRPCError } from '@trpc/server'
import { profileScope } from '../profile-scope.js'

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
export const mergeRouters = t.mergeRouters

const lanGuard = t.middleware(({ ctx, next }) => {
  if (!ctx.lanAuthed) throw lanAuthRequiredError()
  return next({ ctx })
})

export const protectedProcedure = t.procedure.use(lanGuard)
export const ownerProcedure = protectedProcedure.use(({ next }) => {
  if (profileScope.getStore()?.owner === false)
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner access required' })
  return next()
})
