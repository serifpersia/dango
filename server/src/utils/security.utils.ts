import { Request, Response, NextFunction } from 'express'
import { CONFIG } from '../config'

export function isSafeExternalUrl(rawUrl: unknown): { safe: boolean; url?: URL; error?: string } {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return { safe: false, error: 'URL required' }
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return { safe: false, error: 'Invalid URL format' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, error: 'Only http and https protocols are supported' }
  }

  const hostname = parsed.hostname.toLowerCase()

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return { safe: false, error: 'Access to loopback/local addresses is forbidden' }
  }

  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4Match) {
    const o1 = Number(ipv4Match[1])
    const o2 = Number(ipv4Match[2])
    const o3 = Number(ipv4Match[3])
    const o4 = Number(ipv4Match[4])

    if ([o1, o2, o3, o4].some((o) => o < 0 || o > 255)) {
      return { safe: false, error: 'Invalid IP address format' }
    }

    if (
      o1 === 0 ||
      o1 === 10 ||
      o1 === 127 ||
      (o1 === 172 && o2 >= 16 && o2 <= 31) ||
      (o1 === 192 && o2 === 168) ||
      (o1 === 169 && o2 === 254)
    ) {
      return { safe: false, error: 'Access to private or link-local IP addresses is forbidden' }
    }
  }

  if (hostname.startsWith('[') || hostname.includes(':')) {
    const cleanIpv6 = hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (
      cleanIpv6 === '::1' ||
      cleanIpv6 === '::' ||
      cleanIpv6.startsWith('fe80:') ||
      cleanIpv6.startsWith('fc00:') ||
      cleanIpv6.startsWith('fd00:') ||
      cleanIpv6.startsWith('::ffff:127.') ||
      cleanIpv6.startsWith('::ffff:192.168.') ||
      cleanIpv6.startsWith('::ffff:10.') ||
      cleanIpv6.startsWith('::ffff:172.') ||
      cleanIpv6.startsWith('::ffff:169.254.')
    ) {
      return { safe: false, error: 'Access to private or link-local IPv6 addresses is forbidden' }
    }
  }

  return { safe: true, url: parsed }
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true // Non-browser clients, same-origin, or mobile webview

  try {
    const parsed = new URL(origin)
    const host = parsed.hostname.toLowerCase()
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1'

    if (CONFIG.HOST === '0.0.0.0') {
      return true
    }

    return isLocal
  } catch {
    return false
  }
}

export function crossSiteProtectionMiddleware(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase()
  const isMutating = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)

  if (!isMutating) return next()

  const secFetchSite = req.headers['sec-fetch-site']
  if (secFetchSite === 'cross-site') {
    const origin = req.headers.origin
    if (!isAllowedOrigin(origin)) {
      return res.status(403).json({ error: 'Forbidden: cross-site request rejected' })
    }
  }

  const origin = req.headers.origin
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Forbidden: cross-origin request rejected' })
  }

  next()
}
