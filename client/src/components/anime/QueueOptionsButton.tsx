import React, { useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFloating, useDismiss, autoUpdate, flip, shift, offset } from '@floating-ui/react'
import { FaCheck, FaChevronDown, FaPlus, FaTimes } from 'react-icons/fa'
import { useQuery } from '@tanstack/react-query'
import {
  useQueue,
  useAddToQueueBatch,
  useRemoveFromQueueBatch,
  useQueueRemainingEpisodes,
} from '../../hooks/useAnimeData'
import { getSuggestedEpisode } from '../../lib/queue'
import styles from './QueueOptionsButton.module.css'

const MENU_VERTICAL_GAP = 8

interface QueueOptionsButtonProps {
  showId?: string
  showName?: string
  showThumbnail?: string
  nativeName?: string
  englishName?: string
  showType?: string
  className?: string
  activeClassName?: string
  align?: 'left' | 'right'
  onMenuOpenChange?: (open: boolean) => void
}

const QueueOptionsButton: React.FC<QueueOptionsButtonProps> = ({
  showId,
  showName,
  showThumbnail,
  nativeName,
  englishName,
  showType,
  className = '',
  activeClassName = '',
  align = 'right',
  onMenuOpenChange,
}) => {
  const { data: queue = [] } = useQueue()
  const addBatch = useAddToQueueBatch()
  const removeBatch = useRemoveFromQueueBatch()
  const [menuOpen, setMenuOpen] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open: menuOpen,
    onOpenChange: (open) => {
      if (!open) {
        setMenuOpen(false)
        onMenuOpenChange?.(false)
      }
    },
    placement: align === 'left' ? 'bottom-start' : 'bottom-end',
    middleware: [offset(MENU_VERTICAL_GAP), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  const dismiss = useDismiss(context, {
    outsidePress: true,
    escapeKey: true,
    scroll: true,
    referencePress: false,
  })

  const queuedItems = useMemo(() => queue.filter((item) => item.showId === showId), [queue, showId])

  const { data: suggestedEpisode } = useQuery({
    queryKey: ['suggestedEpisode', showId],
    queryFn: () => getSuggestedEpisode(showId as string),
    enabled: !!showId,
  })

  const { data: remainingData, isFetching: remainingLoading } = useQueueRemainingEpisodes(
    showId,
    menuOpen
  )
  const remaining = useMemo(() => remainingData?.episodes || [], [remainingData])

  const openMenu = useCallback(() => {
    setMenuOpen(true)
    onMenuOpenChange?.(true)
  }, [onMenuOpenChange])

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    onMenuOpenChange?.(false)
  }, [onMenuOpenChange])

  const isQueued = queuedItems.length > 0
  const hasRemaining = remaining.length > 0

  const queueEpisodes = useCallback(
    (episodeNumbers: string[]) => {
      if (!showId || episodeNumbers.length === 0) return
      addBatch.mutate({
        showId,
        episodeNumbers,
        showName,
        showThumbnail,
        nativeName,
        englishName,
        type: showType,
      })
      closeMenu()
    },
    [showId, showName, showThumbnail, nativeName, englishName, showType, addBatch, closeMenu]
  )

  const handleRemoveAll = useCallback(() => {
    if (!showId || queuedItems.length === 0) return
    removeBatch.mutate({
      showId,
      episodeNumbers: queuedItems.map((item) => item.episodeNumber),
    })
    closeMenu()
  }, [showId, queuedItems, removeBatch, closeMenu])

  const queueOne = useCallback(() => {
    if (hasRemaining) {
      queueEpisodes([remaining[0]])
    }
  }, [hasRemaining, remaining, queueEpisodes])

  const queueThree = useCallback(() => {
    if (hasRemaining) {
      queueEpisodes(remaining.slice(0, 3))
    }
  }, [hasRemaining, remaining, queueEpisodes])

  const queueAll = useCallback(() => {
    if (hasRemaining) {
      queueEpisodes([...remaining])
    }
  }, [hasRemaining, remaining, queueEpisodes])

  const firstEpisode = remaining[0]
  const lastOfThree = remaining[Math.min(2, remaining.length - 1)]
  const suggestedId = suggestedEpisode?.episodeNumber

  const trigger = (
    <div className={styles.trigger} ref={refs.setReference}>
      <span
        className={`${styles.triggerBtn} ${className} ${isQueued ? activeClassName : ''}`}
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={isQueued ? 'Queued' : 'Queue'}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (menuOpen) {
            closeMenu()
          } else {
            openMenu()
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            if (menuOpen) {
              closeMenu()
            } else {
              openMenu()
            }
          }
        }}
      >
        {isQueued ? <FaCheck size={14} /> : <FaPlus size={14} />}
        {isQueued ? 'Queued' : 'Queue'}
        <FaChevronDown size={10} className={styles.chevron} />
      </span>
    </div>
  )

  return (
    <>
      {trigger}
      {menuOpen &&
        createPortal(
          <div
            ref={refs.setFloating}
            className={styles.menu}
            style={floatingStyles}
            role="menu"
            {...dismiss}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <div className={styles.menuTitle}>Queue episodes</div>
            <button
              className={styles.menuItem}
              role="menuitem"
              type="button"
              disabled={!hasRemaining && !suggestedId}
              onClick={(e) => {
                e.stopPropagation()
                queueOne()
              }}
            >
              <FaPlus size={11} />
              <span>
                {hasRemaining
                  ? `+1 \u2014 EP ${firstEpisode}`
                  : `+1 \u2014 EP ${suggestedId || '?'}`}
              </span>
            </button>
            <button
              className={styles.menuItem}
              role="menuitem"
              type="button"
              disabled={!hasRemaining}
              onClick={(e) => {
                e.stopPropagation()
                queueThree()
              }}
            >
              <FaPlus size={11} />
              <span>
                {hasRemaining
                  ? `+3 \u2014 EP ${firstEpisode}${remaining.length > 1 ? `-${lastOfThree}` : ''}`
                  : '+3'}
              </span>
            </button>
            <button
              className={styles.menuItem}
              role="menuitem"
              type="button"
              disabled={!hasRemaining}
              onClick={(e) => {
                e.stopPropagation()
                queueAll()
              }}
            >
              <FaPlus size={11} />
              <span>
                All Remaining{remainingLoading ? '' : ` (${Math.max(remaining.length, 0)})`}
              </span>
            </button>
            {!remainingLoading && remaining.length === 0 && (
              <div className={styles.menuEmpty}>
                {isQueued ? 'All episodes are already queued' : 'No remaining unwatched episodes'}
              </div>
            )}
            {isQueued && (
              <button
                className={`${styles.menuItem} ${styles.removeItem}`}
                role="menuitem"
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleRemoveAll()
                }}
              >
                <FaTimes size={11} />
                <span>
                  Remove from Queue{queuedItems.length > 0 ? ` (${queuedItems.length})` : ''}
                </span>
              </button>
            )}
          </div>,
          document.body
        )}
    </>
  )
}

export default QueueOptionsButton
