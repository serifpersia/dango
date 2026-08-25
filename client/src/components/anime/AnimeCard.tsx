import React, { memo, useState, useCallback } from 'react'
import { Link, useNavigate, type To } from 'react-router'
import {
  FaMicrophone,
  FaClosedCaptioning,
  FaTimes,
  FaInfo,
  FaPlay,
  FaInfoCircle,
} from 'react-icons/fa'
import AnimePopup from './AnimePopup'
import GenericModal from '../common/GenericModal'
import { Button } from '../common/Button'

import { fixThumbnailUrl, formatTime } from '../../lib/utils'
import { useTitlePreference } from '../../contexts/TitlePreferenceContext'
import styles from './AnimeCard.module.css'
import useIsMobile from '../../hooks/useIsMobile'
import { useLowEndMode } from '../../contexts/LowEndModeContext'

interface Anime {
  _id: string
  id: string
  name: string
  nativeName?: string
  englishName?: string
  thumbnail: string
  type?: string
  episodeNumber?: number
  relativeEpisodeNumber?: number
  currentTime?: number
  duration?: number
  showId?: string
  nextEpisodeToWatch?: string
  newEpisodesCount?: number
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
  rank?: number
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

const defaultConfig: AnimeCardConfig = {
  elements: {
    poster: {
      typeBadge: true,
      episodeBadge: true,
      adultBadge: true,
    },
    info: {
      title: true,
      mobileBadges: true,
      progress: true,
      meta: true,
    },
  },
}

interface AnimeCardProps {
  anime: Anime
  continueWatching?: boolean
  onRemove?: (id: string) => void
  isLCP?: boolean
  config?: AnimeCardConfig
  layout?: 'vertical' | 'horizontal'
  rank?: number
}

const AnimeCard: React.FC<AnimeCardProps> = memo(
  ({
    anime,
    continueWatching = false,
    onRemove,
    isLCP = false,
    config,
    layout = 'vertical',
    rank,
  }) => {
    const navigate = useNavigate()
    const isMobile = useIsMobile()
    const { titlePreference } = useTitlePreference()
    const { lowEndMode } = useLowEndMode()
    const [isLoaded, setIsLoaded] = useState(false)
    const [isHovered, setIsHovered] = useState(false)
    const [isPopupVisible, setIsPopupVisible] = useState(false)
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
    const timeoutRef = React.useRef<NodeJS.Timeout | null>(null)

    const openPopup = (rect: DOMRect) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      setAnchorRect(rect)
      setIsPopupVisible(true)
    }

    const closePopup = () => {
      setIsPopupVisible(false)
      setAnchorRect(null)
    }

    const schedulePopupClose = useCallback(() => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        closePopup()
      }, 300)
    }, [])

    const clearPopupTimeout = useCallback(() => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }, [])

    const handleInfoMouseEnter = (e: React.MouseEvent) => {
      if (isMobile) return
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      openPopup(rect)
    }

    const handleInfoMouseLeave = () => {
      schedulePopupClose()
    }

    const handlePopupMouseEnter = () => {
      clearPopupTimeout()
    }

    const handlePopupMouseLeave = () => {
      schedulePopupClose()
    }

    const longPressTimerRef = React.useRef<NodeJS.Timeout | null>(null)
    const longPressFiredRef = React.useRef(false)
    const longPressStartRef = React.useRef({ x: 0, y: 0 })
    const activePointerTypeRef = React.useRef<string | null>(null)

    const cancelLongPress = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
    }

    const openPopupFromCard = (rect: DOMRect, viaHold = false) => {
      longPressFiredRef.current = viaHold
      openPopup(rect)
    }

    const handlePointerDown = (e: React.PointerEvent<HTMLAnchorElement>) => {
      if (shouldBlur || e.pointerType === 'mouse') return
      activePointerTypeRef.current = e.pointerType
      longPressFiredRef.current = false
      longPressStartRef.current = { x: e.clientX, y: e.clientY }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      cancelLongPress()
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null
        openPopupFromCard(rect, true)
      }, 500)
    }

    const handlePointerMove = (e: React.PointerEvent<HTMLAnchorElement>) => {
      if (!longPressTimerRef.current) return
      const dx = Math.abs(e.clientX - longPressStartRef.current.x)
      const dy = Math.abs(e.clientY - longPressStartRef.current.y)
      if (dx > 20 || dy > 20) cancelLongPress()
    }

    const handlePointerUpOrCancel = () => {
      cancelLongPress()
      activePointerTypeRef.current = null
    }

    const handleContextMenu = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (activePointerTypeRef.current === 'touch') {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current)
          longPressTimerRef.current = null
          openPopupFromCard((e.currentTarget as HTMLElement).getBoundingClientRect(), true)
        }
      } else if (!shouldBlur && !longPressFiredRef.current) {
        openPopupFromCard((e.currentTarget as HTMLElement).getBoundingClientRect())
      }
    }

    const mergedConfig = {
      ...defaultConfig,
      ...config,
      elements: {
        ...defaultConfig.elements,
        ...(config?.elements || {}),
        poster: {
          ...defaultConfig.elements?.poster,
          ...(config?.elements?.poster || {}),
        },
        info: {
          ...defaultConfig.elements?.info,
          ...(config?.elements?.info || {}),
        },
      },
    }

    const hasNewEpisodes = (anime.newEpisodesCount || 0) > 0
    const ct = anime.currentTime || 0
    const dur = anime.duration || 0
    const hasProgress = ct > 5 && dur > 5 && ct < dur * 0.95
    const showFullBar = ct > 0 && (dur <= 5 || ct >= dur * 0.95)

    const displayTitle = (anime[titlePreference as keyof Anime] as string) || anime.name

    const episodeToPlay = anime.episodeNumber ?? anime.nextEpisodeToWatch

    const linkTarget = continueWatching
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
      : episodeToPlay && anime.episodeNumber
        ? `/watch/${anime._id}/${anime.episodeNumber}`
        : hasProgress
          ? `/watch/${anime._id}/${anime.episodeNumber}`
          : `/anime/${anime._id}`

    const isWatchLink = (() => {
      if (typeof linkTarget === 'string') return linkTarget.startsWith('/watch/')
      const pathname = (linkTarget as { pathname?: string }).pathname
      return typeof pathname === 'string' && pathname.startsWith('/watch/')
    })()

    const showAnyBar = hasProgress || showFullBar
    const progressPercent = hasProgress ? (ct / dur) * 100 : showFullBar ? 100 : 0

    const handleRemoveClick = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const id = anime.id || anime.showId || anime._id
        if (onRemove) onRemove(id)
      },
      [onRemove, anime.id, anime.showId, anime._id]
    )

    const progressString = (() => {
      const episodeToDisplay = anime.relativeEpisodeNumber ?? episodeToPlay

      if (continueWatching && episodeToDisplay) {
        return `EP ${episodeToDisplay}`
      }

      if (anime.watchedCount !== undefined && anime.watchedCount > 0) {
        return `EP ${anime.watchedCount}`
      }

      return null
    })()

    const posterEls = mergedConfig.elements?.poster
    const infoEls = mergedConfig.elements?.info
    const showTypeBadge = posterEls?.typeBadge ?? (continueWatching ? false : true)
    const showEpBadge = posterEls?.episodeBadge ?? true
    const showRemoveBtn =
      posterEls?.removeButton === undefined
        ? continueWatching && !!onRemove
        : posterEls.removeButton
    const showAdultBadge = posterEls?.adultBadge ?? true
    const showMobileBadges = infoEls?.mobileBadges ?? true
    const showProgress = infoEls?.progress ?? true
    const showMeta = infoEls?.meta ?? true

    const adultContent =
      anime.isAdult ||
      anime.rating === 'R+' ||
      anime.rating === 'Rx' ||
      anime.rating?.includes('17+')

    const [isAgreedToViewMature, setIsAgreedToViewMature] = React.useState(
      localStorage.getItem('agreedToViewMature') === 'true'
    )
    const [showModal, setShowModal] = React.useState(false)
    const pendingMatureTargetRef = React.useRef<To | null>(null)

    const handleConfirmViewMature = () => {
      localStorage.setItem('agreedToViewMature', 'true')
      setIsAgreedToViewMature(true)
      setShowModal(false)
      if (pendingMatureTargetRef.current) {
        navigate(pendingMatureTargetRef.current)
        pendingMatureTargetRef.current = null
      }
    }

    const shouldBlur = adultContent && !isAgreedToViewMature
    const handleCardClick = (e: React.MouseEvent) => {
      if (longPressFiredRef.current) {
        e.preventDefault()
        e.stopPropagation()
        longPressFiredRef.current = false
        return
      }
      if (shouldBlur) {
        e.preventDefault()
        e.stopPropagation()
        pendingMatureTargetRef.current = linkTarget
        setShowModal(true)
      }
    }

    return (
      <div
        className={`${styles.cardWrapper} ${lowEndMode ? styles.lowEnd : ''}`}
        onMouseEnter={() => {
          setIsHovered(true)
          if (isPopupVisible) clearPopupTimeout()
        }}
        onMouseLeave={() => {
          setIsHovered(false)
          if (isPopupVisible) schedulePopupClose()
        }}
      >
        <Link
          to={linkTarget}
          className={`${styles.card} ${styles[layout]} ${shouldBlur ? styles.cardButton : ''}`}
          onClick={handleCardClick}
          onContextMenu={handleContextMenu}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUpOrCancel}
          onPointerCancel={handlePointerUpOrCancel}
        >
          <div className={styles.posterContainer}>
            {shouldBlur && (
              <div className={`${styles.matureOverlay} ${lowEndMode ? styles.flat : ''}`} />
            )}
            <img
              src={fixThumbnailUrl(anime.thumbnail, lowEndMode ? 100 : 150, lowEndMode ? 150 : 200)}
              alt={displayTitle}
              className={`${styles.posterImg} ${isLoaded ? styles.loaded : ''} ${
                shouldBlur && !lowEndMode ? styles.blurred : ''
              }`}
              loading="lazy"
              decoding="async"
              onLoad={() => setIsLoaded(true)}
            />

            {!isMobile && (
              <>
                {showTypeBadge && <div className={styles.typeBadge}>{anime.type || 'TV'}</div>}
                {showEpBadge && (progressString || anime.episodeNumber) && (
                  <div className={styles.epBadge}>
                    {progressString ? progressString : `EP ${anime.episodeNumber}`}
                    {anime.airTime && <span className={styles.airTime}>{anime.airTime}</span>}
                    {anime.aired === false && anime.nextEpisodeAirDate && (
                      <span className={styles.airTime}>
                        &nbsp;· {anime.nextEpisodeAirDate.split(',')[0]}
                      </span>
                    )}
                  </div>
                )}
              </>
            )}

            {showAdultBadge && adultContent && (
              <div className={`${styles.adultBadge} ${shouldBlur ? styles.gated : ''}`}>18+</div>
            )}

            {anime.aired === false && <div className={styles.notAiredBadge}>NOT AIRED</div>}

            {rank !== undefined && <div className={styles.rankBadge}>#{rank}</div>}

            {!isMobile && isHovered && (
              <div className={styles.hoverOverlay}>
                {isWatchLink ? <FaPlay size={28} /> : <FaInfoCircle size={28} />}
              </div>
            )}
          </div>

          {showProgress && (continueWatching || lowEndMode) && showAnyBar && (
            <div className={styles.progressSection}>
              <div className={styles.progressContainer}>
                <div className={styles.progressBar} style={{ width: `${progressPercent}%` }} />
              </div>
              {hasProgress ? (
                <div className={styles.timestamp}>
                  {formatTime(ct)} / {formatTime(dur)}
                </div>
              ) : (
                <div className={styles.timestamp}>Watched</div>
              )}
            </div>
          )}

          <div className={styles.titleSection}>
            {isMobile && showMobileBadges && (
              <div className={styles.mobileBadges}>
                <span className={styles.mobileType}>{anime.type || 'TV'}</span>
                {(progressString || anime.episodeNumber) && (
                  <span className={styles.mobileEp}>
                    {progressString ? progressString : `EP ${anime.episodeNumber}`}
                  </span>
                )}
              </div>
            )}

            {infoEls?.title !== false && (
              <div className={styles.title} title={displayTitle}>
                <span className={styles.titleText}>{displayTitle}</span>
              </div>
            )}

            {showMeta && (
              <div className={styles.metaRow}>
                {(anime.availableEpisodesDetail?.sub || anime.availableEpisodes?.sub) && (
                  <div className={styles.metaItem}>
                    <FaClosedCaptioning size={10} />
                    {anime.availableEpisodesDetail?.sub?.length ?? anime.availableEpisodes?.sub}
                  </div>
                )}
                {(anime.availableEpisodesDetail?.dub || anime.availableEpisodes?.dub) && (
                  <div className={styles.metaItem}>
                    <FaMicrophone size={10} />
                    {anime.availableEpisodesDetail?.dub?.length ?? anime.availableEpisodes?.dub}
                  </div>
                )}
              </div>
            )}
          </div>
        </Link>

        {showModal && (
          <GenericModal
            isOpen={showModal}
            title="Content Warning"
            onClose={() => setShowModal(false)}
          >
            <div style={{ padding: '1rem', textAlign: 'center' }}>
              <p>This title contains mature content intended for adult audiences.</p>
              <p>
                By proceeding, you confirm that you are of legal age and wish to view this content.
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '1rem' }}>
                You can reset this preference at any time in the <strong>Settings</strong> page.
              </p>
              <div
                style={{
                  marginTop: '1rem',
                  display: 'flex',
                  gap: '10px',
                  justifyContent: 'center',
                }}
              >
                <Button variant="secondary" onClick={() => setShowModal(false)}>
                  Go Back
                </Button>
                <Button onClick={handleConfirmViewMature}>I Agree</Button>
              </div>
            </div>
          </GenericModal>
        )}

        {showRemoveBtn && (
          <button className={styles.removeBtn} onClick={handleRemoveClick} aria-label="Remove">
            <FaTimes size={10} />
          </button>
        )}

        {!continueWatching && !isMobile && !shouldBlur && (
          <button
            className={styles.infoBtn}
            onMouseEnter={handleInfoMouseEnter}
            onMouseLeave={handleInfoMouseLeave}
            aria-label="Info"
          >
            <FaInfo size={11} />
          </button>
        )}

        {isPopupVisible && anchorRect && (
          <AnimePopup
            showId={anime._id}
            anchorRect={anchorRect}
            onMouseEnter={handlePopupMouseEnter}
            onMouseLeave={handlePopupMouseLeave}
            onRequestClose={closePopup}
          />
        )}
      </div>
    )
  }
)

export default AnimeCard
