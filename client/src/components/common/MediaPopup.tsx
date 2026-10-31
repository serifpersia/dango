import React, { useRef } from 'react'
import { Link } from 'react-router'
import Icon, { type IconName } from './Icon'
import FadeImage from './FadeImage'
import MediaPopupShell from './MediaPopupShell'
import styles from './MediaPopup.module.css'

export interface MediaPopupMeta {
  icon?: IconName
  label: string
  accent?: boolean
}

export interface MediaPopupAction {
  to: string
  label: string
  icon?: IconName
  disabled?: boolean
}

interface MediaPopupProps {
  anchorRect: DOMRect
  title: string
  subtitle?: string
  cover?: string
  loading?: boolean
  error?: string
  meta?: MediaPopupMeta[]
  genres?: string[]
  synopsis?: string
  primaryAction?: MediaPopupAction
  secondaryAction?: MediaPopupAction
  bookmarked: boolean
  bookmarkLabel?: string
  onToggleBookmark: () => void
  extraActions?: (onSubMenuOpenChange: (open: boolean) => void) => React.ReactNode
  onMouseEnter: () => void
  onMouseLeave: () => void
  onRequestClose?: () => void
}

const MediaPopup: React.FC<MediaPopupProps> = ({
  anchorRect,
  title,
  subtitle,
  cover,
  loading,
  error,
  meta = [],
  genres = [],
  synopsis,
  primaryAction,
  secondaryAction,
  bookmarked,
  bookmarkLabel = 'Watchlist',
  onToggleBookmark,
  extraActions,
  onMouseEnter,
  onMouseLeave,
  onRequestClose,
}) => {
  const mouseInsideRef = useRef(false)

  const handleEnter = () => {
    mouseInsideRef.current = true
    onMouseEnter()
  }

  const handleLeave = () => {
    mouseInsideRef.current = false
    onMouseLeave()
  }

  // a submenu (the queue options) that closes while the pointer is outside
  // must not close the popup with it
  const handleSubMenuOpenChange = (open: boolean) => {
    if (!open && !mouseInsideRef.current) onMouseLeave()
  }

  const hasFooter = !!primaryAction || !!secondaryAction || !!extraActions

  return (
    <MediaPopupShell
      anchorRect={anchorRect}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onRequestClose={onRequestClose}
    >
      {loading ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Fetching details...</span>
        </div>
      ) : error ? (
        <div className={styles.loading}>{error}</div>
      ) : (
        <>
          {title && (
            <div className={styles.header}>
              {cover && (
                <FadeImage
                  src={cover}
                  alt={title}
                  loading="lazy"
                  decoding="async"
                  className={styles.cover}
                />
              )}
              <div className={styles.title}>{title}</div>
              {subtitle && <div className={styles.altTitle}>{subtitle}</div>}
            </div>
          )}

          <div className={styles.body}>
            {meta.length > 0 && (
              <div className={styles.metaRow}>
                {meta.map((item, i) => (
                  <div className={styles.metaItem} key={`${item.label}-${i}`}>
                    {item.icon && (
                      <Icon
                        name={item.icon}
                        className={item.accent ? styles.scoreIcon : undefined}
                        size={14}
                      />
                    )}
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            )}

            {genres.length > 0 && (
              <div className={styles.genres}>
                {genres.map((genre) => (
                  <span key={genre} className={styles.genre}>
                    {genre}
                  </span>
                ))}
              </div>
            )}

            {synopsis && <div className={styles.synopsis}>{synopsis}</div>}
          </div>

          {hasFooter && (
            <div className={styles.footer}>
              {primaryAction && (
                <div className={styles.primaryAction}>
                  {primaryAction.disabled ? (
                    <span
                      className={styles.watchBtn}
                      aria-disabled="true"
                      style={{ opacity: 0.5, pointerEvents: 'none' }}
                    >
                      <Icon name={primaryAction.icon ?? 'play'} size={14} />
                      {primaryAction.label}
                    </span>
                  ) : (
                    <Link
                      to={primaryAction.to}
                      className={styles.watchBtn}
                      onClick={onRequestClose}
                    >
                      <Icon name={primaryAction.icon ?? 'play'} size={14} />
                      {primaryAction.label}
                    </Link>
                  )}
                </div>
              )}
              <div className={styles.secondaryActions}>
                <button
                  className={`${styles.watchlistBtn} ${bookmarked ? styles.active : ''}`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onToggleBookmark()
                  }}
                >
                  {bookmarked ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
                  <span>{bookmarked ? 'Remove' : bookmarkLabel}</span>
                </button>
                {extraActions?.(handleSubMenuOpenChange)}
                {secondaryAction && (
                  <Link
                    to={secondaryAction.to}
                    className={styles.detailsBtn}
                    onClick={onRequestClose}
                  >
                    {secondaryAction.icon && <Icon name={secondaryAction.icon} size={12} />}
                    <span>{secondaryAction.label}</span>
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </MediaPopupShell>
  )
}

export default MediaPopup
