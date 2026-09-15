import { Request, Response } from 'express'
import { gotScraping } from 'got-scraping'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { AppCache } from '../utils/cache.utils.js'
import { CONFIG } from '../config.js'
import fs from 'fs'
import logger from '../logger.js'
import { buildCfClearanceCookie, sanitizeCfClearance } from '../utils/cookie.utils.js'
import { isSafeExternalUrl } from '../utils/security.utils.js'
import { fetchWithRetry } from '../utils/http.utils.js'
import {
  MEGAPLAY_ORIGIN,
  isNexabloomMasterUrl,
  signNexabloomMasterUrl,
} from '../utils/megaplay.utils.js'

const proxyCache = new AppCache({ ttlSeconds: 30, maxKeys: 500 })

export class ProxyController {
  private static readonly KWIK_DOMAINS = new Set(['kwik.cx', 'kwik.si', 'kwik.pro'])
  private static readonly ANIMEPAHE_URL = 'https://animepahe.pw/'
  private static readonly VAULT_CDN_HOSTS = new Set(['uwucdn.top', 'owocdn.top'])
  private static readonly GOT_SCRAPING_HOSTS = new Set([
    'kwik.cx',
    'kwik.si',
    'kwik.pro',
    'animepahe.pw',
    'animepahe.ru',
  ])
  private static readonly GOT_SCRAPING_SUFFIXES = [
    '.uwucdn.top',
    '.owocdn.top',
    '.streamzone1.site',
    '.nekostream.site',
    '.nukitashith.top',
    '.aniwatchtv.site',
  ]
  private static readonly HANIME_HOSTS = new Set(['r2.1hanime.com', '1.1hanime.com'])
  private static readonly OPPAI_HOSTS = new Set(['myspacecat.pictures'])
  private static readonly KAA_HOSTS = new Set([
    'hls.krussdomi.com',
    'subst.krussdomi.com',
    'krussdomi.com',
    'st1.advancedairesearchlab.xyz',
    'st1.habibikun.xyz',
    'st1.babybayw.xyz',
    'st1.narutokun.xyz',
  ])
  private static readonly KAA_REFERER = 'https://krussdomi.com/'
  private static readonly KAA_ORIGIN = 'https://krussdomi.com'
  private static readonly ANILIGHT_REFERER = 'https://anilight.live/'
  private static readonly ANILIGHT_ORIGIN = 'https://anilight.live'
  private static readonly ANILIGHT_HOSTS = [
    'anilight.live',
    'api.anilight.live',
    'lostproject.club',
    'streamzone1.site',
    'nukitashi.top',
    'vivibebe.site',
    'vibeplayer.site',
    'aniwatchtv.site',
  ]

  private static isGotScrapingHost(urlStr: string): boolean {
    try {
      const host = new URL(urlStr).hostname.toLowerCase()
      if (ProxyController.GOT_SCRAPING_HOSTS.has(host)) return true
      if (ProxyController.HANIME_HOSTS.has(host)) return true
      return ProxyController.GOT_SCRAPING_SUFFIXES.some((s) => host.endsWith(s))
    } catch {
      return false
    }
  }

  private abortWhenClientLeaves(res: Response, abortController: AbortController) {
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort()
      }
    })
  }

  private validateKwikUrl(value: unknown): URL | null {
    if (typeof value !== 'string') return null
    try {
      const url = new URL(value)
      const isSecure = url.protocol === 'https:'
      const isKwik = ProxyController.KWIK_DOMAINS.has(url.hostname.toLowerCase())
      const isEmbedPath = /^\/e\/[A-Za-z0-9_-]+$/.test(url.pathname)
      const noAuthOrQuery = !url.username && !url.password && !url.search && !url.hash

      return isSecure && isKwik && isEmbedPath && noAuthOrQuery ? url : null
    } catch {
      return null
    }
  }

  private pinVariant(body: string, idx: number): string | null {
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

  handleProxy = async (req: Request, res: Response) => {
    const { url, referer, cookie } = req.query
    if (!url) return res.status(400).send('URL required')

    const safeCheck = isSafeExternalUrl(url)
    if (!safeCheck.safe) {
      return res.status(400).send(safeCheck.error || 'Invalid URL')
    }

    const urlStr = url as string
    const refererStr = (referer as string) || ''
    const cookieStr = (cookie as string) || ''
    const variantIdx =
      req.query.variant !== undefined ? parseInt(req.query.variant as string, 10) : NaN
    const pinVariant = Number.isInteger(variantIdx) && (variantIdx as number) >= 0
    const cacheKey = `m3u8-${urlStr}-${refererStr}${pinVariant ? `-v${variantIdx}` : ''}`

    const abortController = new AbortController()
    this.abortWhenClientLeaves(res, abortController)

    try {
      const isVaultCdn = Array.from(ProxyController.VAULT_CDN_HOSTS).some((host) =>
        urlStr.includes(host)
      )
      const isHanime = Array.from(ProxyController.HANIME_HOSTS).some((host) =>
        urlStr.includes(host)
      )
      const isOppai = Array.from(ProxyController.OPPAI_HOSTS).some((host) => urlStr.includes(host))
      const isKaa =
        refererStr.startsWith(ProxyController.KAA_ORIGIN) ||
        Array.from(ProxyController.KAA_HOSTS).some((host) => urlStr.includes(host))
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
      }
      if (referer) headers['Referer'] = refererStr
      if (isVaultCdn) {
        headers['Origin'] = refererStr || ProxyController.ANIMEPAHE_URL
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
        if (!headers['Referer']) headers['Referer'] = refererStr || ProxyController.KAA_REFERER
        headers['Origin'] = ProxyController.KAA_ORIGIN
      }
      const isMegaplay = refererStr.startsWith(MEGAPLAY_ORIGIN) || urlStr.includes('nexabloom.top')
      if (isMegaplay && !headers['Origin']) {
        headers['Origin'] = MEGAPLAY_ORIGIN
      }
      if (urlStr.includes('weeabo0.xyz') || urlStr.includes('weeab0o.xyz')) {
        if (!headers['Referer']) headers['Referer'] = refererStr || 'https://japaneseasmr.com/'
        const jasmrCookieHeader = buildCfClearanceCookie(cookieStr)
        if (jasmrCookieHeader) headers['Cookie'] = jasmrCookieHeader
        const jasmrUa = (req.query.ua as string) || ''
        if (jasmrUa) headers['User-Agent'] = jasmrUa
      }
      if (req.headers.range) headers['Range'] = req.headers.range as string

      if (urlStr.includes('.m3u8')) {
        const cached = proxyCache.get<string>(cacheKey)
        if (cached) {
          return res
            .set('Content-Type', 'application/vnd.apple.mpegurl')
            .set('Access-Control-Allow-Origin', '*')
            .send(cached)
        }

        const resp = await gotScraping({
          url: isNexabloomMasterUrl(urlStr) ? signNexabloomMasterUrl(urlStr) : urlStr,
          method: 'GET',
          headers,
          responseType: 'text',
          timeout: { request: 30000 },
          followRedirect: true,
          throwHttpErrors: false,
        })

        if (resp.statusCode !== 200 && resp.statusCode !== 206) {
          return res.status(resp.statusCode ?? 502).send('Upstream error')
        }

        const finalUrl = resp.url || urlStr
        const baseUrl = new URL(finalUrl)
        const proxiedMediaUrl = (targetUrl: string) =>
          `/api/proxy?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(refererStr)}` +
          (cookieStr ? `&cookie=${encodeURIComponent(sanitizeCfClearance(cookieStr))}` : '') +
          ((req.query.ua as string) ? `&ua=${encodeURIComponent(req.query.ua as string)}` : '')
        const needsProxy = Boolean(refererStr)

        const isProxied = (value: string) => value.includes('/api/proxy')

        let playlistBody = resp.body
        if (pinVariant) {
          const pinned = this.pinVariant(playlistBody, variantIdx as number)
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
        res
          .set('Content-Type', 'application/vnd.apple.mpegurl')
          .set('Access-Control-Allow-Origin', '*')
          .send(rewritten)
      } else {
        if (ProxyController.isGotScrapingHost(urlStr)) {
          if (req.headers.range) headers['Range'] = req.headers.range as string

          const resp = await gotScraping({
            url: urlStr,
            method: 'GET',
            headers,
            responseType: 'buffer',
            timeout: { request: 30000 },
            followRedirect: true,
            throwHttpErrors: false,
          })

          if (resp.statusCode !== 200 && resp.statusCode !== 206) {
            return res.status(resp.statusCode ?? 502).send('Upstream error')
          }

          const ct = resp.headers['content-type']
          const isVtt = urlStr.endsWith('.vtt') || urlStr.includes('.vtt?')
          res.set(
            'Content-Type',
            isVtt ? 'text/vtt; charset=utf-8' : ct || 'application/octet-stream'
          )
          const cl = resp.headers['content-length']
          if (cl) res.set('Content-Length', cl)
          const cr = resp.headers['content-range']
          if (cr) res.set('Content-Range', cr)
          const ar = resp.headers['accept-ranges']
          if (ar) res.set('Accept-Ranges', ar)

          res.set('Access-Control-Allow-Origin', '*')
          res.send(resp.body)
        } else {
          const upstream = await fetchWithRetry(
            urlStr,
            { method: 'GET', headers },
            { retries: 3, timeoutMs: 30000, signal: abortController.signal }
          )
          const status = upstream.status
          if (status !== 200 && status !== 206) {
            try {
              await upstream.body?.cancel()
            } catch {
              // ignore
            }
            return res.status(status).send('Upstream error')
          }
          res.status(status)
          const isVtt = urlStr.endsWith('.vtt') || urlStr.includes('.vtt?')
          const ct = upstream.headers.get('content-type')
          res.set(
            'Content-Type',
            isVtt ? 'text/vtt; charset=utf-8' : ct || 'application/octet-stream'
          )
          const cl = upstream.headers.get('content-length')
          if (cl) res.set('Content-Length', cl)
          const cr = upstream.headers.get('content-range')
          if (cr) res.set('Content-Range', cr)
          const ar = upstream.headers.get('accept-ranges')
          if (ar) res.set('Accept-Ranges', ar)
          res.set('Access-Control-Allow-Origin', '*')
          if (!upstream.body) {
            return res.status(502).send('Upstream error')
          }
          try {
            await pipeline(
              Readable.from(upstream.body as unknown as AsyncIterable<Uint8Array>),
              res
            )
          } catch (e) {
            if (!res.headersSent) {
              logger.error(
                { url: urlStr, error: (e as Error)?.message },
                '[proxy] upstream stream failed'
              )
              res.status(500).send('Proxy error')
            } else {
              res.destroy()
            }
          }
        }
      }
    } catch (e) {
      if (abortController.signal.aborted) return
      if (!res.headersSent) {
        logger.error(
          { url: urlStr, error: (e as Error)?.message },
          '[proxy] upstream request failed'
        )
        res.status(500).send('Proxy error')
      }
    }
  }

  handleEmbedProxy = async (req: Request, res: Response) => {
    const kwikUrl = this.validateKwikUrl(req.query.url)
    if (!kwikUrl) return res.status(400).send('Invalid or unsupported gateway URL')

    const cookieStr = (req.query.cookie as string) || ''
    const abortController = new AbortController()
    this.abortWhenClientLeaves(res, abortController)

    try {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
        Referer: ProxyController.ANIMEPAHE_URL,
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
      const patched = this.applyKwikPatches(originalHtml, kwikUrl, cookieStr)
      if (!patched) return res.status(502).send('Failed to patch video gateway')

      return res
        .status(200)
        .set('Content-Type', 'text/html; charset=utf-8')
        .set('Cache-Control', 'private, max-age=120')
        .send(patched)
    } catch (e) {
      if (abortController.signal.aborted) return
      if (!res.headersSent) res.status(502).send('Gateway proxy error')
    }
  }

  private applyKwikPatches(html: string, kwikUrl: URL, cookieStr: string = ''): string | null {
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

  handleSubtitleProxy = async (req: Request, res: Response) => {
    const { url, referer } = req.query
    if (!url) return res.status(400).send('URL required')

    const safeCheck = isSafeExternalUrl(url)
    if (!safeCheck.safe) {
      return res.status(400).send(safeCheck.error || 'Invalid URL')
    }

    const abortController = new AbortController()
    this.abortWhenClientLeaves(res, abortController)

    const subUrl = url as string
    const refererStr = (referer as string) || ''
    const isAnilight =
      refererStr.includes('anilight.live') ||
      ProxyController.ANILIGHT_HOSTS.some((host) => subUrl.includes(host))
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
        headers['Referer'] = ProxyController.ANILIGHT_REFERER
      }
      if (
        refererStr.startsWith(ProxyController.KAA_ORIGIN) ||
        Array.from(ProxyController.KAA_HOSTS).some((host) => subUrl.includes(host))
      ) {
        headers['Origin'] = ProxyController.KAA_ORIGIN
      } else if (isAnilight) {
        headers['Origin'] = ProxyController.ANILIGHT_ORIGIN
      }
      return headers
    }

    const fetchText = async (
      target: string,
      retries = 1
    ): Promise<{ status: number; body: string } | null> => {
      const headers = buildHeaders()
      if (innerRawUrl && target === innerRawUrl) {
        headers['Referer'] = ProxyController.ANILIGHT_REFERER
        headers['Origin'] = ProxyController.ANILIGHT_ORIGIN
      }
      try {
        const upstream = await fetchWithRetry(
          target,
          { method: 'GET', headers },
          { retries, timeoutMs: 15000, signal: abortController.signal }
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
        if (abortController.signal.aborted) return null
        logger.warn(
          { target, error: (e as Error)?.message },
          '[subtitle-proxy] upstream fetch failed'
        )
        return { status: 502, body: '' }
      }
    }

    try {
      const headers = buildHeaders()

      let result = await fetchText(subUrl, 1)
      if (abortController.signal.aborted) return
      if ((!result || !result.body) && innerRawUrl) {
        result = await fetchText(innerRawUrl, 0)
        if (abortController.signal.aborted) return
      }
      if (!result || !result.body) {
        res.set('Access-Control-Allow-Origin', '*')
        res.set('Cache-Control', 'no-store')
        return res.status(502).send('Subtitle upstream error')
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
              { retries: 1, timeoutMs: 15000, signal: abortController.signal }
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
          } catch (e) {
            if (abortController.signal.aborted) return
          }
        }
        if (parts.length === 0) {
          res.set('Access-Control-Allow-Origin', '*')
          res.set('Cache-Control', 'no-store')
          return res.status(502).send('Subtitle playlist empty')
        }
        res.set('Content-Type', 'text/vtt; charset=utf-8')
        res.set('Access-Control-Allow-Origin', '*')
        res.set('Cache-Control', 'public, max-age=86400')
        return res.send(`WEBVTT\n\n${parts.join('\n\n')}\n`)
      }
      res.set('Content-Type', 'text/vtt; charset=utf-8')
      res.set('Access-Control-Allow-Origin', '*')
      res.set('Cache-Control', 'public, max-age=86400')
      if (/^\s*WEBVTT/i.test(body)) return res.send(body)
      return res.send(
        `WEBVTT\n\n${body.replace(/\r\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`
      )
    } catch (e) {
      if (abortController.signal.aborted) return
      logger.warn({ url: subUrl, error: (e as Error)?.message }, '[subtitle-proxy] failed')
      if (!res.headersSent) {
        res.set('Access-Control-Allow-Origin', '*')
        res.set('Cache-Control', 'no-store')
        res.status(502).send('Subtitle upstream error')
      }
    }
  }

  handleImageProxy = async (req: Request, res: Response) => {
    const { url, cookie, ua } = req.query
    if (!url) return res.status(400).send('URL required')

    const safeCheck = isSafeExternalUrl(url)
    if (!safeCheck.safe) {
      return res.status(400).send(safeCheck.error || 'Invalid URL')
    }

    const targetUrl = url as string
    const abortController = new AbortController()
    this.abortWhenClientLeaves(res, abortController)

    let refererValue = 'https://anilist.co/'
    const headers: Record<string, string> = {
      'User-Agent':
        (ua as string) ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }

    try {
      if (targetUrl.includes('animepahe')) {
        refererValue = 'https://animepahe.pw/'
        const rawCookie = (cookie as string) || ''
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
        const rawCookie = (cookie as string) || ''
        let sanitized = rawCookie.trim()
        sanitized = sanitized.replace(/^cf_clearance/i, '')
        sanitized = sanitized.replace(/^[:=]\s*/, '')
        sanitized = sanitized.replace(/["']/g, '').trim()
        if (sanitized) headers['Cookie'] = `cf_clearance=${sanitized}`
        const uaParam = (ua as string) || ''
        if (uaParam) headers['User-Agent'] = uaParam
      }

      headers['Referer'] = refererValue

      // Use got-scraping for a browser-like TLS fingerprint (needed for hosts
      // like i.animepahe.pw that reject stock clients with 403). Retry a
      // couple times since Cloudflare can intermittently challenge.
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
        res.set('Cache-Control', 'public, max-age=604800, immutable')
        res.set('Content-Type', contentType)
        res.set('Access-Control-Allow-Origin', '*')
        return res.send(body)
      }
      this.sendPlaceholder(res)
    } catch (e) {
      if (abortController.signal.aborted) return
      const err = e as { message?: string }
      if (!res.headersSent) {
        this.sendPlaceholder(res)
      }
    }
  }

  handleResolve = async (req: Request, res: Response) => {
    const targetUrl = req.query.url
    if (!targetUrl || typeof targetUrl !== 'string') {
      return res.status(400).json({ error: 'URL required' })
    }

    const safeCheck = isSafeExternalUrl(targetUrl)
    if (!safeCheck.safe) {
      return res.status(400).json({ error: safeCheck.error || 'Invalid URL' })
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

      res.json({
        finalUrl: response.url,
        status: response.status,
      })
    } catch (e) {
      const err = e as { message?: string }
      res.status(500).json({ error: err.message || 'Resolve failed' })
    }
  }

  private sendPlaceholder(res: Response) {
    if (!res.headersSent) res.set('Cache-Control', 'no-store')
    const possiblePaths = [
      path.join(CONFIG.PACKAGE_ROOT, 'client/public/placeholder.svg'),
      path.join(CONFIG.PACKAGE_ROOT, 'client/dist/placeholder.svg'),
      path.join(CONFIG.SERVER_ROOT, '..', 'client/public/placeholder.svg'),
    ]

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return res.sendFile(p, (err) => {
          if (err && !res.headersSent) {
            res.status(404).send('Not Found')
          }
        })
      }
    }

    res.status(404).send('Not Found')
  }
}
