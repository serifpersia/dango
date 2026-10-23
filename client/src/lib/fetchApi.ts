import { emitAuthRequired } from './auth-bus'

const sleep = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })

export const fetchWithLocalHeaders = async (
  url: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const request = url instanceof Request ? url : undefined
  const headers = new Headers(request?.headers)
  if (!init?.body || !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  const target = request?.url ?? url.toString()
  const isLocalEndpoint =
    (target.startsWith('/') && !target.startsWith('//')) ||
    (typeof window !== 'undefined' &&
      new URL(target, window.location.origin).origin === window.location.origin)

  if (isLocalEndpoint) {
    const animepaheUa = localStorage.getItem('animepahe_ua')
    const animepaheCookie = localStorage.getItem('animepahe_cookie')
    const jasmrUa = localStorage.getItem('jasmr_ua')
    const jasmrCookie = localStorage.getItem('jasmr_cookie')

    if (animepaheUa) headers.set('x-animepahe-ua', animepaheUa)
    if (animepaheCookie) headers.set('x-animepahe-cookie', animepaheCookie)
    if (jasmrUa) headers.set('x-jasmr-ua', jasmrUa)
    if (jasmrCookie) headers.set('x-jasmr-cookie', jasmrCookie)
  }
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value))
  const options = { ...init, headers }
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
  const signal = init?.signal ?? request?.signal
  const canRetry = isLocalEndpoint && (method === 'GET' || method === 'HEAD')

  let response = await fetch(url, options)

  for (
    let attempt = 0;
    canRetry &&
    response.status === 503 &&
    response.headers.get('x-dango-not-ready') === '1' &&
    attempt < 3;
    attempt++
  ) {
    await response.body?.cancel()
    await sleep(500 * 2 ** attempt, signal)
    response = await fetch(url, options)
  }

  return response
}

export const fetchApi = async (url: string, init?: RequestInit) => {
  const response = await fetchWithLocalHeaders(url, init)

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(text)
    } catch {
      // ignore
    }

    const errorMsg = typeof data.error === 'string' ? data.error : ''

    if (response.status === 403 && errorMsg === 'AUTH_REQUIRED' && data.provider === 'animepahe') {
      emitAuthRequired('animepahe')
    }
    if (response.status === 403 && errorMsg === 'AUTH_REQUIRED' && data.provider === 'jasmr') {
      emitAuthRequired('jasmr')
    }
    if (response.status === 401 && errorMsg === 'LAN_AUTH_REQUIRED') {
      emitAuthRequired('lan')
    }

    throw new Error(errorMsg || `Failed to fetch from ${url}`)
  }
  return response.json()
}
