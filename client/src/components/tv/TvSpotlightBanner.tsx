import React, { useMemo } from 'react'
import { useNavigate } from 'react-router'
import SpotlightBannerShell, { type SpotlightSlide } from '../common/SpotlightBanner'
import { tvDetailPath } from '../../lib/tv'

interface TvSpotlightItem {
  id: number
  title: string
  year: string
  type: string
  image: string
  backdrop: string
  overview: string
  vote_average: number
  genre_ids: number[]
}

interface TvSpotlightBannerProps {
  items: TvSpotlightItem[]
}

const GENRE_NAMES: Record<number, string> = {
  10759: 'Action & Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  18: 'Drama',
  10765: 'Sci-Fi & Fantasy',
  9648: 'Mystery',
  28: 'Action',
  12: 'Adventure',
  14: 'Fantasy',
  27: 'Horror',
  878: 'Sci-Fi',
  53: 'Thriller',
  10749: 'Romance',
}

const TvSpotlightBanner: React.FC<TvSpotlightBannerProps> = ({ items }) => {
  const navigate = useNavigate()

  const slides = useMemo<SpotlightSlide[]>(
    () =>
      items.slice(0, 6).map((item) => {
        const path = tvDetailPath(item.type, item.id)
        return {
          key: String(item.id),
          bannerSrc: item.backdrop ? item.backdrop : item.image,
          posterSrc: item.image,
          posterAlt: item.title,
          title: item.title,
          detailTo: path,
          score: item.vote_average > 0 ? Number(item.vote_average).toFixed(1) : null,
          metaItems: [item.type === 'tv' ? 'TV Show' : 'Movie', item.year].filter(Boolean),
          tags: item.genre_ids
            .slice(0, 3)
            .map((id) => GENRE_NAMES[id])
            .filter(Boolean),
          synopsis:
            item.overview.length > 200 ? item.overview.slice(0, 200) + '...' : item.overview,
          primaryLabel: 'Watch Now',
          primaryIcon: 'play',
          onPrimary: () => navigate(path),
          onDetails: () => navigate(path),
        }
      }),
    [items, navigate]
  )

  return <SpotlightBannerShell slides={slides} />
}

export default TvSpotlightBanner
