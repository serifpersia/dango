import { MangaProgressRepository } from '../../../repositories/manga.repository.js'
import { DatabaseWrapper } from '../../../db.js'

export const TOKEN_KEY = 'tracker_anilist_token'
export const MANGA_SYNC_STATE_KEY = 'tracker_anilist_manga_sync_state'
export const MANGA_PROVIDER = 'anilist'
export const MAX_TITLE_LOOKUPS_PER_SYNC = 25

export interface MangaSyncSummary {
  pushed: number
  pulled: number
  merged: number
  unchanged: number
  skipped: number
  errors: string[]
  warnings: string[]
}

export type MangaSyncAction =
  | 'push'
  | 'pull'
  | 'merge-push'
  | 'merge-pull'
  | 'delete-local'
  | 'delete-remote'
  | 'unchanged'
  | 'skipped'
  | 'unresolved'
  | 'suspicious'
  | 'error'

export interface MangaSyncDetail {
  mediaId?: number
  title: string
  action: MangaSyncAction
  localStatus?: string
  remoteStatus?: string
  localChapters?: number
  remoteProgress?: number
  note?: string
}

export interface MangaSyncResult {
  summary: MangaSyncSummary
  details: MangaSyncDetail[]
}

export type MangaSyncDirection = 'two-way' | 'pull-only'

export interface MangaSyncOptions {
  direction?: MangaSyncDirection
  deletions?: boolean
}

export function parseChapterProgress(value: unknown): number {
  if (value == null) return 0
  const matches = String(value).match(/(\d+(?:\.\d+)?)/g)
  if (!matches) return 0
  let best = 0
  for (const m of matches) {
    const n = Number(m)
    if (Number.isFinite(n)) best = Math.max(best, Math.floor(n))
  }
  return best
}

export async function getLocalChapterProgress(
  mangaDb: DatabaseWrapper,
  libraryId: string,
  lastChapterNumber?: string | null
): Promise<number> {
  let best = parseChapterProgress(lastChapterNumber)
  try {
    const rows = await MangaProgressRepository.getByKey(mangaDb, libraryId)
    for (const row of rows ?? []) {
      best = Math.max(best, parseChapterProgress(row.chapterNumber))
    }
  } catch {
    // ignore
  }
  return best
}

export function buildAnilistMangaId(mediaId: number): string {
  return `${MANGA_PROVIDER}:${mediaId}`
}

export function buildSyntheticChapterId(progress: number): string {
  return `${MANGA_PROVIDER}:ch:${progress}`
}

export function parseAnilistMangaId(id: string): number | null {
  const match = /^anilist:(\d+)$/i.exec(id.trim())
  if (!match) return null
  const n = Number.parseInt(match[1], 10)
  return Number.isFinite(n) ? n : null
}

export function mangaStatusOrFallback(status: string): string | undefined {
  const known = ['Reading', 'Completed', 'On-Hold', 'Dropped', 'Planned']
  return known.includes(status) ? status : undefined
}

export function normalizeTitle(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function titlesEqual(a: unknown, b: unknown): boolean {
  const na = normalizeTitle(a)
  return na.length > 0 && na === normalizeTitle(b)
}

export function stripEditionSuffix(value: unknown): string {
  let s = String(value ?? '').trim()
  let prev = ''
  while (prev !== s) {
    prev = s
    s = s.replace(/\s*\([^()]*\)$/, '').trim()
  }
  return s
}

export function matchesStrippedBaseTitle(
  item: { title?: string | null; altTitle?: string | null },
  match: { romaji?: string; english?: string; native?: string }
): boolean {
  const candidates = [item.title, item.altTitle]
    .filter((c): c is string => !!c)
    .map(stripEditionSuffix)
    .filter((c) => c.length > 0)
  const remotes = [match.romaji, match.english, match.native]
    .filter((r): r is string => !!r)
    .map(stripEditionSuffix)
    .filter((r) => r.length > 0)
  return candidates.some((c) => remotes.some((r) => titlesEqual(c, r)))
}

export function isExactTitleMatch(
  item: { title?: string | null; altTitle?: string | null },
  match: { romaji?: string; english?: string; native?: string }
): boolean {
  const candidates = [item.title, item.altTitle]
  const remotes = [match.romaji, match.english, match.native]
  return candidates.some((c) => !!c && remotes.some((r) => !!r && titlesEqual(c, r)))
}
