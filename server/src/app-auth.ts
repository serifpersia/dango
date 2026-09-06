import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { Request, Response, NextFunction } from 'express'
import { CONFIG } from './config'

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
    // sessions won't be saved if disk write fails
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
  const { updateEnvFile } = await import('./utils/env.utils')
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

function normalizeIp(ip: string | undefined): string {
  if (!ip) return ''
  if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length)
  return ip
}

export function isLoopbackRequest(req: Request): boolean {
  const candidates = [req.ip, req.socket?.remoteAddress].map((v) => normalizeIp(v as string))
  return candidates.includes('127.0.0.1') || candidates.includes('::1')
}

export function getRequestToken(req: Request): string | null {
  const auth = req.headers.authorization
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim() || null
  }
  const cookieHeader = req.headers.cookie
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

export function isLanAuthenticated(req: Request): boolean {
  if (!hasAppPassword()) return true
  return validateLanSession(getRequestToken(req))
}

const PUBLIC_PATHS = new Set([
  '/api/auth/app-status',
  '/api/auth/app-login',
  '/api/auth/app-logout',
  '/api/internal/shutdown',
])

export function lanAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith('/api/')) return next()
  if (PUBLIC_PATHS.has(req.path)) return next()
  if (req.path.startsWith('/api/internal/') && isLoopbackRequest(req)) return next()
  if (!hasAppPassword()) return next()
  if (validateLanSession(getRequestToken(req))) return next()
  return res.status(401).json({ error: 'LAN_AUTH_REQUIRED' })
}

export function buildLanCookie(token: string, expiry: number): string {
  const maxAge = Math.max(1, Math.floor((expiry - Date.now()) / 1000))
  return `${LAN_AUTH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`
}

export function clearLanCookie(): string {
  return `${LAN_AUTH_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
}
