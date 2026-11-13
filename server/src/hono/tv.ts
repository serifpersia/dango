import type { Hono } from 'hono'
import logger from '../logger.js'
import { fetchWithRetry, linkAbort, setProxyHeaders } from '../utils/http.utils.js'
import { URL } from 'url'
import { isSafeExternalUrl } from '../utils/security.utils.js'
import { pinVariant } from './playlist.js'
import { buildTvMediaRequest } from '../lib/tv-media.js'
import type { TvProvider } from '../providers/tv.types.js'
import type { RemoteProxyRule } from '../providers/remote-types.js'
import { matchProxyRule, resolveOrigin } from './proxy/rules.js'

function proxiedMediaUrl(targetUrl: string, refererStr: string, providerStr: string): string {
  const provider = providerStr ? `&provider=${encodeURIComponent(providerStr)}` : ''
  return `/api/tv/stream-proxy?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(refererStr)}${provider}`
}

function rewriteTvPlaylist(
  body: string,
  baseUrl: URL,
  refererStr: string,
  providerStr: string
): string {
  return body
    .split('\n')
    .map((line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return line
      if (trimmed.startsWith('#')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
          const absolute = new URL(uri, baseUrl).href
          return `URI="${proxiedMediaUrl(absolute, refererStr, providerStr)}"`
        })
      }
      const absolute = new URL(trimmed, baseUrl).href
      return proxiedMediaUrl(absolute, refererStr, providerStr)
    })
    .join('\n')
}

function isPlaylistBody(body: Buffer): boolean {
  return (
    body.length >= 7 &&
    body
      .subarray(0, 32)
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .trimStart()
      .startsWith('#EXTM3U')
  )
}

export function registerTv(
  app: Hono,
  getTvProvider: (name: string) => TvProvider | undefined,
  getProxyRules?: () => RemoteProxyRule[]
) {
  app.get('/api/tv/embed/:provider/:type/:tmdbId', async (c) => {
    const provider = c.req.param('provider')
    const type = c.req.param('type')
    const tmdbId = c.req.param('tmdbId')
    const mediaType = type === 'movie' ? 'movie' : 'tv'
    const numericTmdbId = parseInt(tmdbId, 10)
    if (!numericTmdbId) return c.json({ url: null, error: 'Bad tmdb id' })
    const mod = getTvProvider(String(provider).toLowerCase())
    if (!mod || typeof mod.getEmbedUrl !== 'function') {
      return c.json({ url: null, error: `Unknown TV provider ${provider}` })
    }
    const media = buildTvMediaRequest({
      tmdbId: numericTmdbId,
      type: mediaType,
      season: parseInt(String(c.req.query('season') || '1'), 10) || 1,
      episode: parseInt(String(c.req.query('episode') || '1'), 10) || 1,
    })
    try {
      const url = await mod.getEmbedUrl(media)
      if (!url) return c.json({ url: null, error: 'No embed url' })
      return c.json({ url })
    } catch (e) {
      return c.json({ url: null, error: (e as Error).message })
    }
  })

  app.get('/api/tv/stream-proxy', async (c) => {
    const requestedUrl = c.req.query('url') ?? ''
    const variantMatch = requestedUrl.match(/#v=(\d+)$/)
    const variantIdx = variantMatch ? parseInt(variantMatch[1], 10) : NaN
    const urlStr = requestedUrl.replace(/#.*$/, '')
    const rule = getProxyRules ? matchProxyRule(urlStr, getProxyRules()) : undefined
    const refererStr = c.req.query('referer') || rule?.referer || ''
    const originStr = resolveOrigin(rule, refererStr, c.req.query('origin'))
    const providerStr = (c.req.query('provider') || '').toLowerCase()
    if (!urlStr) return c.text('URL required', 400)
    const providerMod = providerStr ? getTvProvider(providerStr) : undefined
    const rewrite = (body: string, baseUrl: URL) => {
      const providerBody = providerMod?.rewritePlaylist?.(body, baseUrl.href) ?? body
      const pinned = Number.isInteger(variantIdx)
        ? (pinVariant(providerBody, variantIdx) ?? providerBody)
        : providerBody
      return rewriteTvPlaylist(pinned, baseUrl, refererStr, providerStr)
    }

    const safeCheck = isSafeExternalUrl(urlStr)
    if (!safeCheck.safe) {
      return c.text(safeCheck.error || 'Invalid URL', 400)
    }

    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), 30000)
    linkAbort(c.req.raw.signal, abort)

    try {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
      if (refererStr) headers['Referer'] = refererStr
      if (originStr) headers['Origin'] = originStr

      const fetchResp = await fetchWithRetry(
        urlStr,
        {
          headers,
          redirect: 'follow',
        },
        { retries: 3, baseDelayMs: 750, signal: abort.signal }
      )

      const status = fetchResp.status
      if (status !== 200 && status !== 206) {
        return c.text('Upstream error', (status || 502) as 502)
      }

      const contentType = fetchResp.headers.get('content-type') || 'application/octet-stream'

      const outHeaders = new Headers()
      outHeaders.set('Content-Type', contentType)
      setProxyHeaders(outHeaders, (name) => fetchResp.headers.get(name))
      outHeaders.set('Connection', 'keep-alive')

      if (urlStr.includes('.m3u8') || /mpegurl|m3u8/i.test(contentType)) {
        const body = await fetchResp.text()
        const baseUrl = new URL(fetchResp.url || urlStr)
        const rewritten = rewrite(body, baseUrl)
        const bodyBuffer = Buffer.from(rewritten, 'utf8')
        outHeaders.set('Content-Type', 'application/vnd.apple.mpegurl')
        outHeaders.set('Content-Length', String(bodyBuffer.length))
        return new Response(bodyBuffer, { status, headers: outHeaders })
      }

      const reader = fetchResp.body?.getReader()
      if (!reader) {
        logger.warn({ host: safeCheck.url?.hostname }, 'tv stream-proxy: upstream sent no body')
        return c.text('Upstream sent no body', 502)
      }
      try {
        const first = await reader.read()
        const head = first.done ? Buffer.alloc(0) : Buffer.from(first.value)
        if (isPlaylistBody(head)) {
          const chunks = [head]
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(Buffer.from(value))
          }
          const body = Buffer.concat(chunks)
          const baseUrl = new URL(fetchResp.url || urlStr)
          const rewritten = rewrite(body.toString('utf8'), baseUrl)
          const bodyBuffer = Buffer.from(rewritten, 'utf8')
          outHeaders.set('Content-Type', 'application/vnd.apple.mpegurl')
          outHeaders.set('Content-Length', String(bodyBuffer.length))
          return new Response(bodyBuffer, { status, headers: outHeaders })
        }
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            if (head.length) controller.enqueue(head)
          },
          async pull(controller) {
            const { done, value } = await reader.read()
            if (done) controller.close()
            else controller.enqueue(value)
          },
          cancel(reason) {
            return reader.cancel(reason)
          },
        })
        return new Response(stream, { status, headers: outHeaders })
      } catch (err) {
        logger.warn(
          { err, host: safeCheck.url?.hostname },
          'tv stream-proxy: upstream body stream failed'
        )
        return c.text('Upstream stream failed', 502)
      }
    } catch (err) {
      if (abort.signal.aborted) return new Response(null, { status: 499 })
      logger.warn({ err, host: safeCheck.url?.hostname }, 'tv stream-proxy: upstream fetch failed')
      return c.text('Upstream fetch failed', 502)
    } finally {
      clearTimeout(timeout)
    }
  })
}
