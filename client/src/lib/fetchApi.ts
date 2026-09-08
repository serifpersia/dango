import { emitAuthRequired } from './auth-bus'

export const fetchApi = async (url: string) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const isLocalEndpoint =
    url.startsWith('/') || (typeof window !== 'undefined' && url.startsWith(window.location.origin))

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

  const response = await fetch(url, { headers })

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
