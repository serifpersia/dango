import { emitAuthRequired } from './auth-bus'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const fetchWithLocalHeaders = async (
  url: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
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
