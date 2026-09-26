import { TRPCError } from '@trpc/server'

export type AuthErrorCause =
  { code: 'AUTH_REQUIRED'; provider: string } | { code: 'LAN_AUTH_REQUIRED' }

export function isAuthErrorCause(value: unknown): value is AuthErrorCause {
  if (typeof value !== 'object' || value === null) return false
  const code = (value as Record<string, unknown>).code
  return code === 'AUTH_REQUIRED' || code === 'LAN_AUTH_REQUIRED'
}

export function authRequiredError(provider: string): TRPCError {
  return new TRPCError({
    code: 'FORBIDDEN',
    message: 'AUTH_REQUIRED',
    cause: { code: 'AUTH_REQUIRED', provider } satisfies AuthErrorCause,
  })
}

export function lanAuthRequiredError(): TRPCError {
  return new TRPCError({
    code: 'UNAUTHORIZED',
    message: 'LAN_AUTH_REQUIRED',
    cause: { code: 'LAN_AUTH_REQUIRED' } satisfies AuthErrorCause,
  })
}
