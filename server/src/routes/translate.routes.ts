import { Router, Request, Response } from 'express'
import NodeCache from 'node-cache'

const cache = new NodeCache({ stdTTL: 7 * 24 * 60 * 60, checkperiod: 3600 })

function toTitleCase(s: string): string {
  return s
    .split(' ')
    .map((w, i) => {
      if (
        i !== 0 &&
        ['x', 'and', 'or', 'the', 'a', 'an', 'of', 'in', 'on', 'with'].includes(w.toLowerCase())
      ) {
        return w.toLowerCase()
      }
      return w.charAt(0).toUpperCase() + w.slice(1)
    })
    .join(' ')
    .replace(/\bX\b/g, 'x')
}

function normalize(s: string): string {
  const t = s.trim()
  if (!t) return t
  return toTitleCase(t)
}

export function createTranslateRouter(): Router {
  const router = Router()

  router.post('/translate', async (req: Request, res: Response) => {
    const { texts, source = 'ja', target = 'en' } = req.body ?? {}
    if (!Array.isArray(texts) || texts.length === 0) {
      return res.json({ translations: {} })
    }

    const jobs = (texts as unknown[]).map((t) => String(t).trim()).filter(Boolean)
    const result: Record<string, string> = {}
    const toFetch: string[] = []

    for (const t of jobs) {
      const key = `${source}:${target}:${t}`
      const cached = cache.get<string>(key)
      if (cached) result[t] = cached
      else toFetch.push(t)
    }

    if (toFetch.length > 0) {
      const chunks: string[][] = []
      for (let i = 0; i < toFetch.length; i += 15) chunks.push(toFetch.slice(i, i + 15))

      for (const chunk of chunks) {
        const q = chunk.join('\n')
        const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(q)}`
        try {
          const r = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(5000),
          })
          if (!r.ok) throw new Error(`translate ${r.status}`)
          const data = (await r.json()) as unknown
          let translated = ''
          if (Array.isArray(data) && typeof (data as unknown[])[0] === 'string') {
            translated = (data as string[])[0] as string
          } else if (Array.isArray(data) && Array.isArray((data as unknown[])[0])) {
            const outer = data as string[][][]
            translated = outer[0]?.map((p) => p[0]).join('') || ''
          }
          const parts = translated.split('\n')
          chunk.forEach((orig, i) => {
            const trans = (parts[i] ?? '').trim()
            const norm = trans ? normalize(trans) : orig
            result[orig] = norm
            cache.set(`${source}:${target}:${orig}`, norm)
          })
        } catch {
          for (const orig of chunk) {
            if (!result[orig]) result[orig] = orig
          }
        }
        await new Promise((r) => setTimeout(r, 80))
      }
    }

    res.json({ translations: result })
  })

  return router
}
