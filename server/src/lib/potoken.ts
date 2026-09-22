import { JSDOM } from 'jsdom'
import { BotGuardClient } from 'bgutils-js/botguard'
import type { WebPoSignalOutput } from 'bgutils-js/shared-types'
import { WebPoMinter } from 'bgutils-js/webpo'
import { buildURL, getHeaders, USER_AGENT } from 'bgutils-js/utils'
import logger from '../logger.js'
import { getInnertube } from './ytmusic.js'

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
const potCache = new Map<string, { pot: string; fetchedAt: number }>()

function setupDom() {
  if ('navigator' in globalThis && (globalThis as { yt?: unknown }).yt) return
  const dom = new JSDOM(
    '<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>',
    {
      url: 'https://www.youtube.com',
      referrer: 'https://www.youtube.com/',
    }
  )
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    origin: dom.window.origin,
  })
  if (!('navigator' in globalThis)) {
    Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator })
  }
}

async function buildMinter(): Promise<WebPoMinter> {
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
    (await itResponse.json()) as [string, number, number, string]
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
  if (!bootstrapPromise) {
    setupDom()
    bootstrapPromise = buildMinter()
      .then((m) => {
        minter = m
        minterFetchedAt = Date.now()
        return m
      })
      .catch((err) => {
        bootstrapPromise = null
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
