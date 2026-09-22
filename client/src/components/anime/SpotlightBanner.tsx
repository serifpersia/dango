import React, { useMemo } from 'react'
import { useNavigate } from 'react-router'
import SpotlightBannerShell, { type SpotlightSlide } from '../common/SpotlightBanner'
import type { Anime } from '../../hooks/useAnimeData'
import { fixThumbnailUrl, sanitizeText } from '../../lib/utils'
import { useTitlePreference } from '../../contexts/TitlePreferenceContext'

interface SpotlightBannerProps {
  animeList: Anime[]
}

const SpotlightBanner: React.FC<SpotlightBannerProps> = ({ animeList }) => {
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

  return <SpotlightBannerShell slides={slides} />
}

export default SpotlightBanner
