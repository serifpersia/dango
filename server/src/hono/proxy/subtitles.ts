import type { Context } from 'hono'
import { gotScraping } from 'got-scraping'
import { gunzipSync } from 'node:zlib'
import { buildCfClearanceCookie } from '../../utils/cookie.utils.js'
import { isSafeExternalUrl } from '../../utils/security.utils.js'
import { fetchWithRetry, linkAbort, UPSTREAM_RETRY } from '../../utils/http.utils.js'
import type { RemoteProxyRule } from '../../providers/remote-types.js'
import logger from '../../logger.js'
import { matchProxyRule, resolveOrigin } from './rules.js'

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

const SUB_WRAP_AT = 50

function splitBalancedCueLine(line: string): string[] {
  const words = line.split(/\s+/).filter((w) => w.length > 0)
  if (words.length < 2) return [line]
  const total = words.join(' ').length
  if (total <= SUB_WRAP_AT) return [line]
  const target = total / 2
  let acc = words[0]?.length ?? 0
  let best = 1
  let bestDiff = Math.abs(acc - target)
  for (let i = 1; i < words.length; i++) {
    acc += 1 + (words[i]?.length ?? 0)
    const diff = Math.abs(acc - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = i + 1
    }
  }
  if (best <= 0 || best >= words.length) return [line]
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')]
}

function rewrapVttCues(vtt: string): string {
  const blocks = vtt.replace(/\r\n/g, '\n').split(/\n\n+/)
  return blocks
    .map((block, idx) => {
      if (idx === 0 && /^\s*WEBVTT/i.test(block)) return block
      const lines = block.split('\n')
      const tIdx = lines.findIndex((l) => l.includes('-->'))
      if (tIdx < 0) return block
      const payload = lines.slice(tIdx + 1).filter((l) => l.trim() !== '')
      if (payload.length !== 1) return block
      const split = splitBalancedCueLine((payload[0] ?? '').trim())
      if (split.length < 2) return block
      return [...lines.slice(0, tIdx + 1), ...split].join('\n')
    })
    .join('\n\n')
}

export async function proxySubtitles(c: Context, getProxyRules: () => RemoteProxyRule[]) {
  const url = c.req.query('url')
  if (!url) return c.text('URL required', 400)

  const safeCheck = isSafeExternalUrl(url)
  if (!safeCheck.safe) {
    return c.text(safeCheck.error || 'Invalid URL', 400)
  }

  const abort = new AbortController()
  linkAbort(c.req.raw.signal, abort)

  const subUrl = url as string
  const rule = matchProxyRule(subUrl, getProxyRules())
  const refererStr = c.req.query('referer') || rule?.referer || ''
  const originStr = resolveOrigin(rule, refererStr, c.req.query('origin'))
  const useScrape = c.req.query('scrape') === '1' || rule?.scrape === true
  const cookieStr = c.req.query('cookie') || ''

  const buildHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/vtt,text/plain,*/*;q=0.8',
    }
    if (refererStr) headers['Referer'] = refererStr
    if (originStr) headers['Origin'] = originStr
    if (cookieStr) {
      const cookieHeader =
        c.req.query('cf') === '1' || rule?.cfCookie ? buildCfClearanceCookie(cookieStr) : cookieStr
      if (cookieHeader) headers['Cookie'] = cookieHeader
    }
    return headers
  }

  const normEnc = (enc: string): string => {
    const e = enc
      .trim()
      .toLowerCase()
      .replace(/^windows-/, 'windows-')
      .replace(/^win-/, 'windows-')
    if (!e) return 'utf-8'
    if (e === 'cp1251' || e === 'win1251') return 'windows-1251'
    if (e === 'cp1252' || e === 'win1252') return 'windows-1252'
    if (e === 'cp1250' || e === 'win1250') return 'windows-1250'
    if (e === 'cp1253' || e === 'win1253') return 'windows-1253'
    if (e === 'cp1254' || e === 'win1254') return 'windows-1254'
    if (e === 'cp1255' || e === 'win1255') return 'windows-1255'
    if (e === 'cp1256' || e === 'win1256') return 'windows-1256'
    if (e === 'iso-8859-1' || e === 'iso8859-1' || e === 'latin1') return 'windows-1252'
    if (e === 'koi8-r' || e === 'koi8r') return 'koi8-r'
    return e
  }

  const decodeSubText = (buf: Buffer): string => {
    let b = buf
    if (b.length > 2 && b[0] === 0x1f && b[1] === 0x8b) {
      try {
        b = gunzipSync(b)
      } catch {
        // keep original
      }
    }
    const wanted = normEnc(c.req.query('enc') || c.req.query('encoding') || '')
    try {
      return new TextDecoder(wanted).decode(b).replace(/^\uFEFF/, '')
    } catch {
      return b.toString('utf8').replace(/^\uFEFF/, '')
    }
  }

  const fetchText = async (
    target: string,
    retries = 1
  ): Promise<{ status: number; body: string } | null> => {
    const headers = buildHeaders()
    if (useScrape) {
      try {
        const upstream = await gotScraping({
          url: target,
          method: 'GET',
          headers,
          responseType: 'buffer',
          timeout: { request: 15000 },
          followRedirect: true,
          throwHttpErrors: false,
          retry: UPSTREAM_RETRY,
        })
        if (upstream.statusCode !== 200) {
          logger.warn(
            { target, status: upstream.statusCode },
            '[subtitle-proxy] upstream returned error status'
          )
          return { status: upstream.statusCode, body: '' }
        }
        const body = decodeSubText(Buffer.from(upstream.body as Buffer))
        if (/^\s*\{[\s\S]*"error"[\s\S]*\}\s*$/.test(body.slice(0, 500))) {
          logger.warn({ target, body: body.slice(0, 200) }, '[subtitle-proxy] upstream JSON error')
          return { status: 502, body: '' }
        }
        return { status: 200, body }
      } catch (e) {
        if (abort.signal.aborted) return null
        logger.warn(
          { target, error: (e as Error)?.message },
          '[subtitle-proxy] upstream fetch failed'
        )
        return { status: 502, body: '' }
      }
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
      const body = decodeSubText(Buffer.from(await upstream.arrayBuffer()))
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

  const subtitleError = (text: string) => {
    const headers = new Headers()
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Cache-Control', 'no-store')
    return new Response(text, { status: 502, headers })
  }

  try {
    const headers = buildHeaders()

    const result = await fetchText(subUrl, 1)
    if (abort.signal.aborted) return new Response(null, { status: 499 })
    if (!result || !result.body) {
      return subtitleError('Subtitle upstream error')
    }
    const body = result.body
    const baseForSegments = subUrl
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
          let segBody = decodeSubText(Buffer.from(await segRes.arrayBuffer()))
          if (/#EXTM3U/i.test(segBody.slice(0, 200))) continue
          segBody = segBody.replace(/\r\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
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
        return subtitleError('Subtitle playlist empty')
      }
      return new Response(rewrapVttCues(`WEBVTT\n\n${parts.join('\n\n')}\n`), {
        headers: vttHeaders('public, max-age=86400'),
      })
    }
    if (/^\s*WEBVTT/i.test(body)) {
      return new Response(rewrapVttCues(body), {
        headers: vttHeaders('public, max-age=86400'),
      })
    }
    const vttFromAss = assToVtt(body)
    if (vttFromAss) {
      return new Response(rewrapVttCues(vttFromAss), {
        headers: vttHeaders('public, max-age=86400'),
      })
    }
    return new Response(
      rewrapVttCues(
        `WEBVTT\n\n${body.replace(/\r\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`
      ),
      { headers: vttHeaders('public, max-age=86400') }
    )
  } catch {
    if (abort.signal.aborted) return new Response(null, { status: 499 })
    logger.warn({ url: subUrl }, '[subtitle-proxy] failed')
    return subtitleError('Subtitle upstream error')
  }
}
