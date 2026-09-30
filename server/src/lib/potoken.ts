import logger from '../logger.js'
import { parseJsonBody } from '../utils/http.utils.js'
import { getInnertube } from './ytmusic.js'
import type { WebPoSignalOutput } from 'bgutils-js/shared-types'
import type { WebPoMinter } from 'bgutils-js/webpo'

interface BgChallengeResponse {
  bg_challenge?: {
    interpreter_url?: {
      private_do_not_access_or_else_trusted_resource_url_wrapped_value?: string
    }
    interpreter_hash?: string
    program?: string
    global_name?: string
  }
}

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'
const INTEGRITY_TTL_MS = 10 * 60 * 60 * 1000
const POT_CACHE_MS = 6 * 60 * 60 * 1000

let minter: WebPoMinter | null = null
let minterFetchedAt = 0
let bootstrapPromise: Promise<WebPoMinter> | null = null
let bootstrapFailedAt = 0
const BOOTSTRAP_FAIL_COOLDOWN_MS = 60 * 1000
const potCache = new Map<string, { pot: string; fetchedAt: number }>()

// BotGuard needs browser globals to execute. They are installed once and kept
// for the process lifetime: the minter's callbacks read them lazily at mint
// time, long after bootstrap completes, so scoping them to bootstrap breaks
// minting with `window is not defined`.
async function setupDom(): Promise<void> {
  const g = globalThis as Record<string, unknown>
  if ('navigator' in g && (g as { yt?: unknown }).yt) return
  const { JSDOM, VirtualConsole } = await import('jsdom')
  const virtualConsole = new VirtualConsole()
  const dom = new JSDOM(
    '<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>',
    {
      url: 'https://www.youtube.com',
      referrer: 'https://www.youtube.com/',
      virtualConsole,
    }
  )
  Object.assign(g, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    origin: dom.window.origin,
  })
  if (!('navigator' in g)) {
    Object.defineProperty(g, 'navigator', {
      value: dom.window.navigator,
      writable: true,
      configurable: true,
    })
  }
}

async function buildMinter(): Promise<WebPoMinter> {
  const [{ BotGuardClient }, { WebPoMinter }, { buildURL, getHeaders, USER_AGENT }] =
    await Promise.all([
      import('bgutils-js/botguard'),
      import('bgutils-js/webpo'),
      import('bgutils-js/utils'),
    ])
  const yt = await getInnertube()
  const pageResponse = await fetch('https://www.youtube.com', {
    headers: {
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.7',
      'user-agent': USER_AGENT,
    },
  })
  const pageHtml = await pageResponse.text()
  const ytConfig = pageHtml.match(/ytcfg\.set\(({.+?})\);/s)?.[1]
  if (ytConfig) {
    const win = (globalThis as { window?: { yt?: unknown } }).window as {
      yt?: unknown
    }
    if (win) win.yt = { config_: JSON.parse(ytConfig) }
  }
  const challenge = (await yt.getAttestationChallenge(
    'ENGAGEMENT_TYPE_UNBOUND'
  )) as unknown as BgChallengeResponse
  const bgc = challenge.bg_challenge
  const interpreterUrl =
    bgc?.interpreter_url?.private_do_not_access_or_else_trusted_resource_url_wrapped_value
  if (!bgc?.program || !bgc.global_name || !interpreterUrl) {
    throw new Error('No BotGuard challenge in response')
  }
  const bgScript = await (await fetch(`https:${interpreterUrl}`)).text()
  if (!bgScript) throw new Error('Could not load BotGuard VM')
  new Function(bgScript)()
  const botGuard = await BotGuardClient.create({
    program: bgc.program,
    globalName: bgc.global_name,
    globalObject: globalThis,
  })
  const webPoSignalOutput: WebPoSignalOutput = []
  const botguardResponse = await botGuard.snapshot({ webPoSignalOutput })
  const itResponse = await fetch(buildURL('GenerateIT', true), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
  })
  const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] =
    await parseJsonBody<[string, number, number, string]>(itResponse)
  if (!integrityToken) throw new Error('Integrity token request failed')
  logger.info('[pot] minter ready (integrity ttl %ss)', estimatedTtlSecs)
  return WebPoMinter.create(
    {
      integrityToken,
      estimatedTtlSecs,
      mintRefreshThreshold,
      websafeFallbackToken,
    },
    webPoSignalOutput
  )
}

async function getMinter(): Promise<WebPoMinter> {
  if (minter && Date.now() - minterFetchedAt < INTEGRITY_TTL_MS) return minter
  if (Date.now() - bootstrapFailedAt < BOOTSTRAP_FAIL_COOLDOWN_MS) {
    throw new Error('PoToken bootstrap cooling down')
  }
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await setupDom()
      const m = await buildMinter()
      minter = m
      minterFetchedAt = Date.now()
      return m
    })().catch((err) => {
      bootstrapPromise = null
      bootstrapFailedAt = Date.now()
      throw err
    })
  }
  return bootstrapPromise
}

export async function mintPoToken(videoId: string): Promise<string> {
  const cached = potCache.get(videoId)
  if (cached && Date.now() - cached.fetchedAt < POT_CACHE_MS) return cached.pot
  const m = await getMinter()
  const pot = await m.mintAsWebsafeString(videoId)
  potCache.set(videoId, { pot, fetchedAt: Date.now() })
  return pot
}

export function resetPoTokens(videoId?: string): void {
  if (videoId) potCache.delete(videoId)
  else {
    potCache.clear()
    minter = null
    minterFetchedAt = 0
    bootstrapPromise = null
  }
}
