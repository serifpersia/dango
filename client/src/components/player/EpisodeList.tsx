import React, { useState, useMemo, useEffect, useRef } from 'react'
import styles from './EpisodeList.module.css'

interface EpisodeListProps {
  episodes: string[]
  currentEpisode?: string
  watchedEpisodes: string[]
  onEpisodeClick: (ep: string) => void
  variant?: 'sidebar' | 'drawer'
}

const EpisodeList = ({
  episodes,
  currentEpisode,
  watchedEpisodes,
  onEpisodeClick,
  variant = 'sidebar',
}: EpisodeListProps) => {
  const [selectedRange, setSelectedRange] = useState(0)
  const activeItemRef = useRef<HTMLDivElement>(null)

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
    if (episodes.length <= 100) return []
    const ranges = []
    for (let i = 0; i < episodes.length; i += 100) {
      const start = i + 1
      const end = Math.min(i + 100, episodes.length)
      ranges.push(`${start}-${end}`)
    }
    return ranges
  }, [episodes])

  const filteredEpisodes = useMemo(() => {
    if (episodeRanges.length === 0) return episodes
    const range = episodeRanges[selectedRange]
    const [startStr, endStr] = range.split('-')
    const start = parseInt(startStr, 10)
    const end = parseInt(endStr, 10)
    return episodes.slice(start - 1, end)
  }, [episodes, episodeRanges, selectedRange])

  return (
    <div
      className={`${styles.episodeListContainer} ${variant === 'drawer' ? styles.drawerContainer : ''}`}
    >
      <div
        className={`${styles.episodeListHeader} ${variant === 'drawer' ? styles.drawerHeader : ''}`}
      >
        <h3 className={styles.episodeListTitle}>Episodes</h3>
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
        {filteredEpisodes.map((ep) => (
          <div
            key={ep}
            ref={ep === currentEpisode ? activeItemRef : undefined}
            className={`${styles.episodeItem} ${watchedEpisodes.includes(ep) ? styles.watched : ''} ${ep === currentEpisode ? styles.active : ''}`}
            onClick={() => onEpisodeClick(ep)}
          >
            <span>Episode {ep}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default EpisodeList
