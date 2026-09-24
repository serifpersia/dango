import React, { memo } from 'react'
import Icon from '../common/Icon'
import AnimePopup from './AnimePopup'
import MediaCard, { type MediaCardDisplay } from '../common/MediaCard'
import mediaStyles from '../common/MediaCard.module.css'
import { formatTime } from '../../lib/utils'

interface Anime {
  _id: string
  id: string
  name: string
  nativeName?: string
  englishName?: string
  thumbnail: string
  type?: string
  episodeNumber?: number
  currentTime?: number
  duration?: number
  showId?: string
  watchedCount?: number
  episodeCount?: number
  availableEpisodes?: {
    sub?: number
    dub?: number
  }
  availableEpisodesDetail?: {
    sub?: string[]
    dub?: string[]
  }
  isAdult?: boolean
  rating?: string
  airTime?: string
  aired?: boolean
  nextEpisodeAirDate?: string
}

interface AnimeCardConfig {
  elements?: {
    poster?: {
      typeBadge?: boolean
      episodeBadge?: boolean
      removeButton?: boolean
      adultBadge?: boolean
    }
    info?: {
      title?: boolean
      mobileBadges?: boolean
      progress?: boolean
      meta?: boolean
    }
  }
}

interface AnimeCardProps {
  anime: Anime
  continueWatching?: boolean
  onRemove?: (id: string) => void
  config?: AnimeCardConfig
  layout?: 'vertical' | 'horizontal'
}

const AnimeCard: React.FC<AnimeCardProps> = memo(
  ({ anime, continueWatching = false, onRemove, config, layout = 'vertical' }) => {
    const ct = anime.currentTime || 0
    const dur = anime.duration || 0
    const WATCHED_THRESHOLD = 0.8
    const hasProgress = ct > 5 && dur > 5 && ct < dur * WATCHED_THRESHOLD
    const showFullBar = ct > 0 && (dur <= 5 || ct >= dur * WATCHED_THRESHOLD)

    const episodeToPlay = anime.episodeNumber

    const linkTo = continueWatching
      ? {
          pathname: episodeToPlay ? `/watch/${anime._id}/${episodeToPlay}` : `/watch/${anime._id}`,
          state: {
            name: anime.name,
            thumbnail: anime.thumbnail,
            nativeName: anime.nativeName,
            englishName: anime.englishName,
            type: anime.type,
          },
        }
      : episodeToPlay
        ? `/watch/${anime._id}/${episodeToPlay}`
        : `/anime/${anime._id}`

    const isWatchLink = (() => {
      if (typeof linkTo === 'string') return linkTo.startsWith('/watch/')
      const pathname = (linkTo as { pathname?: string }).pathname
      return typeof pathname === 'string' && pathname.startsWith('/watch/')
    })()

    const progressString = (() => {
      if (continueWatching && episodeToPlay) {
        return `EP ${episodeToPlay}`
      }

      if (anime.watchedCount !== undefined && anime.watchedCount > 0) {
        return `EP ${anime.watchedCount}`
      }

      return null
    })()

    const airMeta = [
      anime.airTime,
      anime.aired === false && anime.nextEpisodeAirDate
        ? `· ${anime.nextEpisodeAirDate.split(',')[0]}`
        : '',
    ]
      .filter(Boolean)
      .join(' ')

    const adultContent =
      anime.isAdult ||
      anime.rating === 'R+' ||
      anime.rating === 'Rx' ||
      anime.rating?.includes('17+')

    const metaRow = (
      <>
        {(anime.availableEpisodesDetail?.sub || anime.availableEpisodes?.sub) && (
          <div className={mediaStyles.metaItem}>
            <Icon name="closed-captioning" size={10} />
            {anime.availableEpisodesDetail?.sub?.length ?? anime.availableEpisodes?.sub}
          </div>
        )}
        {(anime.availableEpisodesDetail?.dub || anime.availableEpisodes?.dub) && (
          <div className={mediaStyles.metaItem}>
            <Icon name="microphone" size={10} />
            {anime.availableEpisodesDetail?.dub?.length ?? anime.availableEpisodes?.dub}
          </div>
        )}
      </>
    )

    return (
      <MediaCard
        item={{
          id: anime.id || anime.showId || anime._id,
          title: anime.name,
          nativeName: anime.nativeName,
          englishName: anime.englishName,
          thumbnail: anime.thumbnail,
          typeBadge: anime.type || 'TV',
          chapterBadge: progressString,
          airMeta: airMeta || undefined,
          isAdult: adultContent,
          notAired: anime.aired === false,
        }}
        linkTo={linkTo}
        hoverIcon={isWatchLink ? 'play' : 'info'}
        progress={
          hasProgress
            ? { percent: (ct / dur) * 100, label: `${formatTime(ct)} / ${formatTime(dur)}` }
            : showFullBar
              ? { percent: 100, label: 'Watched' }
              : undefined
        }
        showProgress={continueWatching}
        metaRow={metaRow}
        display={config as MediaCardDisplay | undefined}
        layout={layout}
        onRemove={onRemove}
        showRemoveButton={
          config?.elements?.poster?.removeButton ?? (continueWatching && !!onRemove)
        }
        showInfoButton={!continueWatching}
        enrichedId={anime._id}
        renderPopup={(anchorRect, helpers) => (
          <AnimePopup
            showId={anime._id}
            anchorRect={anchorRect}
            onMouseEnter={helpers.onMouseEnter}
            onMouseLeave={helpers.onMouseLeave}
            onRequestClose={helpers.close}
          />
        )}
      />
    )
  }
)

export default AnimeCard
