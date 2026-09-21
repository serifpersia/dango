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
