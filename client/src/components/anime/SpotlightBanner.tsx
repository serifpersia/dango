import React, { useMemo } from 'react'
import { useNavigate } from 'react-router'
import SpotlightBannerShell, { type SpotlightSlide } from '../common/SpotlightBanner'
import type { Anime, SpotlightSource } from '../../hooks/useAnimeData'
import { fixThumbnailUrl, sanitizeText } from '../../lib/utils'
import { useTitlePreference } from '../../contexts/TitlePreferenceContext'

interface SpotlightBannerProps {
  animeList: Anime[]
  source?: SpotlightSource
  onSourceChange?: (source: SpotlightSource) => void
}

const SOURCE_OPTIONS = [
  { value: 'forYou', label: 'For You' },
  { value: 'trending', label: 'Trending' },
  { value: 'thisWeek', label: 'This Week' },
  { value: 'season', label: 'This Season' },
  { value: 'popular', label: 'Popular' },
  { value: 'top', label: 'Top Rated' },
  { value: 'upcoming', label: 'Upcoming' },
]

const SpotlightBanner: React.FC<SpotlightBannerProps> = ({ animeList, source, onSourceChange }) => {
  const { titlePreference } = useTitlePreference()
  const navigate = useNavigate()

  const slides = useMemo<SpotlightSlide[]>(
    () =>
      animeList.slice(0, 6).map((anime) => {
        const title =
          titlePreference === 'nativeName'
            ? anime.nativeName || anime.name
            : titlePreference === 'englishName'
              ? anime.englishName || anime.name
              : anime.name
        return {
          key: anime._id,
          bannerSrc: anime.bannerImage
            ? fixThumbnailUrl(anime.bannerImage, 1280, 560)
            : fixThumbnailUrl(anime.thumbnail, 1280, 450),
          posterSrc: fixThumbnailUrl(anime.thumbnail, 460, 650),
          posterAlt: title,
          title,
          detailTo: `/anime/${anime._id}`,
          score: anime.score,
          metaItems: [
            anime.type || 'Anime',
            anime.status,
            anime.episodeCount ? `${anime.episodeCount} Episodes` : undefined,
            anime.rating,
          ].filter((item): item is string => Boolean(item)),
          tags: (anime.genres ?? [])
            .slice(0, 3)
            .map((g) => (typeof g === 'string' ? g : g?.name))
            .filter((name): name is string => Boolean(name)),
          synopsis: sanitizeText(anime.description ?? ''),
          primaryLabel: 'Watch Now',
          primaryIcon: 'play',
          onPrimary: () => navigate(`/watch/${anime._id}`),
          onDetails: () => navigate(`/anime/${anime._id}`),
        }
      }),
    [animeList, titlePreference, navigate]
  )

  return (
    <SpotlightBannerShell
      slides={slides}
      selector={
        source && onSourceChange
          ? {
              label: 'Spotlight source',
              value: source,
              options: SOURCE_OPTIONS,
              onChange: (value) => onSourceChange(value as SpotlightSource),
            }
          : undefined
      }
    />
  )
}

export default SpotlightBanner
