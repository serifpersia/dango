import fs from 'fs'
import path from 'path'
import type { Innertube } from 'youtubei.js'
import { CONFIG } from '../config.js'
import logger from '../logger.js'

const COOKIE_PATH = path.join(CONFIG.ROOT, 'ytmusic_cookie.txt')

export interface YTMusicAuthStatus {
  authenticated: boolean
}

export interface YtPanel {
  contents?: unknown[]
  playlist_id?: string
}

export interface YtBasicInfo {
  basic_info?: {
    title?: string
    author?: string
    duration?: number
    thumbnail?: { url: string; width?: number; height?: number }[]
  }
}

export interface YtSessionActions {
  actions?: unknown
  session?: { actions?: unknown }
}

export interface YtStreamingData {
  streaming_data?: {
    adaptive_formats?: {
      mime_type?: string
      bitrate?: number
      has_audio?: boolean
      has_video?: boolean
      decipher: (player: unknown) => Promise<string>
    }[]
  }
}

export interface YtPlayerSession {
  player?: unknown
}

let publicTube: Innertube | null = null
let publicPromise: Promise<Innertube> | null = null
let publicFailedAt = 0
const PUBLIC_FAIL_COOLDOWN_MS = 60 * 1000
let authedTube: Innertube | null = null

type YoutubeModule = typeof import('youtubei.js')

let ytModule: YoutubeModule | null = null
let shimReady = false

async function loadYoutube(): Promise<YoutubeModule> {
  if (!ytModule) ytModule = await import('youtubei.js')
  return ytModule
}

async function ensureShim(): Promise<void> {
  if (shimReady) return
  const { Platform, Log } = await loadYoutube()
  Platform.shim.eval = (async (data: { output: string }) =>
    new Function(data.output)()) as unknown as typeof Platform.shim.eval
  Log.setLevel(Log.Level.ERROR)
  shimReady = true
}

function readCookie(): string | null {
  try {
    if (!fs.existsSync(COOKIE_PATH)) return null
    const raw = fs.readFileSync(COOKIE_PATH, 'utf-8').trim()
    return raw || null
  } catch {
    return null
  }
}

export function getMusicCookie(): string | null {
  return readCookie()
}

export function isParserVariantError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { constructor?: { name?: string } }).constructor?.name
  if (name === 'ParsingError') return true
  const msg = err instanceof Error ? err.message : String(err)
  return /Expected node of any type|Cannot cast \S+ to one of|got ItemSection|is not valid JSON|Incorrect JSPB formatting/i.test(
    msg
  )
}

export function getInnertube(): Promise<Innertube> {
  if (publicTube) return Promise.resolve(publicTube)
  if (Date.now() - publicFailedAt < PUBLIC_FAIL_COOLDOWN_MS) {
    return Promise.reject(new Error('YouTube session unavailable (cooling down)'))
  }
  if (!publicPromise) {
    publicPromise = (async () => {
      const { Innertube } = await loadYoutube()
      await ensureShim()
      try {
        const yt = await Innertube.create({ generate_session_locally: false })
        publicTube = yt
        return yt
      } catch (err) {
        publicPromise = null
        publicFailedAt = Date.now()
        throw err
      }
    })()
  }
  return publicPromise
}

export async function getAuthedInnertube(forceRefresh = false): Promise<Innertube | null> {
  const cookie = readCookie()
  if (!cookie) {
    authedTube = null
    return null
  }
  if (authedTube && !forceRefresh) return authedTube
  await ensureShim()
  const { Innertube } = await loadYoutube()
  authedTube = await Innertube.create({ cookie })
  return authedTube
}

export function invalidateAuthedSession(): void {
  authedTube = null
}

export async function refreshAuthedInnertube(): Promise<Innertube | null> {
  invalidateAuthedSession()
  try {
    return await getAuthedInnertube()
  } catch (err) {
    logger.warn({ err }, '[ytmusic] saved-cookie session refresh failed')
    return null
  }
}

export function getMusicAuthStatus(): YTMusicAuthStatus {
  return { authenticated: readCookie() !== null }
}

export async function saveMusicCookie(cookie: string): Promise<void> {
  const clean = cookie.trim()
  if (!clean) throw new Error('Cookie is empty')
  await ensureShim()
  const { Innertube } = await loadYoutube()
  const trial = await Innertube.create({ cookie: clean })
  try {
    await trial.music.getLibrary()
  } catch (err) {
    if (!isParserVariantError(err)) throw err
    logger.warn('[ytmusic] sign-in validation hit a layout variant, accepting cookie anyway')
  }
  try {
    fs.mkdirSync(CONFIG.ROOT, { recursive: true })
  } catch {
    // ignore
  }
  fs.writeFileSync(COOKIE_PATH, clean, 'utf-8')
  authedTube = trial
  logger.info('[ytmusic] cookie sign-in validated and saved')
}

export async function signOutMusic(): Promise<void> {
  try {
    if (fs.existsSync(COOKIE_PATH)) fs.unlinkSync(COOKIE_PATH)
  } catch {
    // ignore
  }
  authedTube = null
}
