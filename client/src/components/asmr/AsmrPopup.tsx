import React from 'react'
import Icon from '../common/Icon'
import { Link } from 'react-router'
import { useAsmrWork } from '../../hooks/useAsmr'
import type { AsmrPopupData } from '../../hooks/useAsmrPopup'
import MediaPopupShell from '../common/MediaPopupShell'
import popupStyles from '../common/MediaPopup.module.css'
import styles from './Asmr.module.css'

interface AsmrPopupProps {
  data: AsmrPopupData
  anchorRect: DOMRect
  bookmarked: boolean
  onToggleBookmark: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  onRequestClose?: () => void
}

const AsmrPopup: React.FC<AsmrPopupProps> = ({
  data,
  anchorRect,
  bookmarked,
  onToggleBookmark,
  onMouseEnter,
  onMouseLeave,
  onRequestClose,
}) => {
  const { data: detail, isLoading } = useAsmrWork(data.rjCode || null)

  const trackCount = detail?.tracks.length ?? 0
  const hasTracks = trackCount > 0
  const tracksReady = !isLoading

  const content = (
    <MediaPopupShell
      anchorRect={anchorRect}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onRequestClose={onRequestClose}
    >
      <div className={popupStyles.header}>
        {data.thumbnail && (
          <img
            src={data.thumbnail}
            alt={data.title}
            loading="lazy"
            decoding="async"
            className={styles.popupCover}
          />
        )}
        <div className={popupStyles.title}>{data.title}</div>
        <div className={popupStyles.synopsis}>{data.rjCode}</div>
      </div>

      <div className={popupStyles.body}>
        <div className={popupStyles.metaRow}>
          <div className={popupStyles.metaItem}>
            <Icon name="headphones" size={14} />
            <span>
              {!tracksReady ? (
                'Loading tracks…'
              ) : hasTracks ? (
                <>
                  {trackCount} track{trackCount === 1 ? '' : 's'}
                </>
              ) : (
                'No tracks'
              )}
            </span>
          </div>
          {data.rating && (
            <div className={popupStyles.metaItem}>
              <span>{data.rating.toUpperCase()}</span>
            </div>
          )}
          {data.isAdult && (
            <div className={popupStyles.metaItem}>
              <span>18+</span>
            </div>
          )}
          {data.progressLabel && (
            <div className={popupStyles.metaItem}>
              <Icon name="bookmark" size={12} />
              <span>{data.progressLabel}</span>
            </div>
          )}
        </div>

        <div className={popupStyles.synopsis}>
          {!tracksReady && !detail?.description
            ? 'Loading description…'
            : (detail?.description ?? 'No description available.')}
        </div>
      </div>

      <div className={popupStyles.footer}>
        <div className={popupStyles.primaryAction}>
          {hasTracks ? (
            <Link to={data.listenTarget} className={popupStyles.watchBtn}>
              <Icon name="play" size={14} />
              Listen now
            </Link>
          ) : (
            <span
              className={popupStyles.watchBtn}
              aria-disabled="true"
              style={{ opacity: 0.5, pointerEvents: 'none' }}
            >
              <Icon name="play" size={14} />
              {!tracksReady ? 'Loading…' : 'No tracks'}
            </span>
          )}
        </div>
        <div className={popupStyles.secondaryActions}>
          <button
            className={`${popupStyles.watchlistBtn} ${bookmarked ? popupStyles.active : ''}`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onToggleBookmark()
            }}
          >
            {bookmarked ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
            <span>{bookmarked ? 'Remove' : 'Bookmark'}</span>
          </button>
          <Link to={data.listenTarget} className={popupStyles.detailsBtn}>
            Details
          </Link>
        </div>
      </div>
    </MediaPopupShell>
  )

  return content
}

export default AsmrPopup
