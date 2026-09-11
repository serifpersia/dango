import React from 'react'
import { useNavigate } from 'react-router'
import { FaBars, FaChevronDown, FaChevronUp, FaTimes } from 'react-icons/fa'
import { useTitlePreference } from '../../contexts/TitlePreferenceContext'
import type { QueueItem } from '../../hooks/useAnimeData'
import { fixThumbnailUrl } from '../../lib/utils'
import styles from './QueueRail.module.css'

interface QueueRailProps {
  title?: string
  eyebrow?: string
  items: QueueItem[]
  currentShowId?: string
  currentEpisode?: string
  onRemove: (item: QueueItem) => void
  onReorder: (items: Pick<QueueItem, 'id' | 'showId' | 'episodeNumber'>[]) => void
  onNextQueue?: () => void
  onClear?: () => void
  showClearAll?: boolean
  defaultExpanded?: boolean
}

interface QueueRailItemProps {
  item: QueueItem
  isActive: boolean
  index: number
  onRemove: (item: QueueItem) => void
  onTouchPointerDown: (index: number, event: React.PointerEvent<HTMLDivElement>) => void
  onTouchPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  onTouchPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void
  onTouchPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void
  shouldIgnoreClick: () => boolean
  onDragStart: () => void
  onDragEnter: () => void
  onDragEnd: () => void
  isDragging: boolean
}

const QueueRailItem = ({
  item,
  isActive,
  index,
  onRemove,
  onTouchPointerDown,
  onTouchPointerMove,
  onTouchPointerUp,
  onTouchPointerCancel,
  shouldIgnoreClick,
  onDragStart,
  onDragEnter,
  onDragEnd,
  isDragging,
}: QueueRailItemProps) => {
  const navigate = useNavigate()
  const { titlePreference } = useTitlePreference()

  const displayTitle =
    (item[titlePreference as keyof QueueItem] as string) || item.name || 'Unknown show'

  return (
    <div
      data-queue-index={index}
      className={`${styles.item} ${isActive ? styles.active : ''} ${isDragging ? styles.dragging : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
      onPointerDown={(event) => onTouchPointerDown(index, event)}
      onPointerMove={onTouchPointerMove}
      onPointerUp={onTouchPointerUp}
      onPointerCancel={onTouchPointerCancel}
    >
      <button className={styles.dragHandle} type="button" aria-label="Drag queue item">
        <FaBars />
      </button>
      <img
        className={styles.thumbnail}
        src={fixThumbnailUrl(item.thumbnail || '', 72, 96)}
        alt={displayTitle}
        onError={(event) => {
          event.currentTarget.src = '/placeholder.svg'
        }}
      />
      <div className={styles.meta}>
        <button
          className={styles.name}
          type="button"
          onClick={() => {
            if (shouldIgnoreClick()) return
            navigate(`/watch/${item.showId}/${item.episodeNumber}`)
          }}
        >
          {displayTitle}
        </button>
        <div className={styles.episode}>Episode {item.episodeNumber}</div>
      </div>
      <button
        className={styles.iconBtn}
        type="button"
        onClick={() => {
          if (shouldIgnoreClick()) return
          onRemove(item)
        }}
        aria-label={`Remove ${displayTitle} episode ${item.episodeNumber} from queue`}
      >
        <FaTimes />
      </button>
    </div>
  )
}

const QueueRail = ({
  title = 'Queue',
  eyebrow,
  items,
  currentShowId,
  currentEpisode,
  onRemove,
  onReorder,
  onNextQueue,
  onClear,
  showClearAll = false,
  defaultExpanded = true,
}: QueueRailProps) => {
  const [localQueue, setLocalQueue] = React.useState<QueueItem[]>([])
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null)
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded)
  const touchPointerIdRef = React.useRef<number | null>(null)
  const touchStartRef = React.useRef<{ x: number; y: number } | null>(null)
  const touchLongPressTimerRef = React.useRef<number | null>(null)
  const touchDragActiveRef = React.useRef(false)
  const ignoreNextClickRef = React.useRef(false)

  React.useEffect(() => {
    setLocalQueue(items)
  }, [items])

  React.useEffect(() => {
    setIsExpanded(defaultExpanded)
  }, [defaultExpanded])

  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragEnter = (index: number) => {
    if (draggedIndex === null || draggedIndex === index) return

    const newQueue = [...localQueue]
    const draggedItem = newQueue[draggedIndex]
    newQueue.splice(draggedIndex, 1)
    newQueue.splice(index, 0, draggedItem)
    setDraggedIndex(index)
    setLocalQueue(newQueue)
  }

  const handleDragEnd = () => {
    if (draggedIndex !== null) {
      onReorder(
        localQueue.map((item) => ({
          id: item.id,
          showId: item.showId,
          episodeNumber: item.episodeNumber,
        }))
      )
    }
    setDraggedIndex(null)
  }

  const clearTouchDrag = (commit = false) => {
    if (touchLongPressTimerRef.current !== null) {
      window.clearTimeout(touchLongPressTimerRef.current)
      touchLongPressTimerRef.current = null
    }

    if (commit && touchDragActiveRef.current) {
      onReorder(
        localQueue.map((item) => ({
          id: item.id,
          showId: item.showId,
          episodeNumber: item.episodeNumber,
        }))
      )
      ignoreNextClickRef.current = true
      window.setTimeout(() => {
        ignoreNextClickRef.current = false
      }, 0)
    }

    touchPointerIdRef.current = null
    touchStartRef.current = null
    touchDragActiveRef.current = false
    setDraggedIndex(null)
  }

  const handleTouchPointerDown = (index: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return

    const target = event.currentTarget
    const pointerId = event.pointerId

    touchPointerIdRef.current = event.pointerId
    touchStartRef.current = { x: event.clientX, y: event.clientY }

    if (touchLongPressTimerRef.current !== null) {
      window.clearTimeout(touchLongPressTimerRef.current)
    }

    touchLongPressTimerRef.current = window.setTimeout(() => {
      touchDragActiveRef.current = true
      setDraggedIndex(index)
      try {
        target.setPointerCapture(pointerId)
      } catch {
        // ignore capture failures
      }
    }, 220)
  }

  const handleTouchPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return
    if (touchPointerIdRef.current !== event.pointerId) return

    if (!touchDragActiveRef.current && touchStartRef.current) {
      const dx = Math.abs(event.clientX - touchStartRef.current.x)
      const dy = Math.abs(event.clientY - touchStartRef.current.y)
      if (dx > 8 || dy > 8) {
        clearTouchDrag(false)
      }
      return
    }

    if (!touchDragActiveRef.current) return

    event.preventDefault()

    const el = document.elementFromPoint(event.clientX, event.clientY)
    const itemElement = el?.closest?.('[data-queue-index]') as HTMLElement | null
    const targetIndex = itemElement ? Number(itemElement.dataset.queueIndex) : NaN

    if (Number.isNaN(targetIndex) || draggedIndex === null || targetIndex === draggedIndex) return

    const newQueue = [...localQueue]
    const draggedItem = newQueue[draggedIndex]
    newQueue.splice(draggedIndex, 1)
    newQueue.splice(targetIndex, 0, draggedItem)
    setDraggedIndex(targetIndex)
    setLocalQueue(newQueue)
  }

  const handleTouchPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return
    if (touchPointerIdRef.current !== event.pointerId) return

    clearTouchDrag(touchDragActiveRef.current)
  }

  const handleTouchPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return
    if (touchPointerIdRef.current !== event.pointerId) return

    clearTouchDrag(false)
  }

  if (localQueue.length === 0) return null

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <button
          className={styles.headerToggle}
          type="button"
          onClick={() => setIsExpanded((open) => !open)}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? `Collapse ${title}` : `Expand ${title}`}
        >
          <span className={styles.title}>
            <span className="title-stack">
              {eyebrow && <div className="section-eyebrow">{eyebrow}</div>}
              <span>{title}</span>
            </span>
            <span className={styles.badge}>{localQueue.length}</span>
          </span>
          {isExpanded ? <FaChevronUp /> : <FaChevronDown />}
        </button>
        {showClearAll && onClear && (
          <div className={styles.headerActions}>
            {onNextQueue && localQueue.length > 1 && (
              <button className={styles.nextBtn} type="button" onClick={onNextQueue}>
                Next
              </button>
            )}
            <button className={styles.clearBtn} type="button" onClick={onClear}>
              Clear All
            </button>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className={styles.list}>
          {localQueue.map((item, index) => (
            <QueueRailItem
              key={item.id}
              item={item}
              isActive={item.showId === currentShowId && item.episodeNumber === currentEpisode}
              index={index}
              onRemove={onRemove}
              onTouchPointerDown={handleTouchPointerDown}
              onTouchPointerMove={handleTouchPointerMove}
              onTouchPointerUp={handleTouchPointerUp}
              onTouchPointerCancel={handleTouchPointerCancel}
              shouldIgnoreClick={() => ignoreNextClickRef.current}
              onDragStart={() => handleDragStart(index)}
              onDragEnter={() => handleDragEnter(index)}
              onDragEnd={handleDragEnd}
              isDragging={draggedIndex === index}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export default QueueRail
