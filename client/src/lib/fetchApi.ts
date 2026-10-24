import { profileStorage } from './profileStorage'
import { emitAuthRequired } from './auth-bus'
import toast from 'react-hot-toast'
import { getActiveProfileId } from './profileStorage'

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
    if (
      !target.includes('/api/profiles/status') &&
      !target.includes('/api/profiles/login') &&
      !target.includes('/api/auth/app-')
    )
      headers.set('x-dango-profile-id', getActiveProfileId())
    let animepaheUa = profileStorage.getItem('animepahe_ua')
    let animepaheCookie = profileStorage.getItem('animepahe_cookie')
    if (animepaheCookie && animepaheUa && animepaheUa !== navigator.userAgent) {
      profileStorage.removeItem('animepahe_cookie')
      profileStorage.removeItem('animepahe_ua')
      animepaheCookie = null
      animepaheUa = null
      toast.error('Your browser changed. Verify AnimePahe again to refresh its cookie.')
      emitAuthRequired('animepahe')
    }
    const jasmrUa = profileStorage.getItem('jasmr_ua')
    const jasmrCookie = profileStorage.getItem('jasmr_cookie')

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
  if (isLocalEndpoint && response.status === 409) {
    const body = await response
      .clone()
      .json()
      .catch(() => null)
    if (body?.error === 'PROFILE_CHANGED') window.location.reload()
  }
  if (isLocalEndpoint && response.status === 401 && !target.includes('/api/profiles/')) {
    const body = await response
      .clone()
      .json()
      .catch(() => null)
    if (body?.error === 'PROFILE_AUTH_REQUIRED')
      window.dispatchEvent(new Event('dango:profile-auth-required'))
  }

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
