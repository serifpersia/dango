import fs from 'fs'
import path from 'path'
import type { Innertube } from 'youtubei.js'
import { CONFIG } from '../config.js'
import logger from '../logger.js'

const COOKIE_PATH = path.join(CONFIG.ROOT, 'ytmusic_cookie.txt')
const STALE_OAUTH_PATH = path.join(CONFIG.ROOT, 'ytmusic_oauth.json')
const CACHE_DIR = path.join(CONFIG.ROOT, 'ytmusic_cache')

export interface YTMusicAuthStatus {
  authenticated: boolean
}

let publicTube: Innertube | null = null
let publicPromise: Promise<Innertube> | null = null
let publicFailedAt = 0
const PUBLIC_FAIL_COOLDOWN_MS = 60 * 1000
let authedTube: Innertube | null = null

type YoutubeModule = typeof import('youtubei.js')

let ytModule: YoutubeModule | null = null

async function loadYoutube(): Promise<YoutubeModule> {
  if (!ytModule) ytModule = await import('youtubei.js')
  return ytModule
}

async function ensureShim(): Promise<void> {
  const { Platform, Log } = await loadYoutube()
  Platform.shim.eval = (async (data: { output: string }) =>
    new Function(data.output)()) as unknown as typeof Platform.shim.eval
  Log.setLevel(Log.Level.ERROR)
}

export function getMusicCookie(): string | null {
  return readCookie()
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

function purgeStaleOAuth(): void {
  try {
    if (fs.existsSync(STALE_OAUTH_PATH)) fs.unlinkSync(STALE_OAUTH_PATH)
  } catch {
    // ignore
  }
}

/** Public session: never signed in. Used for search/stream/home. */
export function getInnertube(): Promise<Innertube> {
  if (publicTube) return Promise.resolve(publicTube)
  if (Date.now() - publicFailedAt < PUBLIC_FAIL_COOLDOWN_MS) {
    return Promise.reject(new Error('YouTube session unavailable (cooling down)'))
  }
  if (!publicPromise) {
    publicPromise = (async () => {
      const { Innertube, UniversalCache } = await loadYoutube()
      await ensureShim()
      try {
        fs.mkdirSync(CACHE_DIR, { recursive: true })
      } catch {
        // ignore
      }
      try {
        const yt = await Innertube.create({
          cache: new UniversalCache(true, CACHE_DIR),
          generate_session_locally: false,
        })
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

/** Authenticated session built from the saved cookie. Null when not signed in. */
export async function getAuthedInnertube(): Promise<Innertube | null> {
  const cookie = readCookie()
  if (!cookie) {
    authedTube = null
    return null
  }
  if (authedTube) return authedTube
  await ensureShim()
  const { Innertube } = await loadYoutube()
  authedTube = await Innertube.create({ cookie })
  return authedTube
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
  await trial.music.getLibrary()
  fs.mkdirSync(CONFIG.ROOT, { recursive: true })
  fs.writeFileSync(COOKIE_PATH, clean, 'utf-8')
  purgeStaleOAuth()
  authedTube = trial
  logger.info('[ytmusic] cookie sign-in validated and saved')
}

export async function signOutMusic(): Promise<void> {
  try {
    if (fs.existsSync(COOKIE_PATH)) fs.unlinkSync(COOKIE_PATH)
  } catch {
    // ignore
  }
  purgeStaleOAuth()
  authedTube = null
}
