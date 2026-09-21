import React, { useMemo, useRef, useState } from 'react'
import Icon from '../common/Icon'
import { Link } from 'react-router'
import { useAnimeInfoData } from '../../hooks/useAnimeInfoData'
import { sanitizeText } from '../../lib/utils'
import { useTitlePreference } from '../../contexts/TitlePreferenceContext'
import QueueOptionsButton from './QueueOptionsButton'
import MediaPopupShell from '../common/MediaPopupShell'
import styles from '../common/MediaPopup.module.css'

interface AnimePopupProps {
  showId: string
  anchorRect: DOMRect
  onMouseEnter: () => void
  onMouseLeave: () => void
  onRequestClose?: () => void
}

const AnimePopup: React.FC<AnimePopupProps> = ({
  showId,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
  onRequestClose,
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
    <MediaPopupShell
      anchorRect={anchorRect}
      onMouseEnter={handlePopupMouseEnter}
      onMouseLeave={handlePopupMouseLeave}
      onRequestClose={onRequestClose}
    >
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
                  <Icon name="star" className={styles.scoreIcon} size={14} />
                  <span>{showMeta.score}</span>
                </div>
              )}
              {showMeta.status && (
                <div className={styles.metaItem}>
                  <Icon name="tv" size={14} />
                  <span>{showMeta.status}</span>
                </div>
              )}
            </div>

            <div className={styles.synopsis}>
              {showMeta.description ? sanitizeText(showMeta.description) : 'No synopsis available.'}
            </div>

            <div className={styles.details}>
              {showMeta.nextEpisodeAirDate && (
                <div className={styles.detailItem}>
                  <strong>Aired:</strong> {showMeta.nextEpisodeAirDate}
                </div>
              )}
              {Array.isArray(showMeta.genres) && showMeta.genres.length > 0 && (
                <div className={styles.genres}>
                  {showMeta.genres
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
                <Icon name="play" size={14} />
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
                {inWatchlist ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
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
    </MediaPopupShell>
  )

  return content
}

export default AnimePopup
