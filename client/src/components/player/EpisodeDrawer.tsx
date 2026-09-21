import React, { useEffect } from 'react'
import { createPortal } from 'preact/compat'
import Icon from '../common/Icon'
import EpisodeList, { type EpisodeListItem } from './EpisodeList'
import styles from './EpisodeDrawer.module.css'

interface EpisodeDrawerProps {
  isOpen: boolean
  onClose: () => void
  episodes: Array<string | EpisodeListItem>
  currentEpisode?: string
  watchedEpisodes?: string[]
  onEpisodeClick: (ep: string) => void
  title?: string
  header?: React.ReactNode
}

export default function EpisodeDrawer({
  isOpen,
  onClose,
  episodes,
  currentEpisode,
  watchedEpisodes = [],
  onEpisodeClick,
  title,
  header,
}: EpisodeDrawerProps) {
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div className={styles.shell} role="dialog" aria-modal="true" aria-label="Episode picker">
      <button
        className={styles.overlay}
        type="button"
        onClick={onClose}
        aria-label="Close episodes"
      />

      <aside className={styles.drawer}>
        <div className={styles.handle} />

        <div className={styles.header}>
          <div className={styles.headerCopy}>
            <span className={styles.kicker}>Episode picker</span>
            <h3 className={styles.title}>Choose an episode</h3>
          </div>

          <button className={styles.closeBtn} type="button" onClick={onClose} aria-label="Close">
            <Icon name="times" />
          </button>
        </div>

        <div className={styles.body}>
          <EpisodeList
            episodes={episodes}
            currentEpisode={currentEpisode}
            watchedEpisodes={watchedEpisodes}
            onEpisodeClick={onEpisodeClick}
            variant="drawer"
            title={title}
            header={header}
          />
        </div>
      </aside>
    </div>,
    document.body
  )
}
