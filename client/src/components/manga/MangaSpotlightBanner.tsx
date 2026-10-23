import React, { useMemo } from 'react'
import { useNavigate } from 'react-router'
import SpotlightBannerShell, { type SpotlightSlide } from '../common/SpotlightBanner'
import { mangaCoverSrc, type MangaTrendingItem } from '../../hooks/useManga'
import { truncate } from '../../lib/utils'

interface MangaSpotlightBannerProps {
  mangaList: MangaTrendingItem[]
}

const MangaSpotlightBanner: React.FC<MangaSpotlightBannerProps> = ({ mangaList }) => {
  const navigate = useNavigate()

  const slides = useMemo<SpotlightSlide[]>(
    () =>
      mangaList.slice(0, 6).map((manga) => {
        const link = `/manga/${manga.provider || 'mangadex'}/${manga.id}`
        const cover = mangaCoverSrc(manga.provider || 'mangadex', manga.cover || '')
        return {
          key: `${manga.provider}-${manga.id}`,
          bannerSrc: cover,
          posterSrc: cover,
          posterAlt: manga.title,
          title: manga.title,
          detailTo: link,
          metaItems: [
            manga.year ? String(manga.year) : undefined,
            manga.status ?? undefined,
          ].filter((item): item is string => Boolean(item)),
          tags: manga.tags.slice(0, 3),
          synopsis: truncate(manga.description, 200, ''),
          primaryLabel: 'Read Now',
          primaryIcon: 'book',
          onPrimary: () => navigate(link),
          onDetails: () => navigate(link),
        }
      }),
    [mangaList, navigate]
  )

  return <SpotlightBannerShell slides={slides} eyebrow="Manga Spotlight" />
}

export default MangaSpotlightBanner
