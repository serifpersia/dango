import React, { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFloating, flip, shift, autoUpdate } from '@floating-ui/react'
import { FaStar, FaPlay, FaTv, FaPlus, FaCheck } from 'react-icons/fa'
import { Link } from 'react-router'
import { useAnimeInfoData } from '../../hooks/useAnimeInfoData'
import { useTitlePreference } from '../../contexts/TitlePreferenceContext'
import QueueOptionsButton from './QueueOptionsButton'
import styles from './AnimePopup.module.css'

interface AnimePopupProps {
  showId: string
  anchorRect: DOMRect
  onMouseEnter: () => void
  onMouseLeave: () => void
}

const AnimePopup: React.FC<AnimePopupProps> = ({
  showId,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
}) => {
  const { showMeta, loadingMeta, inWatchlist, toggleWatchlist } = useAnimeInfoData(showId)
  const { titlePreference } = useTitlePreference()

  const displayTitle = useMemo(() => {
    if (!showMeta?.name) return ''
    if (titlePreference === 'name') return showMeta.name
    if (titlePreference === 'nativeName') return showMeta.names?.native || showMeta.name
    if (titlePreference === 'englishName') return showMeta.names?.english || showMeta.name
    return showMeta.name
  }, [showMeta, titlePreference])

  const virtualEl = useMemo(
    () => ({
      getBoundingClientRect: () => anchorRect,
    }),
    [anchorRect]
  )

  const { refs, floatingStyles } = useFloating({
    elements: { reference: virtualEl },
    placement: 'right-start',
    middleware: [flip({ fallbackAxisSideDirection: 'start' }), shift({ padding: 20 })],
    whileElementsMounted: autoUpdate,
  })

  const [queueMenuOpen, setQueueMenuOpen] = useState(false)
  const mouseInsideRef = useRef(false)

  const handlePopupMouseEnter = () => {
    mouseInsideRef.current = true
    onMouseEnter()
  }

  const handlePopupMouseLeave = () => {
    mouseInsideRef.current = false
    if (queueMenuOpen) return
    onMouseLeave()
  }

  const handleQueueMenuOpenChange = (open: boolean) => {
    setQueueMenuOpen(open)
    if (!open && !mouseInsideRef.current) {
      onMouseLeave()
    }
  }

  const content = (
    <div
      ref={refs.setFloating}
      className={styles.popupPortal}
      style={floatingStyles}
      onMouseEnter={handlePopupMouseEnter}
      onMouseLeave={handlePopupMouseLeave}
    >
      <div className={styles.popupContent}>
        {loadingMeta ? (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            <span>Fetching details...</span>
          </div>
        ) : showMeta ? (
          <>
            <div className={styles.header}>
              <div className={styles.title}>{displayTitle}</div>
            </div>

            <div className={styles.body}>
              <div className={styles.metaRow}>
                {showMeta.score && (
                  <div className={styles.metaItem}>
                    <FaStar className={styles.scoreIcon} size={14} />
                    <span>{showMeta.score}</span>
                  </div>
                )}
                {showMeta.status && (
                  <div className={styles.metaItem}>
                    <FaTv size={14} />
                    <span>{showMeta.status}</span>
                  </div>
                )}
              </div>

              <div className={styles.synopsis}>
                {showMeta.description
                  ? showMeta.description.replace(/<[^>]*>?/gm, '')
                  : 'No synopsis available.'}
              </div>

              <div className={styles.details}>
                {showMeta.nextEpisodeAirDate && (
                  <div className={styles.detailItem}>
                    <strong>Aired:</strong> {showMeta.nextEpisodeAirDate}
                  </div>
                )}
                {Array.isArray(showMeta.genres) && showMeta.genres.length > 0 && (
                  <div className={styles.genres}>
                    {Array.isArray(showMeta.genres) &&
                      showMeta.genres
                        .filter(Boolean)
                        .slice(0, 4)
                        .map((g) => {
                          const genreName = typeof g === 'string' ? g : g?.name
                          return (
                            <span key={genreName} className={styles.genre}>
                              {genreName}
                            </span>
                          )
                        })}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.footer}>
              <div className={styles.primaryAction}>
                <Link to={`/watch/${showMeta?.id || showId}`} className={styles.watchBtn}>
                  <FaPlay size={14} />
                  Watch now
                </Link>
              </div>
              <div className={styles.secondaryActions}>
                <button
                  className={`${styles.watchlistBtn} ${inWatchlist ? styles.active : ''}`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggleWatchlist()
                  }}
                >
                  {inWatchlist ? <FaCheck size={12} /> : <FaPlus size={12} />}
                  <span>{inWatchlist ? 'Remove' : 'Watchlist'}</span>
                </button>
                <QueueOptionsButton
                  showId={showId}
                  showName={showMeta.name || showMeta.names?.romaji}
                  showThumbnail={showMeta.thumbnail}
                  nativeName={showMeta.names?.native}
                  englishName={showMeta.names?.english}
                  showType={showMeta.type}
                  className={styles.watchlistBtn}
                  activeClassName={styles.active}
                  align="left"
                  onMenuOpenChange={handleQueueMenuOpenChange}
                />
                <Link to={`/anime/${showMeta?.id || showId}`} className={styles.detailsBtn}>
                  Read more
                </Link>
              </div>
            </div>
          </>
        ) : (
          <div className={styles.loading}>Failed to load info.</div>
        )}
      </div>
    </div>
  )

  return createPortal(content, document.body)
}

export default AnimePopup
