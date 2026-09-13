import { createHmac } from 'node:crypto'

const MEGAPLAY_CDN_TOKEN_KEY = 'MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s'

export const MEGAPLAY_CDN_TOKEN_TTL_SECONDS = 120

export const MEGAPLAY_ORIGIN = 'https://megaplay.buzz'
export const MEGAPLAY_REFERER = 'https://megaplay.buzz/'

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function isNexabloomMasterUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.hostname.toLowerCase().endsWith('nexabloom.top') &&
      parsed.pathname.includes('master.m3u8')
    )
  } catch {
    return false
  }
}

export function signNexabloomMasterUrl(
  masterUrl: string,
  ttlSeconds: number = MEGAPLAY_CDN_TOKEN_TTL_SECONDS
): string {
  const match = masterUrl.match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i)
  if (!match) return masterUrl

  const path = `${match[1].toLowerCase()}/${match[2].toLowerCase()}`
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds
  const message = `${expires}|${path}`
  const signature = base64UrlEncode(
    createHmac('sha256', MEGAPLAY_CDN_TOKEN_KEY).update(message).digest()
  )
  const token = `${base64UrlEncode(message)}.${signature}`

  try {
    const parsed = new URL(masterUrl)
    parsed.searchParams.set('token', token)
    return parsed.href
  } catch {
    const separator = masterUrl.includes('?') ? '&' : '?'
    return `${masterUrl}${separator}token=${encodeURIComponent(token)}`
  }
}
