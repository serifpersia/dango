import { Request, Response } from 'express'
import axios from 'axios'
import axiosRetry from 'axios-retry'
import { gotScraping } from 'got-scraping'
import path from 'path'
import http from 'http'
import https from 'https'
import NodeCache from 'node-cache'
import { CONFIG } from '../config'
import fs from 'fs'
import logger from '../logger'
import { buildCfClearanceCookie, sanitizeCfClearance } from '../utils/cookie.utils'

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const first = value[0]
    if (typeof first === 'string') return first
  }
  return undefined
}

const proxyCache = new NodeCache({ stdTTL: 30, checkperiod: 60 })

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 })
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 })

httpAgent.setMaxListeners(100)
httpsAgent.setMaxListeners(100)

export const axiosInstance = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 30000,
})

axiosRetry(axiosInstance, { retries: 3, retryDelay: axiosRetry.exponentialDelay })

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

  handleProxy = async (req: Request, res: Response) => {
    const { url, referer, cookie } = req.query
    if (!url) return res.status(400).send('URL required')

    const urlStr = url as string
    const refererStr = (referer as string) || ''
    const cookieStr = (cookie as string) || ''
    const cacheKey = `m3u8-${urlStr}-${refererStr}`

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
          url: urlStr,
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
          (cookieStr ? `&cookie=${encodeURIComponent(sanitizeCfClearance(cookieStr))}` : '')
        const needsProxy = Boolean(refererStr)

        const isProxied = (value: string) => value.includes('/api/proxy')

        const rewritten = resp.body
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
          // Plain media streams (yt-mp4, etc.)
          // Proxy using axios streaming (got-scraping does not support stream/buffer for these hosts)
          const axiosResp = await axiosInstance({
            url: urlStr,
            method: 'get',
            headers,
            responseType: 'stream',
            timeout: 30000,
            signal: abortController.signal,
          })
          const status = axiosResp.status
          if (status !== 200 && status !== 206) {
            return res.status(status ?? 502).send('Upstream error')
          }
          res.status(status)
          const isVtt = urlStr.endsWith('.vtt') || urlStr.includes('.vtt?')
          const ct = firstString(axiosResp.headers['content-type'])
          res.set(
            'Content-Type',
            isVtt ? 'text/vtt; charset=utf-8' : ct || 'application/octet-stream'
          )
          const cl = firstString(axiosResp.headers['content-length'])
          if (cl) res.set('Content-Length', cl)
          const cr = axiosResp.headers['content-range']
          if (cr) res.set('Content-Range', cr)
          const ar = axiosResp.headers['accept-ranges']
          if (ar) res.set('Accept-Ranges', ar)
          res.set('Access-Control-Allow-Origin', '*')
          axiosResp.data.pipe(res)
        }
      }
    } catch (e) {
      if (axios.isCancel(e)) return
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
      if (axios.isCancel(e)) return
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

    const abortController = new AbortController()
    this.abortWhenClientLeaves(res, abortController)

    try {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
      if (referer) headers['Referer'] = referer as string

      const response = await axiosInstance.get(url as string, {
        headers,
        responseType: 'text',
        signal: abortController.signal,
      })
      res.set('Content-Type', 'text/vtt; charset=utf-8').send(response.data)
    } catch (e) {
      if (axios.isCancel(e)) return
      res.status(500).send('Proxy error')
    }
  }

  handleImageProxy = async (req: Request, res: Response) => {
    const { url, cookie, ua } = req.query
    if (!url) return res.status(400).send('URL required')

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
      }

      headers['Referer'] = refererValue

      // Use got-scraping for a browser-like TLS fingerprint (needed for hosts
      // like i.animepahe.pw that reject axios's fingerprint with 403). Retry a
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

  private sendPlaceholder(res: Response) {
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
