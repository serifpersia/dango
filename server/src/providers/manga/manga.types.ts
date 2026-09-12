export type MangaProviderName = 'mangadex' | 'mangapill'

export type MangaContentRating = 'safe' | 'suggestive' | 'erotica' | 'pornographic'

export interface MangaCard {
  id: string
  provider: MangaProviderName
  title: string
  altTitle?: string
  cover: string
  status?: string
  year?: number | null
  type?: string
  genres?: string[]
  contentRating?: string
  latestChapter?: string
}

export interface MangaChapter {
  id: string
  provider: MangaProviderName
  mangaId: string
  number: string
  title?: string
  volume?: string
  language?: string
  pages?: number
  group?: string
  externalUrl?: string
  publishedAt?: string
}

export interface MangaDetail extends MangaCard {
  description?: string
  author?: string
  artist?: string
  chapters: MangaChapter[]
}

export interface MangaSearchOptions {
  query?: string
  page?: number
  limit?: number
  sort?: string
  status?: string
  type?: string
  genres?: string[]
  ratings?: MangaContentRating[]
}

export const SAFE_RATINGS: MangaContentRating[] = ['safe']
export const MATURE_RATINGS: MangaContentRating[] = [
  'safe',
  'suggestive',
  'erotica',
  'pornographic',
]

export interface MangaProvider {
  name: MangaProviderName
  search(
    options: MangaSearchOptions
  ): Promise<{ items: MangaCard[]; hasNext: boolean; total?: number }>
  getDetail(id: string, ratings?: MangaContentRating[]): Promise<MangaDetail | null>
  getChapters(id: string, ratings?: MangaContentRating[]): Promise<MangaChapter[]>
  getPages(chapterId: string): Promise<string[]>
}
