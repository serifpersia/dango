import type { Context } from 'hono'
import { gotScraping } from 'got-scraping'
import { buildCfClearanceCookie, sanitizeCfClearance } from '../../utils/cookie.utils.js'
import { isSafeExternalUrl } from '../../utils/security.utils.js'
import {
  fetchWithRetry,
  linkAbort,
  setProxyHeaders,
  UPSTREAM_RETRY,
} from '../../utils/http.utils.js'
import type { RemoteProxyRule } from '../../providers/remote-types.js'
import logger from '../../logger.js'
import { fetchWithMirrors, matchProxyRule, PROXY_UA, resolveOrigin } from './rules.js'
import { placeholderSvg } from './embed.js'
import { pinVariant } from '../playlist.js'
import { proxyCache } from './cache.js'

const BINARY_MEDIA_RE = /\.(?:mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|webm|mkv|m4v|ts|m4s)(?:$|\?)/i
const HLS_CHUNK_RE = /\.(?:ts|m4s)(?:$|\?)/i

export function isBinaryMediaUrl(url: string): boolean {
  return BINARY_MEDIA_RE.test(url)
}

function encMpdParam(value: string): string {
  return value
    .replace(/&/g, '%26')
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
    .replace(/\+/g, '%2B')
    .replace(/ /g, '%20')
}

export function makeMpdProxier(refererStr: string, originStr: string, uaStr: string) {
  return (absolute: string) => {
    let proxied = `/api/proxy?url=${encMpdParam(absolute)}`
    if (refererStr) proxied += `&referer=${encMpdParam(refererStr)}`
    if (originStr) proxied += `&origin=${encMpdParam(originStr)}`
    if (uaStr) proxied += `&ua=${encMpdParam(uaStr)}`
    return proxied.replace(/&/g, '&amp;')
  }
}

export function rewriteMpdBody(
  body: string,
  finalUrl: string,
  buildProxied: (absolute: string) => string
): string {
  const baseUrl = new URL(finalUrl)
  const proxyAttr = (value: string) => {
    if (value.includes('/api/proxy')) return value
    return buildProxied(new URL(value, baseUrl).href)
  }
  return body
    .replace(/(initialization|media|sourceURL)="([^"]+)"/g, (_, attr, value) =>
      value.startsWith('data:') ? _ : `${attr}="${proxyAttr(value)}"`
    )
    .replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_, value) => {
      const trimmed = String(value).trim()
      return `<BaseURL>${proxyAttr(trimmed)}</BaseURL>`
    })
}

export async function proxyStream(c: Context, getProxyRules: () => RemoteProxyRule[]) {
  const url = c.req.query('url')
  if (!url) return c.text('URL required', 400)

  const safeCheck = isSafeExternalUrl(url)
  if (!safeCheck.safe) {
    return c.text(safeCheck.error || 'Invalid URL', 400)
  }

  const urlStr = url as string
  const rule = matchProxyRule(urlStr, getProxyRules())
  const refererStr = c.req.query('referer') || rule?.referer || ''
  const originStr = resolveOrigin(rule, refererStr, c.req.query('origin'))
  const uaStr = c.req.query('ua') || ''
  const cookieStr = c.req.query('cookie') || ''
  const useScrape = c.req.query('scrape') === '1' || rule?.scrape === true
  const isBinaryMedia = isBinaryMediaUrl(urlStr)
  const useCf = c.req.query('cf') === '1' || rule?.cfCookie === true
  const variantRaw = c.req.query('variant')
  const variantIdx = variantRaw !== undefined ? parseInt(variantRaw, 10) : NaN
  const pinVar = Number.isInteger(variantIdx) && (variantIdx as number) >= 0
  const cacheKey = `m3u8-${urlStr}-${refererStr}-${originStr}-${uaStr}-${sanitizeCfClearance(cookieStr)}-${useScrape ? 'scrape' : 'raw'}-${useCf ? 'cf' : 'nocf'}${pinVar ? `-v${variantIdx}` : ''}`

  const abort = new AbortController()
  linkAbort(c.req.raw.signal, abort)

  try {
    const headers: Record<string, string> = {
      'User-Agent': uaStr || PROXY_UA,
    }
    if (refererStr) headers['Referer'] = refererStr
    if (originStr) headers['Origin'] = originStr
    if (cookieStr) {
      const cookieHeader = useCf ? buildCfClearanceCookie(cookieStr) : cookieStr
      if (cookieHeader) headers['Cookie'] = cookieHeader
    }
    const range = c.req.header('range')
    if (range) headers['Range'] = range

    const playlistResponse = (body: string) => {
      const outHeaders = new Headers()
      outHeaders.set('Content-Type', 'application/vnd.apple.mpegurl')
      outHeaders.set('Access-Control-Allow-Origin', '*')
      return new Response(body, { headers: outHeaders })
    }
    const proxiedMediaUrl = (targetUrl: string) => {
      const params = new URLSearchParams({ url: targetUrl })
      if (refererStr) params.set('referer', refererStr)
      if (originStr) params.set('origin', originStr)
      if (uaStr) params.set('ua', uaStr)
      if (cookieStr) params.set('cookie', sanitizeCfClearance(cookieStr))
      if (useScrape) params.set('scrape', '1')
      if (useCf) params.set('cf', '1')
      return `/api/proxy?${params}`
    }
    const rewritePlaylist = (playlistBody: string, finalUrl: string) => {
      const baseUrl = new URL(finalUrl)
      const needsProxy = Boolean(refererStr || originStr || uaStr || useScrape)
      const isProxied = (value: string) => value.includes('/api/proxy')
      const pinned = pinVar ? pinVariant(playlistBody, variantIdx as number) : null
      return (pinned || playlistBody)
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
    }

    const rewriteMpd = (mpdBody: string, finalUrl: string) =>
      rewriteMpdBody(mpdBody, finalUrl, makeMpdProxier(refererStr, originStr, uaStr))

    if (urlStr.includes('.mpd')) {
      const cached = proxyCache.get<string>(cacheKey)
      if (cached) {
        const headers = new Headers()
        headers.set('Content-Type', 'application/dash+xml')
        headers.set('Access-Control-Allow-Origin', '*')
        return new Response(cached, { headers })
      }

      const resp = await fetchWithMirrors(
        urlStr,
        rule?.mirrors,
        abort.signal,
        (candidate) =>
          gotScraping({
            url: candidate,
            method: 'GET',
            headers,
            responseType: 'text',
            timeout: { request: 30000 },
            followRedirect: true,
            throwHttpErrors: false,
            retry: UPSTREAM_RETRY,
          }),
        (attempt) => attempt.statusCode === 200 || attempt.statusCode === 206
      )

      if (!resp || (resp.statusCode !== 200 && resp.statusCode !== 206)) {
        return c.text('Upstream error', (resp?.statusCode || 502) as 502)
      }

      const rewritten = rewriteMpd(resp.body as string, resp.url || urlStr)
      proxyCache.set(cacheKey, rewritten)
      const outHeaders = new Headers()
      outHeaders.set('Content-Type', 'application/dash+xml')
      outHeaders.set('Access-Control-Allow-Origin', '*')
      return new Response(rewritten, { headers: outHeaders })
    }

    if (urlStr.includes('.m3u8')) {
      const cached = proxyCache.get<string>(cacheKey)
      if (cached) {
        const headers = new Headers()
        headers.set('Content-Type', 'application/vnd.apple.mpegurl')
        headers.set('Access-Control-Allow-Origin', '*')
        return new Response(cached, { headers })
      }

      const resp = await fetchWithMirrors(
        urlStr,
        rule?.mirrors,
        abort.signal,
        (candidate) =>
          gotScraping({
            url: candidate,
            method: 'GET',
            headers,
            responseType: 'text',
            timeout: { request: 30000 },
            followRedirect: true,
            throwHttpErrors: false,
            retry: UPSTREAM_RETRY,
          }),
        (attempt) => attempt.statusCode === 200 || attempt.statusCode === 206
      )

      if (!resp || (resp.statusCode !== 200 && resp.statusCode !== 206)) {
        return c.text('Upstream error', (resp?.statusCode || 502) as 502)
      }

      const rewritten = rewritePlaylist(resp.body as string, resp.url || urlStr)
      proxyCache.set(cacheKey, rewritten)
      return playlistResponse(rewritten)
    } else {
      if (useScrape && (!isBinaryMedia || HLS_CHUNK_RE.test(urlStr))) {
        const resp = await fetchWithMirrors(
          urlStr,
          rule?.mirrors,
          abort.signal,
          (candidate) =>
            gotScraping({
              url: candidate,
              method: 'GET',
              headers,
              responseType: 'buffer',
              timeout: { request: 30000 },
              followRedirect: true,
              throwHttpErrors: false,
              retry: UPSTREAM_RETRY,
            }),
          (attempt) => attempt.statusCode === 200 || attempt.statusCode === 206
        )

        if (!resp || (resp.statusCode !== 200 && resp.statusCode !== 206)) {
          return c.text('Upstream error', (resp?.statusCode || 502) as 502)
        }

        const ct = resp.headers['content-type']
        const isVtt = urlStr.endsWith('.vtt') || urlStr.includes('.vtt?')
        const bodyText = String(resp.body ?? '')
        if (
          !isVtt &&
          ((typeof ct === 'string' && ct.includes('mpegurl')) || bodyText.startsWith('#EXTM3U'))
        ) {
          const cached = proxyCache.get<string>(cacheKey)
          const rewritten = cached ?? rewritePlaylist(bodyText, resp.url || urlStr)
          if (!cached) proxyCache.set(cacheKey, rewritten)
          return playlistResponse(rewritten)
        }
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
        const upstream = await fetchWithMirrors(
          urlStr,
          rule?.mirrors,
          abort.signal,
          async (candidate) => {
            const attempt = await fetchWithRetry(
              candidate,
              { method: 'GET', headers },
              { retries: 3, timeoutMs: 30000, signal: abort.signal }
            )
            if (attempt.status !== 200 && attempt.status !== 206) {
              try {
                await attempt.body?.cancel()
              } catch {
                // ignore
              }
            }
            return attempt
          },
          (attempt) => attempt.status === 200 || attempt.status === 206
        )
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
}
