export const isMangaAdult = (item: { contentRating?: string | null; type?: string | null }) =>
  item.contentRating === 'erotica' ||
  item.contentRating === 'pornographic' ||
  item.type === 'doujinshi'

export interface MangaTitleSource {
  title: string
  altTitle?: string | null
  titles?: { en?: string; romaji?: string; native?: string }
}

export type TitlePreference = 'name' | 'nativeName' | 'englishName'

export function resolveMangaTitle(source: MangaTitleSource, preference: TitlePreference): string {
  const variants = source.titles ?? {}
  if (preference === 'englishName') return variants.en || source.title
  if (preference === 'nativeName')
    return variants.native || variants.romaji || source.altTitle || source.title
  return source.title
}

export function mangaNameVariants(source: MangaTitleSource): {
  englishName: string
  nativeName?: string
} {
  return {
    englishName: source.titles?.en ?? source.title,
    nativeName: source.titles?.native ?? source.titles?.romaji ?? source.altTitle ?? undefined,
  }
}

const SYNTHETIC_CHAPTER_RE = /^anilist:ch:(\d+)$/

export function parseSyntheticChapterId(chapterId: string | null | undefined): number | null {
  if (!chapterId) return null
  const match = SYNTHETIC_CHAPTER_RE.exec(chapterId.trim())
  if (!match) return null
  const n = Number.parseInt(match[1], 10)
  return Number.isFinite(n) ? n : null
}

export function findChapterByNumber<T extends { number: string }>(
  chapters: T[],
  chapterNumber: number
): T | null {
  const want = String(chapterNumber)
  const exact = chapters.find((c) => (c.number ?? '').trim() === want)
  if (exact) return exact
  return (
    chapters.find((c) => {
      const n = Number.parseFloat((c.number ?? '').trim())
      return Number.isFinite(n) && n === chapterNumber
    }) ?? null
  )
}
