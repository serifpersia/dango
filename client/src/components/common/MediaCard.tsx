import React, { memo, useState, useCallback } from 'react'
import { Link, useNavigate, type To } from 'react-router'
import Icon from './Icon'
import { Modal } from './Modal'
import { Button } from './Button'
import { fixThumbnailUrl } from '../../lib/utils'
import { useTitlePreference } from '../../contexts/TitlePreferenceContext'
import { useEnrichedThumbnail } from '../../hooks/useEnrichedThumbnail'
import styles from './MediaCard.module.css'
import useIsMobile from '../../hooks/useIsMobile'
import { useLowEndMode } from '../../contexts/LowEndModeContext'
import { useCardInteraction } from '../../hooks/useCardInteraction'
import { useLocalStorage } from '../../hooks/useLocalStorage'

export interface MediaCardItem {
  id: string
  title: string
  nativeName?: string
  englishName?: string
  thumbnail?: string
  typeBadge?: string
  chapterBadge?: string | null
  airMeta?: string
  isAdult?: boolean
  notAired?: boolean
}

export interface MediaCardProgress {
  percent: number
  label: string
}

export interface MediaCardDisplay {
  elements?: {
    poster?: {
      typeBadge?: boolean
      chapterBadge?: boolean
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

interface MediaCardProps {
  item: MediaCardItem
  linkTo: To
  hoverIcon?: 'play' | 'info' | 'book'
  progress?: MediaCardProgress
  showProgress?: boolean
  metaRow?: React.ReactNode
  display?: MediaCardDisplay
  layout?: 'vertical' | 'horizontal'
  onRemove?: (id: string) => void
  showRemoveButton?: boolean
  showInfoButton?: boolean
  onOpenDetails?: (anchorRect: DOMRect) => void
  renderPopup?: (
    anchorRect: DOMRect,
    helpers: { close: () => void; onMouseEnter: () => void; onMouseLeave: () => void }
  ) => React.ReactNode
  onPopupHoverIntent?: (inside: boolean) => void
  rawThumbnail?: boolean
  enrichedId?: string
}

const defaultDisplay: MediaCardDisplay = {
  elements: {
    poster: {
      typeBadge: true,
      chapterBadge: true,
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

const MediaCard: React.FC<MediaCardProps> = memo(
  ({
    item,
    linkTo,
    hoverIcon,
    progress,
    showProgress = false,
    metaRow,
    display,
    layout = 'vertical',
    onRemove,
    showRemoveButton,
    showInfoButton = false,
    onOpenDetails,
    renderPopup,
    onPopupHoverIntent,
    rawThumbnail,
    enrichedId,
  }) => {
    const navigate = useNavigate()
    const isMobile = useIsMobile()
    const { titlePreference } = useTitlePreference()
    const { lowEndMode } = useLowEndMode()
    const [isLoaded, setIsLoaded] = useState(false)
    const [isHovered, setIsHovered] = useState(false)
    const { thumbnail: healedThumbnail } = useEnrichedThumbnail(enrichedId, item.thumbnail)
    const [isPopupVisible, setIsPopupVisible] = useState(false)
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

    const openInternalPopup = (rect: DOMRect) => {
      setAnchorRect(rect)
      setIsPopupVisible(true)
    }

    const closeInternalPopup = useCallback(() => {
      setIsPopupVisible(false)
      setAnchorRect(null)
    }, [])

    const openPopup = (rect: DOMRect) => {
      if (onOpenDetails) {
        onOpenDetails(rect)
        return
      }
      if (renderPopup) {
        openInternalPopup(rect)
      }
    }

    const interaction = useCardInteraction(openPopup)

    const schedulePopupClose = useCallback(() => {
      interaction.schedulePopupClose(closeInternalPopup)
    }, [interaction, closeInternalPopup])

    const clearPopupTimeout = interaction.clearPopupTimeout

    const handleInfoMouseEnter = (e: React.MouseEvent) => {
      if (isMobile) return
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      if (onOpenDetails) {
        onOpenDetails(rect)
        return
      }
      if (renderPopup) {
        openInternalPopup(rect)
      }
    }

    const handleInfoMouseLeave = () => {
      if (renderPopup) schedulePopupClose()
    }

    const handlePopupMouseEnter = () => {
      clearPopupTimeout()
    }

    const handlePopupMouseLeave = () => {
      if (renderPopup) schedulePopupClose()
    }

    const handlePointerDown = (e: React.PointerEvent<HTMLAnchorElement>) => {
      interaction.handlePointerDown(e, shouldBlur)
    }

    const handlePointerMove = (e: React.PointerEvent<HTMLAnchorElement>) => {
      interaction.handlePointerMove(e)
    }

    const handlePointerUpOrCancel = () => {
      interaction.handlePointerUpOrCancel()
    }

    const handleContextMenu = (e: React.MouseEvent) => {
      if (onOpenDetails) {
        e.preventDefault()
        e.stopPropagation()
        onOpenDetails((e.currentTarget as HTMLElement).getBoundingClientRect())
        return
      }
      if (renderPopup) {
        interaction.handleContextMenu(e, shouldBlur)
        return
      }
      interaction.handleContextMenu(e, shouldBlur)
    }

    const mergedDisplay = {
      ...defaultDisplay,
      ...display,
      elements: {
        ...defaultDisplay.elements,
        ...(display?.elements || {}),
        poster: {
          ...defaultDisplay.elements?.poster,
          ...(display?.elements?.poster || {}),
        },
        info: {
          ...defaultDisplay.elements?.info,
          ...(display?.elements?.info || {}),
        },
      },
    }

    const displayTitle = (item[titlePreference as keyof MediaCardItem] as string) || item.title

    const posterEls = mergedDisplay.elements?.poster
    const infoEls = mergedDisplay.elements?.info
    const showTypeBadge = (posterEls?.typeBadge ?? true) && !!item.typeBadge
    const showChapterBadge = (posterEls?.chapterBadge ?? true) && !!item.chapterBadge
    const showRemoveBtn = showRemoveButton ?? posterEls?.removeButton ?? !!onRemove
    const showAdultBadge = posterEls?.adultBadge ?? true
    const showMobileBadges = infoEls?.mobileBadges ?? true
    const showProgressSection = infoEls?.progress ?? true
    const showMeta = infoEls?.meta ?? true
    const showBar = showProgress && !!progress && progress.percent > 0

    const adultContent = !!item.isAdult

    const [matureConsent, setMatureConsent] = useLocalStorage<string>('agreedToViewMature', 'false')
    const isAgreedToViewMature = matureConsent === 'true'
    const [showModal, setShowModal] = React.useState(false)
    const pendingMatureTargetRef = React.useRef<To | null>(null)

    const handleConfirmViewMature = () => {
      setMatureConsent('true')
      setShowModal(false)
      if (pendingMatureTargetRef.current) {
        navigate(pendingMatureTargetRef.current)
        pendingMatureTargetRef.current = null
      }
    }

    const shouldBlur = adultContent && !isAgreedToViewMature
    const handleCardClick = (e: React.MouseEvent) => {
      if (interaction.consumeLongPressClick()) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (shouldBlur) {
        e.preventDefault()
        e.stopPropagation()
        pendingMatureTargetRef.current = linkTo
        setShowModal(true)
      }
    }

    const hoverOverlayIcon = (() => {
      if (hoverIcon === 'book') return <Icon name="book" size={28} />
      if (hoverIcon === 'play') return <Icon name="play" size={28} />
      if (hoverIcon === 'info') return <Icon name="info-circle" size={28} />
      return <Icon name="info-circle" size={28} />
    })()

    const handleRemoveClick = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (onRemove) onRemove(item.id)
      },
      [onRemove, item.id]
    )

    const thumbnailSrc = rawThumbnail
      ? (healedThumbnail ?? item.thumbnail)
      : fixThumbnailUrl(healedThumbnail, lowEndMode ? 100 : 150, lowEndMode ? 150 : 200)

    return (
      <div
        className={`${styles.cardWrapper} ${lowEndMode ? styles.lowEnd : ''}`}
        onMouseEnter={() => {
          setIsHovered(true)
          onPopupHoverIntent?.(true)
          if (isPopupVisible) clearPopupTimeout()
        }}
        onMouseLeave={() => {
          setIsHovered(false)
          onPopupHoverIntent?.(false)
          if (isPopupVisible) schedulePopupClose()
        }}
      >
        <Link
          to={linkTo}
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
              src={thumbnailSrc}
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
                {showTypeBadge && <div className={styles.typeBadge}>{item.typeBadge}</div>}
                {showChapterBadge && (
                  <div className={styles.epBadge}>
                    {item.chapterBadge}
                    {item.airMeta && <span className={styles.airTime}>{item.airMeta}</span>}
                  </div>
                )}
              </>
            )}

            {showAdultBadge && adultContent && (
              <div className={`${styles.adultBadge} ${shouldBlur ? styles.gated : ''}`}>18+</div>
            )}

            {item.notAired && <div className={styles.notAiredBadge}>NOT AIRED</div>}

            {!isMobile && isHovered && (
              <div className={styles.hoverOverlay}>{hoverOverlayIcon}</div>
            )}
          </div>

          {showProgressSection && showProgress && showBar && progress && (
            <div className={styles.progressSection}>
              <div className={styles.progressContainer}>
                <div className={styles.progressBar} style={{ width: `${progress.percent}%` }} />
              </div>
              <div className={styles.timestamp}>{progress.label}</div>
            </div>
          )}

          <div className={styles.titleSection}>
            {isMobile && showMobileBadges && (
              <div className={styles.mobileBadges}>
                {!!item.typeBadge && <span className={styles.mobileType}>{item.typeBadge}</span>}
                {item.chapterBadge && <span className={styles.mobileEp}>{item.chapterBadge}</span>}
              </div>
            )}

            {infoEls?.title !== false && (
              <div className={styles.title} title={displayTitle}>
                <span className={styles.titleText}>{displayTitle}</span>
              </div>
            )}

            {showMeta && metaRow && <div className={styles.metaRow}>{metaRow}</div>}
          </div>
        </Link>

        {showModal && (
          <Modal isOpen={showModal} title="Content Warning" onClose={() => setShowModal(false)}>
            <div style={{ padding: '1rem', textAlign: 'center' }}>
              <p>This title contains mature content intended for adult audiences.</p>
              <p>
                By proceeding, you confirm that you are <strong>18 years of age or older</strong>{' '}
                (or the age of majority in your jurisdiction) and wish to view this content.
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
                <Button onClick={handleConfirmViewMature}>I'm 18+, Continue</Button>
              </div>
            </div>
          </Modal>
        )}

        {showRemoveBtn && (
          <button className={styles.removeBtn} onClick={handleRemoveClick} aria-label="Remove">
            <Icon name="times" size={10} />
          </button>
        )}

        {showInfoButton && !isMobile && !shouldBlur && (
          <button
            className={styles.infoBtn}
            onMouseEnter={handleInfoMouseEnter}
            onMouseLeave={handleInfoMouseLeave}
            aria-label="Info"
          >
            <Icon name="info" size={11} />
          </button>
        )}

        {renderPopup && isPopupVisible && anchorRect
          ? renderPopup(anchorRect, {
              close: closeInternalPopup,
              onMouseEnter: handlePopupMouseEnter,
              onMouseLeave: handlePopupMouseLeave,
            })
          : null}
      </div>
    )
  }
)

export default MediaCard
