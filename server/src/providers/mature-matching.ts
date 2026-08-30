export interface MatchCandidate {
  title: string
}

export function normalizeCompact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
}

export function bigramDice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  const grams = (s: string) => {
    const map = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      map.set(g, (map.get(g) || 0) + 1)
    }
    return map
  }
  const A = grams(a)
  const B = grams(b)
  let totalA = 0
  let totalB = 0
  let shared = 0
  A.forEach((c) => (totalA += c))
  B.forEach((c) => (totalB += c))
  A.forEach((c, g) => {
    const other = B.get(g)
    if (other) shared += Math.min(c, other)
  })
  return (2 * shared) / (totalA + totalB)
}

const STOPWORDS = new Set([
  'the',
  'animation',
  'no',
  'wa',
  'ga',
  'wo',
  'ni',
  'de',
  'to',
  'e',
  'o',
  'x',
  'ii',
  'yo',
  'ova',
  'oad',
  'hd',
  'ep',
  'episode',
  'season',
  'part',
  'hen',
  'a',
])

export function distinctiveTokens(s: string): string[] {
  return [...new Set(tokenize(s).filter((w) => !STOPWORDS.has(w)))]
}

export function titleSimilarity(query: string, candidate: string): number {
  const q = normalizeCompact(query)
  const c = normalizeCompact(candidate)
  if (!q || !c) return 0
  if (q === c) return 1

  let score = bigramDice(q, c)

  if (q.startsWith(c) || c.startsWith(q)) {
    const prefixScore = 0.5 + 0.5 * (Math.min(q.length, c.length) / Math.max(q.length, c.length))
    if (prefixScore > score) score = prefixScore
  }

  const qD = distinctiveTokens(query)
  const cD = distinctiveTokens(candidate)
  if (qD.length > 0 && cD.length >= 2) {
    const cSet = new Set(cD)
    let hits = 0
    for (const t of qD) {
      if (cSet.has(t)) hits++
    }
    const coverage = hits / Math.min(qD.length, cD.length)
    if (coverage > score) score = coverage
  }

  return score
}

export function pickBestMatch<T extends MatchCandidate>(
  candidates: T[],
  targets: string[],
  minScore = 0.6
): { item: T; score: number } | null {
  if (!candidates.length) return null
  const cleanTargets = targets.filter((t): t is string => !!t && t.trim().length > 0)
  if (!cleanTargets.length) return null

  let best: { item: T; score: number } | null = null
  for (const item of candidates) {
    if (!item.title) continue
    let score = 0
    for (const target of cleanTargets) {
      const s = titleSimilarity(target, item.title)
      if (s > score) score = s
    }
    if (!best || score > best.score) best = { item, score }
  }
  return best && best.score >= minScore ? best : null
}

export function buildQueryVariants(title: string, romaji?: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (q: string) => {
    const v = q.replace(/\s+/g, ' ').trim()
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase())
      out.push(v)
    }
  }

  if (romaji && romaji.trim()) push(romaji)
  push(title)

  const stripped = (s: string) => s.replace(/[^\p{L}\p{N}\s]/gu, ' ')
  push(stripped(title))
  if (romaji) push(stripped(romaji))

  const words = stripped(title).split(/\s+/).filter(Boolean)
  if (words.length > 3) push(words.slice(0, 3).join(' '))
  if (words.length > 4) push(words.slice(0, 4).join(' '))

  const tokens = distinctiveTokens(title)
    .concat(romaji ? distinctiveTokens(romaji) : [])
    .filter((w) => w.length >= 4)
  const unique = [...new Set(tokens)]
  unique.sort((a, b) => b.length - a.length)
  for (const t of unique.slice(0, 4)) push(t)

  return out
}
