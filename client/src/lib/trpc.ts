import { createTRPCClient, httpBatchStreamLink } from '@trpc/client'
import { createTRPCContext } from '@trpc/tanstack-react-query'
import type { AppRouter } from '../../../server/src/trpc/router.js'
export type { RouterOutputs } from '../../../server/src/trpc/router.js'
import { emitAuthRequired } from './auth-bus'
import { fetchWithLocalHeaders } from './fetchApi'

async function trpcFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetchWithLocalHeaders(url, init)
  const ct = response.headers.get('content-type') || ''

  if (ct.includes('json')) {
    const text = await response.text()
    emitAuthFromTrpcBodyText(text)
    return new Response(text, response)
  }

  return response
}

type TrpcErrorEnvelope = {
  error?: {
    message?: unknown
    data?: {
      cause?: { code?: unknown; provider?: unknown } | null
    }
  }
}

function emitFromEnvelope(err: unknown): void {
  if (!err || typeof err !== 'object') return
  const e = err as TrpcErrorEnvelope['error']
  if (!e || typeof e !== 'object') return
  const cause = e.data?.cause
  if (
    (e.message === 'AUTH_REQUIRED' || cause?.code === 'AUTH_REQUIRED') &&
    typeof cause?.provider === 'string'
  ) {
    emitAuthRequired(cause.provider)
  }
  if (e.message === 'LAN_AUTH_REQUIRED' || cause?.code === 'LAN_AUTH_REQUIRED') {
    emitAuthRequired('lan')
  }
}

function scanForAuth(value: unknown, depth = 0): void {
  if (depth > 8 || value == null) return
  if (Array.isArray(value)) {
    for (const v of value) scanForAuth(v, depth + 1)
    return
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (obj.error && typeof obj.error === 'object') emitFromEnvelope(obj.error)
    for (const v of Object.values(obj)) scanForAuth(v, depth + 1)
  }
}

export async function emitAuthFromTrpcBody(response: Response): Promise<void> {
  try {
    if (!response.headers.get('content-type')?.includes('json')) return
    emitAuthFromTrpcBodyText(await response.clone().text())
  } catch {
    // ignore
  }
}

function emitAuthFromTrpcBodyText(text: string): void {
  try {
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      body = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)]
          } catch {
            return []
          }
        })
    }
    scanForAuth(body)
  } catch {
    // ignore
  }
}

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>()

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchStreamLink({
      url: '/api/trpc',
      fetch: trpcFetch,
      headers: { 'x-no-compression': '1' },
    }),
  ],
})
