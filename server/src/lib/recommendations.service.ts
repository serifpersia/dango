import { DatabaseWrapper } from '../db.js'
import logger from '../logger.js'
import { InsightsRepository } from '../repositories/insights.repository.js'
import { anilistRequest, AnilistMedia } from '../lib/anilist.js'

export interface TasteProfile {
  genreComp: Record<string, number>
  genreDrop: Record<string, number>
  exemplars: Record<string, string[]>
  knownIds: number[]
  candidates?: RecCandidate[]
}

export interface RecCandidate {
  id: number
  title: string
  url: string
  cover: string | null
  year: number | null
  format: string
  episodes: number | null
  averageScore: number | null
  genres: string[]
  matchPct: number
  sharedGenres: string[]
  exemplars: string[]
  kind: 'entry' | 'continue' | 'sequel'
  prequelTitle: string | null
}

interface LibraryShowRow {
  id: string
  status: string
  title: string
  genres: string
  episodesWatched: number
  popularityScore: number
}

function parseGenres(raw: string): string[] {
  if (!raw) return []
  try {
    if (raw.startsWith('[')) {
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr.map(String) : []
    }
    return raw
      .split(',')
      .map((g: string) => g.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export async function computeTasteProfile(db: DatabaseWrapper): Promise<TasteProfile> {
  const [rows, anilistRows, epRows] = (await Promise.all([
    InsightsRepository.getLibraryShowsWithGenres(db),
    InsightsRepository.getAllAnilistIds(db),
    InsightsRepository.getWatchedEpisodesWithMeta(db),
  ])) as [
    LibraryShowRow[],
    { anilistId: number }[],
    { showId: string; genres: string; name: string; nativeName?: string; englishName?: string }[],
  ]

  const genreComp: Record<string, number> = {}
  const genreDrop: Record<string, number> = {}

  for (const row of rows) {
    const genres = parseGenres(row.genres)
    if (row.status === 'Completed') {
      for (const g of genres) genreComp[g] = (genreComp[g] || 0) + 1
    } else if (row.status === 'Dropped') {
      for (const g of genres) genreDrop[g] = (genreDrop[g] || 0) + 1
    }
  }

  const watchesByGenre: Record<string, Map<string, { title: string; count: number }>> = {}
  for (const ep of epRows) {
    const title = ep.englishName || ep.name || ep.showId
    for (const g of parseGenres(ep.genres)) {
      if (!watchesByGenre[g]) watchesByGenre[g] = new Map()
      const entry = watchesByGenre[g].get(ep.showId) || { title, count: 0 }
      entry.count += 1
      watchesByGenre[g].set(ep.showId, entry)
    }
  }

  const exemplars: Record<string, string[]> = {}
  const topGenres = Object.entries(genreComp)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  for (const [genre] of topGenres) {
    exemplars[genre] = [...(watchesByGenre[genre]?.values() || [])]
      .sort((a, b) => b.count - a.count)
      .slice(0, 2)
      .map((e) => e.title)
  }

  const knownIds = new Set<number>()
  for (const row of rows) {
    if (/^\d+$/.test(row.id)) knownIds.add(Number(row.id))
  }
  for (const r of anilistRows) {
    if (r.anilistId) knownIds.add(r.anilistId)
  }

  return { genreComp, genreDrop, exemplars, knownIds: [...knownIds] }
}

const REC_FIELDS = `id title { romaji english } coverImage { large } averageScore popularity episodes seasonYear format genres isAdult status`

function tasteWeights(
  genreComp: Record<string, number>,
  genreDrop: Record<string, number>
): Record<string, number> {
  const max = Math.max(1, ...Object.values(genreComp))
  const W: Record<string, number> = {}
  for (const [g, c] of Object.entries(genreComp)) {
    const d = genreDrop[g] || 0
    W[g] = (c / max) * (c / (c + d))
  }
  return W
}

function recCombos(W: Record<string, number>): string[][] {
  const top = Object.entries(W)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([g]) => g)
  while (top.length < 2) top.push('Fantasy')
  const pairs = [
    [top[0], top[1]],
    [top[0], top[2] || top[1]],
    [top[1], top[2] || top[0]],
    [top[0], top[3] || top[1]],
  ]
  const seen = new Set<string>()
  return pairs.filter((p) => {
    const key = [...p].sort().join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function exemplarsForCandidate(
  exemplars: Record<string, string[]>,
  candidateGenres: string[],
  n = 2
): string[] {
  const votes = new Map<string, number>()
  for (const g of candidateGenres) {
    for (const t of exemplars[g] || []) votes.set(t, (votes.get(t) || 0) + 1)
  }
  return [...votes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t)
}

export async function computeRecCandidates(taste: TasteProfile): Promise<RecCandidate[]> {
  const knownIds = new Set(taste.knownIds || [])
  if (knownIds.size === 0) return []
  const W = tasteWeights(taste.genreComp, taste.genreDrop)
  const DEFAULT_W = 0.15
  const wsum = Object.values(W).reduce((a, b) => a + b, 0) || 1

  const seen = new Map<number, AnilistMedia>()
  for (const combo of recCombos(W)) {
    try {
      const res = await anilistRequest<{ Page: { media?: AnilistMedia[] } }>(
        `query ($g: [String]) { Page(page: 1, perPage: 20) { media(genre_in: $g, type: ANIME, status: FINISHED, isAdult: false, averageScore_greater: 68, sort: SCORE_DESC) { ${REC_FIELDS} } } }`,
        { g: combo }
      )
      for (const m of res?.data?.Page?.media || []) {
        if (!seen.has(m.id)) seen.set(m.id, m)
      }
    } catch {
      // ignore
    }
  }
  if (seen.size === 0) return []

  const scored = []
  for (const m of seen.values()) {
    if (knownIds.has(m.id) || m.isAdult) continue
    if (m.format === 'MUSIC' || m.format === 'SPECIAL') continue
    const gs = m.genres || []
    const fit = gs.reduce((a, g) => a + (W[g] ?? DEFAULT_W), 0) / wsum
    const score =
      0.65 * fit +
      0.25 * ((m.averageScore || 70) / 100) +
      0.1 * Math.min(1, (m.popularity || 0) / 200000)
    scored.push({ m, score, overlap: gs.filter((g) => (W[g] ?? 0) > 0.3) })
  }
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, 15)

  const relMap = new Map<
    number,
    AnilistMedia & {
      relations?: {
        edges?: {
          relationType?: string
          node?: { id?: number; title?: { romaji?: string; english?: string }; type?: string }
        }[]
      }
    }
  >()
  try {
    const res = await anilistRequest<{
      Page: {
        media?: {
          id: number
          relations?: {
            edges?: {
              relationType?: string
              node?: { id?: number; title?: { romaji?: string; english?: string }; type?: string }
            }[]
          }
        }[]
      }
    }>(
      `query ($ids: [Int]) { Page(page: 1, perPage: 50) { media(id_in: $ids, type: ANIME) { id relations { edges { relationType node { id title { romaji english } type } } } } } }`,
      { ids: top.map((t) => t.m.id) }
    )
    for (const m of res?.data?.Page?.media || []) relMap.set(m.id, m as AnilistMedia)
  } catch {
    // ignore
  }

  return top.map((t) => {
    const rel = relMap.get(t.m.id)
    const pre = rel?.relations?.edges?.find(
      (e) => e.relationType === 'PREQUEL' && e.node?.type === 'ANIME'
    )?.node
    let adj = t.score
    let kind: RecCandidate['kind'] = 'entry'
    let prequelTitle: string | null = null
    if (pre && pre.id && !knownIds.has(pre.id)) {
      kind = 'sequel'
      prequelTitle = pre.title?.english || pre.title?.romaji || null
      adj -= 0.3
    } else if (pre) {
      kind = 'continue'
      adj += 0.05
    }
    const gs = t.m.genres || []
    const title = t.m.title?.english || t.m.title?.romaji || 'Unknown'
    return {
      id: t.m.id,
      title,
      url: `https://anilist.co/anime/${t.m.id}`,
      cover: t.m.coverImage?.large || null,
      year: t.m.seasonYear ?? null,
      format: t.m.format || 'TV',
      episodes: t.m.episodes ?? null,
      averageScore: t.m.averageScore ?? null,
      genres: gs,
      matchPct: Math.round(adj * 100),
      sharedGenres: t.overlap,
      exemplars: exemplarsForCandidate(taste.exemplars, gs),
      kind,
      prequelTitle,
    }
  })
}

let recCache: { hash: string; candidates: RecCandidate[] } | null = null

function tasteHashOf(taste: TasteProfile): string {
  return JSON.stringify([taste.genreComp, taste.genreDrop, taste.knownIds.length])
}

async function refreshCandidatesIfNeeded(
  taste: TasteProfile,
  hash: string
): Promise<RecCandidate[]> {
  if (!recCache || recCache.hash !== hash) {
    try {
      const fresh = await computeRecCandidates(taste)
      if (fresh.length > 0) recCache = { hash, candidates: fresh }
    } catch (err) {
      logger.warn(
        { err: (err as Error)?.message },
        'Recommendation candidates failed, reusing previous'
      )
    }
  }
  return recCache?.candidates || []
}

export async function getCachedRecommendations(db: DatabaseWrapper): Promise<RecCandidate[]> {
  const taste = await computeTasteProfile(db)
  return refreshCandidatesIfNeeded(taste, tasteHashOf(taste))
}
