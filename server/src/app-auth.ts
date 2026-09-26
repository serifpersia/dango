import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { CONFIG } from './config.js'

export const LAN_AUTH_COOKIE = 'dango_lan_auth'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function sessionsFile() {
  return path.join(CONFIG.ROOT, 'lan_sessions.json')
}

function loadSessions(): Record<string, number> {
  try {
    if (!fs.existsSync(sessionsFile())) return {}
    const raw = fs.readFileSync(sessionsFile(), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, number>
    const now = Date.now()
    let dirty = false
    for (const [token, expiry] of Object.entries(parsed)) {
      if (typeof expiry !== 'number' || expiry < now) {
        delete parsed[token]
        dirty = true
      }
    }
    if (dirty) saveSessions(parsed)
    return parsed
  } catch {
    return {}
  }
}

function saveSessions(sessions: Record<string, number>) {
  try {
    fs.mkdirSync(CONFIG.ROOT, { recursive: true })
    fs.writeFileSync(sessionsFile(), JSON.stringify(sessions))
  } catch {
    // ignore
  }
}

export function getAppPasswordHash(): string {
  return process.env.APP_PASSWORD_HASH || CONFIG.APP_PASSWORD_HASH || ''
}

export function hasAppPassword(): boolean {
  return !!getAppPasswordHash()
}

export function hashAppPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 32).toString('hex')
  return `scrypt:${salt}:${hash}`
}

export function verifyAppPassword(password: string): boolean {
  const stored = getAppPasswordHash()
  if (!stored) return false
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, salt, expectedHex] = parts
  try {
    const derived = crypto.scryptSync(password, salt, 32)
    const expected = Buffer.from(expectedHex, 'hex')
    if (derived.length !== expected.length) return false
    return crypto.timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

export async function setAppPassword(password: string): Promise<void> {
  const { updateEnvFile } = await import('./utils/env.utils.js')
  if (!password) {
    await updateEnvFile({ APP_PASSWORD_HASH: '' })
    ;(CONFIG as { APP_PASSWORD_HASH: string }).APP_PASSWORD_HASH = ''
    return
  }
  const hash = hashAppPassword(password)
  await updateEnvFile({ APP_PASSWORD_HASH: hash })
  ;(CONFIG as { APP_PASSWORD_HASH: string }).APP_PASSWORD_HASH = hash
}

export function createLanSession(): { token: string; expiry: number } {
  const token = crypto.randomBytes(32).toString('hex')
  const expiry = Date.now() + SESSION_TTL_MS
  const sessions = loadSessions()
  sessions[token] = expiry
  saveSessions(sessions)
  return { token, expiry }
}

export function validateLanSession(token: string | undefined | null): boolean {
  if (!token) return false
  const sessions = loadSessions()
  const expiry = sessions[token]
  if (!expiry) return false
  if (expiry < Date.now()) {
    delete sessions[token]
    saveSessions(sessions)
    return false
  }
  return true
}

export function revokeLanSession(token: string | undefined | null) {
  if (!token) return
  const sessions = loadSessions()
  if (sessions[token]) {
    delete sessions[token]
    saveSessions(sessions)
  }
}

export function clearAllLanSessions() {
  saveSessions({})
}

export function normalizeClientIp(ip: string | undefined): string {
  if (!ip) return ''
  if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length)
  return ip
}

export function isLoopbackIp(ip: string | undefined): boolean {
  const normalized = normalizeClientIp(ip)
  return normalized === '127.0.0.1' || normalized === '::1'
}

export function getTokenFromHeaders(
  authorization: string | undefined,
  cookieHeader: string | undefined
): string | null {
  if (authorization && authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim() || null
  }
  if (cookieHeader) {
    const parts = cookieHeader.split(';')
    for (const part of parts) {
      const idx = part.indexOf('=')
      if (idx === -1) continue
      const name = part.slice(0, idx).trim()
      if (name === LAN_AUTH_COOKIE) {
        return decodeURIComponent(part.slice(idx + 1).trim()) || null
      }
    }
  }
  return null
}

export const LAN_AUTH_PUBLIC_PATHS = new Set([
  '/api/auth/app-status',
  '/api/auth/app-login',
  '/api/auth/app-logout',
  '/api/internal/shutdown',
])

export function buildLanCookie(token: string, expiry: number): string {
  const maxAge = Math.max(1, Math.floor((expiry - Date.now()) / 1000))
  return `${LAN_AUTH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`
}

export function clearLanCookie(): string {
  return `${LAN_AUTH_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
}
