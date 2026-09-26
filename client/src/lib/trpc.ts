import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { createTRPCContext } from '@trpc/tanstack-react-query'
import type { AppRouter } from '../../../server/src/trpc/router.js'
import { emitAuthRequired } from './auth-bus'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function trpcFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const target = typeof url === 'string' ? url : url.toString()
  const isLocalEndpoint =
    target.startsWith('/') ||
    (typeof window !== 'undefined' && target.startsWith(window.location.origin))

  if (isLocalEndpoint) {
    const animepaheUa = localStorage.getItem('animepahe_ua')
    const animepaheCookie = localStorage.getItem('animepahe_cookie')
    const jasmrUa = localStorage.getItem('jasmr_ua')
    const jasmrCookie = localStorage.getItem('jasmr_cookie')

    if (animepaheUa) headers['x-animepahe-ua'] = animepaheUa
    if (animepaheCookie) headers['x-animepahe-cookie'] = animepaheCookie
    if (jasmrUa) headers['x-jasmr-ua'] = jasmrUa
    if (jasmrCookie) headers['x-jasmr-cookie'] = jasmrCookie
  }

  let response = await fetch(url, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  })

  for (let attempt = 0; response.status === 503 && attempt < 8; attempt++) {
    await sleep(Math.min(500 * 2 ** attempt, 4000))
    response = await fetch(url, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    })
  }

  if (response.status === 401) {
    try {
      const data = (await response.clone().json()) as { error?: unknown }
      if (data?.error === 'LAN_AUTH_REQUIRED') emitAuthRequired('lan')
    } catch {
      // ignore
    }
  }

  await emitAuthFromTrpcBody(response)

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

export async function emitAuthFromTrpcBody(response: Response): Promise<void> {
  try {
    if (!response.headers.get('content-type')?.includes('json')) return
    const body: unknown = await response.clone().json()
    const items = Array.isArray(body) ? body : [body]
    for (const item of items) {
      const err = (item as TrpcErrorEnvelope)?.error
      if (!err || typeof err !== 'object') continue
      const cause = err.data?.cause
      if (err.message === 'AUTH_REQUIRED' || cause?.code === 'AUTH_REQUIRED') {
        if (cause?.provider === 'animepahe' || cause?.provider === 'jasmr') {
          emitAuthRequired(cause.provider)
        }
      }
      if (err.message === 'LAN_AUTH_REQUIRED' || cause?.code === 'LAN_AUTH_REQUIRED') {
        emitAuthRequired('lan')
      }
    }
  } catch {
    // ignore
  }
}

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>()

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/api/trpc',
      fetch: trpcFetch,
    }),
  ],
})
