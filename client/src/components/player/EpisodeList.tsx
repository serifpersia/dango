import React, { useState, useMemo, useEffect, useRef } from 'react'
import styles from './EpisodeList.module.css'

export interface EpisodeListItem {
  id: string
  label?: string
  sublabel?: string
  thumbnail?: string
  watched?: boolean
}

interface EpisodeListProps {
  episodes: Array<string | EpisodeListItem>
  currentEpisode?: string
  watchedEpisodes?: string[]
  onEpisodeClick: (ep: string) => void
  variant?: 'sidebar' | 'drawer'
  title?: string
  header?: React.ReactNode
}

const EpisodeList = ({
  episodes,
  currentEpisode,
  watchedEpisodes = [],
  onEpisodeClick,
  variant = 'sidebar',
  title = 'Episodes',
  header,
}: EpisodeListProps) => {
  const [selectedRange, setSelectedRange] = useState(0)
  const activeItemRef = useRef<HTMLDivElement>(null)

  const normalizedItems = useMemo<EpisodeListItem[]>(
    () => episodes.map((ep) => (typeof ep === 'string' ? { id: ep, label: `Episode ${ep}` } : ep)),
    [episodes]
  )
  const watchedSet = useMemo(() => new Set(watchedEpisodes), [watchedEpisodes])

  useEffect(() => {
    const item = activeItemRef.current
    if (!item) return

    let scroller: HTMLElement | null = item.parentElement
    while (scroller) {
      const style = window.getComputedStyle(scroller)
      if (
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        scroller.scrollHeight > scroller.clientHeight
      ) {
        break
      }
      scroller = scroller.parentElement
    }
    if (!scroller) return

    const scrollerRect = scroller.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    scroller.scrollTop +=
      itemRect.top + itemRect.height / 2 - (scrollerRect.top + scroller.clientHeight / 2)
  }, [currentEpisode, selectedRange])

  const episodeRanges = useMemo(() => {
    if (normalizedItems.length <= 100) return []
    const ranges = []
    for (let i = 0; i < normalizedItems.length; i += 100) {
      const start = i + 1
      const end = Math.min(i + 100, normalizedItems.length)
      ranges.push(`${start}-${end}`)
    }
    return ranges
  }, [normalizedItems])

  const filteredItems = useMemo(() => {
    if (episodeRanges.length === 0) return normalizedItems
    const range = episodeRanges[selectedRange]
    if (!range) return normalizedItems
    const [startStr, endStr] = range.split('-')
    const start = parseInt(startStr, 10)
    const end = parseInt(endStr, 10)
    return normalizedItems.slice(start - 1, end)
  }, [normalizedItems, episodeRanges, selectedRange])

  return (
    <div
      className={`${styles.episodeListContainer} ${variant === 'drawer' ? styles.drawerContainer : ''}`}
    >
      <div
        className={`${styles.episodeListHeader} ${variant === 'drawer' ? styles.drawerHeader : ''}`}
      >
        {header}
        <h3 className={styles.episodeListTitle}>{title}</h3>
        {episodeRanges.length > 0 && (
          <div className={styles.rangeSelector}>
            {episodeRanges.map((range, index) => (
              <button
                key={range}
                className={`${styles.rangeButton} ${selectedRange === index ? styles.active : ''}`}
                onClick={() => setSelectedRange(index)}
              >
                {range}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={`${styles.episodeList} ${variant === 'drawer' ? styles.drawerList : ''}`}>
        {filteredItems.map((item) => {
          const isActive = item.id === currentEpisode
          const isWatched = watchedSet.has(item.id) || item.watched === true
          return (
            <div
              key={item.id}
              ref={isActive ? activeItemRef : undefined}
              className={`${styles.episodeItem} ${isWatched ? styles.watched : ''} ${isActive ? styles.active : ''}`}
              onClick={() => onEpisodeClick(item.id)}
            >
              {item.thumbnail && (
                <img
                  src={item.thumbnail}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className={styles.episodeThumb}
                />
              )}
              <span className={styles.episodeText}>
                <span className={styles.episodeLabel}>{item.label ?? `Episode ${item.id}`}</span>
                {item.sublabel && <span className={styles.episodeSub}>{item.sublabel}</span>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default EpisodeList
