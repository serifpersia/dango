import type { Hono } from 'hono'
import { gotScraping } from 'got-scraping'
import path from 'path'
import { AppCache } from '../utils/cache.utils.js'
import { CONFIG } from '../config.js'
import fs from 'fs'
import logger from '../logger.js'
import { buildCfClearanceCookie, sanitizeCfClearance } from '../utils/cookie.utils.js'
import { isSafeExternalUrl } from '../utils/security.utils.js'
import { fetchWithRetry, linkAbort, setProxyHeaders } from '../utils/http.utils.js'
import {
  MEGAPLAY_ORIGIN,
  isNexabloomMasterUrl,
  signNexabloomMasterUrl,
} from '../utils/megaplay.utils.js'

const proxyCache = new AppCache({ ttlSeconds: 30, maxKeys: 500 })

function assTimeToVtt(value: string): string | null {
  const m = value.trim().match(/^(-?\d+):(\d{2}):(\d{2})[.:](\d{2,3})$/)
  if (!m) return null
  const h = String(Math.max(0, parseInt(m[1], 10))).padStart(2, '0')
  const ms = m[4].length === 2 ? `${m[4]}0` : m[4]
  return `${h}:${m[2]}:${m[3]}.${ms}`
}

function assToVtt(body: string): string | null {
  if (!/^\s*\[Script Info\]/im.test(body)) return null
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  let inEvents = false
  let format: string[] | null = null
  const cues: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (/^\[Events\]/i.test(line)) {
      inEvents = true
      continue
    }
    if (/^\[/.test(line)) {
      inEvents = false
      continue
    }
    if (!inEvents) continue
    if (/^Format\s*:/i.test(line)) {
      format = line
        .replace(/^Format\s*:/i, '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
      continue
    }
    if (!/^Dialogue\s*:/i.test(line) || !format) continue
    const payload = line.replace(/^Dialogue\s*:/i, '')
    const parts: string[] = []
    let rest = payload
    for (let i = 0; i < format.length - 1; i++) {
      const idx = rest.indexOf(',')
      if (idx < 0) break
      parts.push(rest.slice(0, idx))
      rest = rest.slice(idx + 1)
    }
    parts.push(rest)
    const start = assTimeToVtt(parts[format.indexOf('start')] ?? '')
    const end = assTimeToVtt(parts[format.indexOf('end')] ?? '')
    if (!start || !end || format.indexOf('text') < 0) continue
    const text = (parts[format.indexOf('text')] ?? '')
      .replace(/\\\\/g, '\\u0000')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/gi, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\h/gi, ' ')
      .replace(/\\[a-zA-Z]+\d*/g, '')
      .replace(/\\u0000/g, '\\')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n')
    if (!text) continue
    cues.push(`${start} --> ${end}\n${text}`)
    if (cues.length > 5000) break
  }
  if (cues.length === 0) return null
  return `WEBVTT\n\n${cues.join('\n\n')}\n`
}

const KWIK_DOMAINS = new Set(['kwik.cx', 'kwik.si', 'kwik.pro'])
const ANIMEPAHE_URL = 'https://animepahe.pw/'
const VAULT_CDN_HOSTS = new Set(['uwucdn.top', 'owocdn.top'])
const GOT_SCRAPING_HOSTS = new Set([
  'kwik.cx',
  'kwik.si',
  'kwik.pro',
  'animepahe.pw',
  'animepahe.ru',
])
const GOT_SCRAPING_SUFFIXES = [
  '.uwucdn.top',
  '.owocdn.top',
  '.streamzone1.site',
  '.nekostream.site',
  '.nukitashith.top',
  '.aniwatchtv.site',
]
const HANIME_HOSTS = new Set(['r2.1hanime.com', '1.1hanime.com'])
const OPPAI_HOSTS = new Set(['myspacecat.pictures'])
const KAA_HOSTS = new Set([
  'hls.krussdomi.com',
  'subst.krussdomi.com',
  'krussdomi.com',
  'st1.advancedairesearchlab.xyz',
  'st1.habibikun.xyz',
  'st1.babybayw.xyz',
  'st1.narutokun.xyz',
])
const KAA_REFERER = 'https://krussdomi.com/'
const KAA_ORIGIN = 'https://krussdomi.com'
const ANILIGHT_REFERER = 'https://anilight.live/'
const ANILIGHT_ORIGIN = 'https://anilight.live'
const ANILIGHT_HOSTS = [
  'anilight.live',
  'api.anilight.live',
  'lostproject.club',
  'streamzone1.site',
  'nukitashi.top',
  'vivibebe.site',
  'vibeplayer.site',
  'aniwatchtv.site',
]
const NEXABLOOM_FAMILY_SUFFIXES = [
  '.quavex.top',
  '.nexabloom.top',
  '.hiddenvertex.top',
  '.ironhorizon.top',
  '.solarhaven.top',
]
const NEXABLOOM_FALLBACK_HOSTS = ['fetch.nexabloom.top']

function nexabloomFallbackUrls(urlStr: string): string[] {
  let host = ''
  try {
    host = new URL(urlStr).hostname.toLowerCase()
  } catch {
    return [urlStr]
  }
  if (!NEXABLOOM_FAMILY_SUFFIXES.some((s) => host.endsWith(s))) {
    return [urlStr]
  }
  const urls = [urlStr]
  for (const fallback of NEXABLOOM_FALLBACK_HOSTS) {
    if (fallback === host) continue
    try {
      const candidate = new URL(urlStr)
      candidate.hostname = fallback
      urls.push(candidate.href)
    } catch {
      // ignore
    }
  }
  return urls
}

function isGotScrapingHost(urlStr: string): boolean {
  try {
    const host = new URL(urlStr).hostname.toLowerCase()
    if (GOT_SCRAPING_HOSTS.has(host)) return true
    if (HANIME_HOSTS.has(host)) return true
    return GOT_SCRAPING_SUFFIXES.some((s) => host.endsWith(s))
  } catch {
    return false
  }
}

function validateKwikUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    const isSecure = url.protocol === 'https:'
    const isKwik = KWIK_DOMAINS.has(url.hostname.toLowerCase())
    const isEmbedPath = /^\/e\/[A-Za-z0-9_-]+$/.test(url.pathname)
    const noAuthOrQuery = !url.username && !url.password && !url.search && !url.hash

    return isSecure && isKwik && isEmbedPath && noAuthOrQuery ? url : null
  } catch {
    return null
  }
}

function pinVariant(body: string, idx: number): string | null {
  const lines = body.split('\n')
  let streamIdx = -1
  let skipUri = false
  const out: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
      streamIdx++
      skipUri = streamIdx !== idx
      if (!skipUri) out.push(line)
      continue
    }
    if (skipUri && trimmed && !trimmed.startsWith('#')) {
      skipUri = false
      continue
    }
    out.push(line)
  }
  if (streamIdx < 0 || idx > streamIdx) return null
  return out.join('\n')
}

function applyKwikPatches(html: string, kwikUrl: URL, cookieStr: string = ''): string | null {
  const safeReferer = JSON.stringify(kwikUrl.href).replace(/</g, '\\u003c')
  const safeCookie = JSON.stringify(cookieStr).replace(/</g, '\\u003c')

  const patched = html.replace(
    /\b(src|href|url)\s*[=:]\s*(["']?)(\/\/[^"'>)]+|\/(?!\/)[^"'>)]*)\2/gi,
    (match, attr, quote, path) => {
      const full = path.startsWith('//') ? `https:${path}` : `${kwikUrl.origin}${path}`
      const prefix = match.startsWith('url') ? `url(` : `${attr}=`
      const suffix = match.startsWith('url') ? `)` : ''
      return `${prefix}${quote}${full}${quote}${suffix}`
    }
  )

  const iconProxy = `/api/proxy?url=${encodeURIComponent(`${kwikUrl.origin}/app/js/vendor/plyr.svg`)}&referer=${encodeURIComponent(kwikUrl.href)}`
  const plyrPatch = `<script>if(window.Plyr) Plyr.defaults.iconUrl=${JSON.stringify(iconProxy).replace(/</g, '\\u003c')};</script>`

  const hlsPatch = `<script>
      (function() {
        var hook = function() {
          if (!window.Hls) return;
          var original = Hls.prototype.loadSource;
          Hls.prototype.loadSource = function(src) {
            if (typeof src === 'string' && src.includes('.m3u8')) {
              src = window.location.origin + '/api/proxy?url=' + encodeURIComponent(src) + '&referer=' + encodeURIComponent(${safeReferer}) + (${safeCookie} ? '&cookie=' + encodeURIComponent(${safeCookie}) : '');
            }
            return original.call(this, src);
          };
        };
        if (window.Hls) hook();
        else {
          var observer = new MutationObserver(function() {
            if (window.Hls) { hook(); observer.disconnect(); }
          });
          observer.observe(document.documentElement, { childList: true, subtree: true });
        }
      })();
    </script>`

  const endBridgePatch = `<script>
      (function() {
        var notified = false;
        var notifyEnded = function() {
          if (notified) return;
          notified = true;
          window.parent.postMessage({ type: 'ANI_WEB_MEDIA_ENDED' }, window.location.origin);
        };

        var attachToVideos = function(root) {
          var scope = root || document;
          var videos = scope.querySelectorAll ? scope.querySelectorAll('video') : [];
          Array.prototype.forEach.call(videos, function(video) {
            if (video.dataset && video.dataset.aniWebEndedBridge === 'true') return;
            if (video.dataset) video.dataset.aniWebEndedBridge = 'true';
            video.addEventListener('ended', notifyEnded, { once: true });
          });
        };

        attachToVideos(document);

        var observer = new MutationObserver(function() {
          attachToVideos(document);
        });

        observer.observe(document.documentElement, { childList: true, subtree: true });
      })();
    </script>`

  const beforePlyr = patched.replace(
    /(<script[^>]+\/plyr\.min\.js[^>]*><\/script>)/i,
    `$1${plyrPatch}`
  )
  const final = beforePlyr
    .replace(/(<script[^>]+hls(?:\.min)?\.js[^>]*><\/script>)/i, `$1${hlsPatch}`)
    .replace(/<\/body>/i, `${endBridgePatch}</body>`)

  return final === html ? null : final
}

function placeholderSvg(): Response | null {
  const possiblePaths = [
    path.join(CONFIG.PACKAGE_ROOT, 'client/public/placeholder.svg'),
    path.join(CONFIG.PACKAGE_ROOT, 'client/dist/placeholder.svg'),
    path.join(CONFIG.SERVER_ROOT, '..', 'client/public/placeholder.svg'),
  ]

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const headers = new Headers()
        headers.set('Cache-Control', 'no-store')
        headers.set('Content-Type', 'image/svg+xml')
        return new Response(fs.readFileSync(p), { headers })
      }
    } catch {
      // ignore
    }
  }

  return null
}

const PROXY_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0'

export function registerProxy(app: Hono) {
  app.get('/api/proxy', async (c) => {
    const url = c.req.query('url')
    if (!url) return c.text('URL required', 400)

    const safeCheck = isSafeExternalUrl(url)
    if (!safeCheck.safe) {
      return c.text(safeCheck.error || 'Invalid URL', 400)
    }

    const urlStr = url as string
    const refererStr = c.req.query('referer') || ''
    const cookieStr = c.req.query('cookie') || ''
    const variantRaw = c.req.query('variant')
    const variantIdx = variantRaw !== undefined ? parseInt(variantRaw, 10) : NaN
    const pinVar = Number.isInteger(variantIdx) && (variantIdx as number) >= 0
    const cacheKey = `m3u8-${urlStr}-${refererStr}${pinVar ? `-v${variantIdx}` : ''}`

    const abort = new AbortController()
    linkAbort(c.req.raw.signal, abort)

    try {
      const isVaultCdn = Array.from(VAULT_CDN_HOSTS).some((host) => urlStr.includes(host))
      const isHanime = Array.from(HANIME_HOSTS).some((host) => urlStr.includes(host))
      const isOppai = Array.from(OPPAI_HOSTS).some((host) => urlStr.includes(host))
      const isKaa =
        refererStr.startsWith(KAA_ORIGIN) ||
        Array.from(KAA_HOSTS).some((host) => urlStr.includes(host))
      const headers: Record<string, string> = {
        'User-Agent': PROXY_UA,
      }
      if (refererStr) headers['Referer'] = refererStr
      if (isVaultCdn) {
        headers['Origin'] = refererStr || ANIMEPAHE_URL
        const cookieHeader = buildCfClearanceCookie(cookieStr)
        if (cookieHeader) headers['Cookie'] = cookieHeader
      }
      if (isHanime) {
        if (!headers['Referer']) headers['Referer'] = refererStr || 'https://nhplayer.com/'
        headers['Origin'] = 'https://nhplayer.com'
      }
      if (isOppai) {
        if (!headers['Referer']) headers['Referer'] = refererStr || 'https://oppai.stream/'
        headers['Origin'] = 'https://oppai.stream'
      }
      if (isKaa) {
        if (!headers['Referer']) headers['Referer'] = refererStr || KAA_REFERER
        headers['Origin'] = KAA_ORIGIN
      }
      const isMegaplay = refererStr.startsWith(MEGAPLAY_ORIGIN) || urlStr.includes('nexabloom.top')
      if (isMegaplay && !headers['Origin']) {
        headers['Origin'] = MEGAPLAY_ORIGIN
      }
      if (urlStr.includes('weeabo0.xyz') || urlStr.includes('weeab0o.xyz')) {
        if (!headers['Referer']) headers['Referer'] = refererStr || 'https://japaneseasmr.com/'
        const jasmrCookieHeader = buildCfClearanceCookie(cookieStr)
        if (jasmrCookieHeader) headers['Cookie'] = jasmrCookieHeader
        const jasmrUa = c.req.query('ua') || ''
        if (jasmrUa) headers['User-Agent'] = jasmrUa
      }
      const range = c.req.header('range')
      if (range) headers['Range'] = range

      if (urlStr.includes('.m3u8')) {
        const cached = proxyCache.get<string>(cacheKey)
        if (cached) {
          const headers = new Headers()
          headers.set('Content-Type', 'application/vnd.apple.mpegurl')
          headers.set('Access-Control-Allow-Origin', '*')
          return new Response(cached, { headers })
        }

        const resp = await (async () => {
          let last = null
          for (const candidate of nexabloomFallbackUrls(urlStr)) {
            const attempt = await gotScraping({
              url: isNexabloomMasterUrl(candidate) ? signNexabloomMasterUrl(candidate) : candidate,
              method: 'GET',
              headers,
              responseType: 'text',
              timeout: { request: 30000 },
              followRedirect: true,
              throwHttpErrors: false,
            })
            last = attempt
            if (attempt.statusCode === 200 || attempt.statusCode === 206) return attempt
          }
          return last
        })()

        if (!resp || (resp.statusCode !== 200 && resp.statusCode !== 206)) {
          return c.text('Upstream error', (resp?.statusCode || 502) as 502)
        }

        const finalUrl = resp.url || urlStr
        const baseUrl = new URL(finalUrl)
        const proxiedMediaUrl = (targetUrl: string) =>
          `/api/proxy?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(refererStr)}` +
          (cookieStr ? `&cookie=${encodeURIComponent(sanitizeCfClearance(cookieStr))}` : '') +
          (c.req.query('ua') ? `&ua=${encodeURIComponent(c.req.query('ua') as string)}` : '')
        const needsProxy = Boolean(refererStr)

        const isProxied = (value: string) => value.includes('/api/proxy')

        let playlistBody = resp.body as string
        if (pinVar) {
          const pinned = pinVariant(playlistBody, variantIdx as number)
          if (pinned) playlistBody = pinned
        }

        const rewritten = playlistBody
          .split('\n')
          .map((line: string) => {
            const trimmed = line.trim()
            if (!trimmed) return line

            if (trimmed.startsWith('#')) {
              return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
                if (isProxied(uri)) return `URI="${uri}"`
                const absolute = new URL(uri, baseUrl).href
                return `URI="${needsProxy || absolute.includes('.m3u8') ? proxiedMediaUrl(absolute) : absolute}"`
              })
            }

            if (isProxied(trimmed)) return line

            const absolute = new URL(trimmed, baseUrl).href
            return proxiedMediaUrl(absolute)
          })
          .join('\n')

        proxyCache.set(cacheKey, rewritten)
        const outHeaders = new Headers()
        outHeaders.set('Content-Type', 'application/vnd.apple.mpegurl')
        outHeaders.set('Access-Control-Allow-Origin', '*')
        return new Response(rewritten, { headers: outHeaders })
      } else {
        if (isGotScrapingHost(urlStr)) {
          if (range) headers['Range'] = range

          let resp = null
          for (const candidate of nexabloomFallbackUrls(urlStr)) {
            const attempt = await gotScraping({
              url: candidate,
              method: 'GET',
              headers,
              responseType: 'buffer',
              timeout: { request: 30000 },
              followRedirect: true,
              throwHttpErrors: false,
            })
            resp = attempt
            if (attempt.statusCode === 200 || attempt.statusCode === 206) break
          }

          if (!resp || (resp.statusCode !== 200 && resp.statusCode !== 206)) {
            return c.text('Upstream error', (resp?.statusCode || 502) as 502)
          }

          const ct = resp.headers['content-type']
          const isVtt = urlStr.endsWith('.vtt') || urlStr.includes('.vtt?')
          const outHeaders = new Headers()
          outHeaders.set(
            'Content-Type',
            isVtt ? 'text/vtt; charset=utf-8' : ct || 'application/octet-stream'
          )
          setProxyHeaders(outHeaders, (name) => resp.headers[name])
          return new Response(resp.body as BodyInit, {
            status: resp.statusCode as 200,
            headers: outHeaders,
          })
        } else {
          let upstream = null
          for (const candidate of nexabloomFallbackUrls(urlStr)) {
            if (abort.signal.aborted) break
            try {
              const attempt = await fetchWithRetry(
                candidate,
                { method: 'GET', headers },
                { retries: 3, timeoutMs: 30000, signal: abort.signal }
              )
              upstream = attempt
              if (attempt.status === 200 || attempt.status === 206) break
              try {
                await attempt.body?.cancel()
              } catch {
                // ignore
              }
            } catch {
              // ignore
            }
          }
          if (!upstream) {
            return c.text('Upstream error', 502)
          }
          const status = upstream.status
          if (status !== 200 && status !== 206) {
            try {
              await upstream.body?.cancel()
            } catch {
              // ignore
            }
            return c.text('Upstream error', status as 200)
          }
          const isVtt = urlStr.endsWith('.vtt') || urlStr.includes('.vtt?')
          const ct = upstream.headers.get('content-type')
          const outHeaders = new Headers()
          outHeaders.set(
            'Content-Type',
            isVtt ? 'text/vtt; charset=utf-8' : ct || 'application/octet-stream'
          )
          setProxyHeaders(outHeaders, (name) => upstream.headers.get(name))
          if (!upstream.body) {
            return c.text('Upstream error', 502)
          }
          return new Response(upstream.body, { status: status as 200, headers: outHeaders })
        }
      }
    } catch (e) {
      if (abort.signal.aborted) return new Response(null, { status: 499 })
      logger.error({ url: urlStr, error: (e as Error)?.message }, '[proxy] upstream request failed')
      return c.text('Proxy error', 500)
    }
  })

  app.get('/api/embed-proxy', async (c) => {
    const kwikUrl = validateKwikUrl(c.req.query('url'))
    if (!kwikUrl) return c.text('Invalid or unsupported gateway URL', 400)

    const cookieStr = c.req.query('cookie') || ''
    const abort = new AbortController()
    linkAbort(c.req.raw.signal, abort)

    try {
      const headers: Record<string, string> = {
        'User-Agent': PROXY_UA,
        Referer: ANIMEPAHE_URL,
        Origin: 'https://animepahe.pw',
      }
      if (cookieStr) {
        const cookieHeader = buildCfClearanceCookie(cookieStr)
        if (cookieHeader) headers['Cookie'] = cookieHeader
      }

      const response = await gotScraping({
        url: kwikUrl.href,
        method: 'GET',
        headers,
        responseType: 'text',
        timeout: { request: 30000 },
        followRedirect: true,
        throwHttpErrors: false,
      })

      const originalHtml = response.body as string
      const patched = applyKwikPatches(originalHtml, kwikUrl, cookieStr)
      if (!patched) return c.text('Failed to patch video gateway', 502)

      const outHeaders = new Headers()
      outHeaders.set('Content-Type', 'text/html; charset=utf-8')
      outHeaders.set('Cache-Control', 'private, max-age=120')
      return new Response(patched, { status: 200, headers: outHeaders })
    } catch {
      if (abort.signal.aborted) return new Response(null, { status: 499 })
      return c.text('Gateway proxy error', 502)
    }
  })

  app.get('/api/subtitle-proxy', async (c) => {
    const url = c.req.query('url')
    if (!url) return c.text('URL required', 400)

    const safeCheck = isSafeExternalUrl(url)
    if (!safeCheck.safe) {
      return c.text(safeCheck.error || 'Invalid URL', 400)
    }

    const abort = new AbortController()
    linkAbort(c.req.raw.signal, abort)

    const subUrl = url as string
    const refererStr = c.req.query('referer') || ''
    const isAnilight =
      refererStr.includes('anilight.live') || ANILIGHT_HOSTS.some((host) => subUrl.includes(host))
    const innerRawUrl = (() => {
      try {
        const parsed = new URL(subUrl)
        if (
          parsed.hostname.toLowerCase().endsWith('anilight.live') &&
          parsed.pathname.includes('/proxy/captions')
        ) {
          const inner = parsed.searchParams.get('url')
          if (inner && (inner.startsWith('http://') || inner.startsWith('https://'))) {
            return inner
          }
        }
      } catch {
        // ignore
      }
      return null
    })()

    const buildHeaders = (): Record<string, string> => {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/vtt,text/plain,*/*;q=0.8',
      }
      if (refererStr) {
        headers['Referer'] = refererStr
      } else if (isAnilight) {
        headers['Referer'] = ANILIGHT_REFERER
      }
      if (
        refererStr.startsWith(KAA_ORIGIN) ||
        Array.from(KAA_HOSTS).some((host) => subUrl.includes(host))
      ) {
        headers['Origin'] = KAA_ORIGIN
      } else if (isAnilight) {
        headers['Origin'] = ANILIGHT_ORIGIN
      }
      return headers
    }

    const fetchText = async (
      target: string,
      retries = 1
    ): Promise<{ status: number; body: string } | null> => {
      const headers = buildHeaders()
      if (innerRawUrl && target === innerRawUrl) {
        headers['Referer'] = ANILIGHT_REFERER
        headers['Origin'] = ANILIGHT_ORIGIN
      }
      try {
        const upstream = await fetchWithRetry(
          target,
          { method: 'GET', headers },
          { retries, timeoutMs: 15000, signal: abort.signal }
        )
        if (!upstream.ok) {
          logger.warn(
            { target, status: upstream.status },
            '[subtitle-proxy] upstream returned error status'
          )
          try {
            await upstream.body?.cancel()
          } catch {
            // ignore
          }
          return { status: upstream.status, body: '' }
        }
        const body = (await upstream.text()).replace(/^\uFEFF/, '')
        if (/^\s*\{[\s\S]*"error"[\s\S]*\}\s*$/.test(body.slice(0, 500))) {
          logger.warn({ target, body: body.slice(0, 200) }, '[subtitle-proxy] upstream JSON error')
          return { status: 502, body: '' }
        }
        return { status: upstream.status, body }
      } catch (e) {
        if (abort.signal.aborted) return null
        logger.warn(
          { target, error: (e as Error)?.message },
          '[subtitle-proxy] upstream fetch failed'
        )
        return { status: 502, body: '' }
      }
    }

    const vttHeaders = (cacheControl: string) => {
      const headers = new Headers()
      headers.set('Content-Type', 'text/vtt; charset=utf-8')
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Cache-Control', cacheControl)
      return headers
    }

    try {
      const headers = buildHeaders()

      let result = await fetchText(subUrl, 1)
      if (abort.signal.aborted) return new Response(null, { status: 499 })
      if ((!result || !result.body) && innerRawUrl) {
        result = await fetchText(innerRawUrl, 0)
        if (abort.signal.aborted) return new Response(null, { status: 499 })
      }
      if (!result || !result.body) {
        const headers = new Headers()
        headers.set('Access-Control-Allow-Origin', '*')
        headers.set('Cache-Control', 'no-store')
        return new Response('Subtitle upstream error', { status: 502, headers })
      }
      const body = result.body
      const baseForSegments = innerRawUrl || subUrl
      if (/#EXTM3U/i.test(body.slice(0, 1000))) {
        const segUrls = body
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))
          .slice(0, 200)
          .map((u) => {
            try {
              return new URL(u, baseForSegments).href
            } catch {
              return null
            }
          })
          .filter((u): u is string => Boolean(u))
        const parts: string[] = []
        for (const seg of segUrls) {
          try {
            const segRes = await fetchWithRetry(
              seg,
              { method: 'GET', headers },
              { retries: 1, timeoutMs: 15000, signal: abort.signal }
            )
            if (!segRes.ok) continue
            let segBody = (await segRes.text()).replace(/^\uFEFF/, '')
            if (/#EXTM3U/i.test(segBody.slice(0, 200))) continue
            segBody = segBody
              .replace(/\r\n/g, '\n')
              .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
            if (/^\s*WEBVTT/i.test(segBody)) {
              segBody = segBody.replace(/^\s*WEBVTT[^\n]*\n(\n|.*\n)?/, '')
            }
            segBody = segBody.trim()
            if (segBody) parts.push(segBody)
            if (parts.join('\n').length > 2_000_000) break
          } catch {
            if (abort.signal.aborted) return new Response(null, { status: 499 })
          }
        }
        if (parts.length === 0) {
          const headers = new Headers()
          headers.set('Access-Control-Allow-Origin', '*')
          headers.set('Cache-Control', 'no-store')
          return new Response('Subtitle playlist empty', { status: 502, headers })
        }
        return new Response(`WEBVTT\n\n${parts.join('\n\n')}\n`, {
          headers: vttHeaders('public, max-age=86400'),
        })
      }
      if (/^\s*WEBVTT/i.test(body)) {
        return new Response(body, { headers: vttHeaders('public, max-age=86400') })
      }
      const vttFromAss = assToVtt(body)
      if (vttFromAss) {
        return new Response(vttFromAss, { headers: vttHeaders('public, max-age=86400') })
      }
      return new Response(
        `WEBVTT\n\n${body.replace(/\r\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`,
        { headers: vttHeaders('public, max-age=86400') }
      )
    } catch {
      if (abort.signal.aborted) return new Response(null, { status: 499 })
      logger.warn({ url: subUrl }, '[subtitle-proxy] failed')
      const headers = new Headers()
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Cache-Control', 'no-store')
      return new Response('Subtitle upstream error', { status: 502, headers })
    }
  })

  app.get('/api/image-proxy', async (c) => {
    const url = c.req.query('url')
    if (!url) return c.text('URL required', 400)

    const safeCheck = isSafeExternalUrl(url)
    if (!safeCheck.safe) {
      return c.text(safeCheck.error || 'Invalid URL', 400)
    }

    const targetUrl = url as string
    const cookie = c.req.query('cookie') || ''
    const ua = c.req.query('ua') || ''
    const abort = new AbortController()
    linkAbort(c.req.raw.signal, abort)

    let refererValue = 'https://anilist.co/'
    const headers: Record<string, string> = {
      'User-Agent':
        ua ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }

    try {
      if (targetUrl.includes('animepahe')) {
        refererValue = 'https://animepahe.pw/'
        const rawCookie = cookie || ''
        let sanitized = rawCookie.trim()
        sanitized = sanitized.replace(/^cf_clearance/i, '')
        sanitized = sanitized.replace(/^[:=]\s*/, '')
        sanitized = sanitized.replace(/["']/g, '').trim()
        headers['Cookie'] = `cf_clearance=${sanitized}`
      } else if (targetUrl.includes('anilist.co')) {
        refererValue = 'https://anilist.co/'
      } else if (targetUrl.includes('gogocdn.net')) {
        refererValue = 'https://gogoanime.lu/'
      } else if (targetUrl.includes('animeya.cc')) {
        refererValue = 'https://animeya.cc/'
      } else if (targetUrl.includes('myspacecat.pictures')) {
        refererValue = 'https://oppai.stream/'
      } else if (targetUrl.includes('weeabo0.xyz')) {
        refererValue = 'https://japaneseasmr.com/'
        const rawCookie = cookie || ''
        let sanitized = rawCookie.trim()
        sanitized = sanitized.replace(/^cf_clearance/i, '')
        sanitized = sanitized.replace(/^[:=]\s*/, '')
        sanitized = sanitized.replace(/["']/g, '').trim()
        if (sanitized) headers['Cookie'] = `cf_clearance=${sanitized}`
        const uaParam = ua || ''
        if (uaParam) headers['User-Agent'] = uaParam
      }

      headers['Referer'] = refererValue

      let lastStatus = 0
      let body: Buffer | null = null
      let contentType = 'image/webp'
      for (let attempt = 0; attempt < 3 && !body; attempt++) {
        const resp = await gotScraping({
          url: targetUrl,
          method: 'GET',
          headers,
          responseType: 'buffer',
          followRedirect: true,
          throwHttpErrors: false,
          timeout: { request: 30000 },
        })
        lastStatus = resp.statusCode
        if (resp.statusCode === 200 && resp.rawBody?.length) {
          body = Buffer.from(resp.rawBody)
          contentType = String(resp.headers['content-type'] || 'image/webp')
        } else {
          if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
        }
      }

      if (body) {
        const outHeaders = new Headers()
        outHeaders.set('Cache-Control', 'public, max-age=604800, immutable')
        outHeaders.set('Content-Type', contentType)
        outHeaders.set('Access-Control-Allow-Origin', '*')
        return new Response(body as BodyInit, { headers: outHeaders })
      }
      const placeholder = placeholderSvg()
      if (placeholder) return placeholder
      return c.text('Not Found', 404)
    } catch {
      if (abort.signal.aborted) return new Response(null, { status: 499 })
      const placeholder = placeholderSvg()
      if (placeholder) return placeholder
      return c.text('Not Found', 404)
    }
  })

  app.get('/api/resolve', async (c) => {
    const targetUrl = c.req.query('url')
    if (!targetUrl || typeof targetUrl !== 'string') {
      return c.json({ error: 'URL required' }, 400)
    }

    const safeCheck = isSafeExternalUrl(targetUrl)
    if (!safeCheck.safe) {
      return c.json({ error: safeCheck.error || 'Invalid URL' }, 400)
    }

    try {
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      })

      return c.json({
        finalUrl: response.url,
        status: response.status,
      })
    } catch (e) {
      const err = e as { message?: string }
      return c.json({ error: err.message || 'Resolve failed' }, 500)
    }
  })
}
