import React, { useMemo } from 'react'
import { useNavigate } from 'react-router'
import SpotlightBannerShell, { type SpotlightSlide } from '../common/SpotlightBanner'
import type { MangaTrendingItem } from '../../hooks/useManga'

interface MangaSpotlightBannerProps {
  mangaList: MangaTrendingItem[]
}

const MangaSpotlightBanner: React.FC<MangaSpotlightBannerProps> = ({ mangaList }) => {
  const navigate = useNavigate()

  const slides = useMemo<SpotlightSlide[]>(
    () =>
      mangaList.slice(0, 6).map((manga) => ({
        key: manga.id,
        bannerSrc: manga.cover || '',
        posterSrc: manga.cover,
        posterAlt: manga.title,
        title: manga.title,
        detailTo: `/manga/mangadex/${manga.id}`,
        metaItems: [manga.year ? String(manga.year) : undefined, manga.status ?? undefined].filter(
          (item): item is string => Boolean(item)
        ),
        tags: manga.tags.slice(0, 3),
        synopsis: manga.description?.slice(0, 200) || '',
        primaryLabel: 'Read Now',
        primaryIcon: 'book',
        onPrimary: () => navigate(`/manga/mangadex/${manga.id}`),
        onDetails: () => navigate(`/manga/mangadex/${manga.id}`),
      })),
    [mangaList, navigate]
  )

  return <SpotlightBannerShell slides={slides} />
}

export default MangaSpotlightBanner
