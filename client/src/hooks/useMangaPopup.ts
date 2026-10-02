import { usePopup } from './usePopup'

export interface MangaPopupData {
  provider: string
  mangaId: string
  title: string
  altTitle?: string | null
  cover: string
  contentRating?: string
  readTarget: string
  progressLabel?: string
  rating?: string
  mature?: boolean
}

export const useMangaPopup = () => usePopup<MangaPopupData>()
