import { useEffect, useState, useRef } from 'react'

const CACHE_KEY = 'asmrTranslateCache'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

type CacheEntry = { t: string; ts: number }

function loadCache(): Map<string, CacheEntry> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, CacheEntry>
    return new Map(Object.entries(obj))
  } catch {
    return new Map()
  }
}

function saveCache(map: Map<string, CacheEntry>) {
  try {
    const obj: Record<string, CacheEntry> = {}
    for (const [k, v] of map) obj[k] = v
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj))
  } catch {
    // ignore
  }
}

function hasJapanese(text: string): boolean {
  return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text)
}

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

function normalizeTranslation(s: string): string {
  const trimmed = s.trim()
  if (!trimmed) return trimmed
  return toTitleCase(trimmed)
}

async function translateBatch(texts: string[]): Promise<Map<string, string>> {
  const jobs = texts.map((t) => t.trim()).filter(Boolean)
  if (jobs.length === 0) return new Map()
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: jobs, source: 'ja', target: 'en' }),
  })
  if (!res.ok) throw new Error(`translate ${res.status}`)
  const data = (await res.json()) as { translations: Record<string, string> }
  const map = new Map<string, string>()
  for (const [k, v] of Object.entries(data.translations || {})) {
    map.set(k, v)
  }
  for (const j of jobs) if (!map.has(j)) map.set(j, j)
  return map
}

export function useTranslate(texts: string[], enabled: boolean) {
  const [map, setMap] = useState<Map<string, string>>(new Map())
  const [isTranslating, setIsTranslating] = useState(false)
  const cacheRef = useRef<Map<string, CacheEntry> | null>(null)
  const textsKey = texts.join('\u0001')

  useEffect(() => {
    const allTexts = textsKey ? textsKey.split('\u0001') : []
    if (!enabled || allTexts.length === 0) {
      setMap(new Map())
      setIsTranslating(false)
      return
    }

    const unique = Array.from(
      new Set(
        allTexts
          .map((t) => t.trim())
          .filter(Boolean)
          .filter(hasJapanese)
      )
    )
    if (unique.length === 0) {
      setMap(new Map())
      return
    }

    if (!cacheRef.current) cacheRef.current = loadCache()

    const now = Date.now()
    const cached = new Map<string, string>()
    const toFetch: string[] = []

    for (const t of unique) {
      const entry = cacheRef.current.get(t)
      if (entry && now - entry.ts < CACHE_TTL_MS) {
        cached.set(t, entry.t)
      } else {
        toFetch.push(t)
      }
    }

    if (toFetch.length === 0) {
      setMap(cached)
      return
    }

    let cancelled = false
    setIsTranslating(true)

    const chunks: string[][] = []
    for (let i = 0; i < toFetch.length; i += 15) chunks.push(toFetch.slice(i, i + 15))
    ;(async () => {
      const fetched = new Map<string, string>()
      for (const chunk of chunks) {
        try {
          const batchMap = await translateBatch(chunk)
          for (const [k, v] of batchMap) fetched.set(k, v)
        } catch {
          // ignore
        }
        await new Promise((r) => setTimeout(r, 120))
      }

      if (cancelled) return

      if (cacheRef.current) {
        for (const [k, v] of fetched) cacheRef.current.set(k, { t: v, ts: Date.now() })
        saveCache(cacheRef.current)
      }

      const combined = new Map<string, string>([...cached, ...fetched])
      setMap(combined)
      setIsTranslating(false)
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, textsKey])

  const t = (orig: string): string => {
    if (!enabled || !orig) return orig
    if (!hasJapanese(orig)) return orig
    return map.get(orig.trim()) || orig
  }

  return { t, map, isTranslating }
}
