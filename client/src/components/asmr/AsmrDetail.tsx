import React, { useMemo } from 'react'
import { FaPlay, FaTimes } from 'react-icons/fa'
import { useAsmrWork } from '../../hooks/useAsmr'
import type { AsmrTrack, AsmrWork } from '../../hooks/useAsmr'
import styles from './Asmr.module.css'

interface AsmrDetailProps {
  work: AsmrWork
  onClose: () => void
  onPlay: (work: AsmrWork, tracks: AsmrTrack[], trackIndex: number) => void
  t?: (s: string) => string
}

const AsmrDetail: React.FC<AsmrDetailProps> = ({ work, onClose, onPlay, t }) => {
  const { data, isLoading } = useAsmrWork(work.id || null)

  const metaRows = useMemo(() => {
    return (data?.description || work.description || '')
      .split('\n')
      .map((line) => {
        const idx = line.indexOf(':')
        if (idx === -1) return null
        return { label: line.slice(0, idx), value: line.slice(idx + 1).trim() }
      })
      .filter((row): row is { label: string; value: string } => !!row && !!row.value)
  }, [data?.description, work.description])

  const tracks = data?.tracks || []

  return (
    <div className={styles.detailOverlay} onClick={onClose}>
      <div className={styles.detailModal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.detailClose} onClick={onClose} aria-label="Close">
          <FaTimes />
        </button>

        <div className={styles.detailHeader}>
          {work.thumbnail ? (
            <img className={styles.detailCover} src={work.thumbnail} alt={work.name} />
          ) : (
            <div className={`${styles.detailCover} ${styles.thumbPlaceholder}`} />
          )}
          <div className={styles.detailInfo}>
            <h2 className={styles.detailTitle}>{t ? t(work.name) : work.name}</h2>
            <p className={styles.detailRj}>{work.id}</p>
            {metaRows.map((row) =>
              row.label === 'Tags' ? (
                <p key={row.label} className={styles.metaRow}>
                  <span className={styles.metaLabel}>Tags</span>
                  <span className={styles.tagChips}>
                    {row.value.split(', ').map((t) => (
                      <span key={t} className={styles.tagChip}>
                        {t}
                      </span>
                    ))}
                  </span>
                </p>
              ) : (
                <p key={row.label} className={styles.metaRow}>
                  <span className={styles.metaLabel}>{row.label}</span>
                  {row.value}
                </p>
              )
            )}
          </div>
        </div>

        <div className={styles.tracksSection}>
          <h3 className={styles.tracksHeading}>
            {isLoading ? 'Loading tracks…' : `Tracks (${tracks.length})`}
          </h3>
          {!isLoading &&
            (tracks.length > 0 ? (
              <ul className={styles.trackList}>
                {tracks.map((track, i) => (
                  <li key={track.link}>
                    <button className={styles.trackRow} onClick={() => onPlay(work, tracks, i)}>
                      <FaPlay className={styles.trackIcon} />
                      <span className={styles.trackLabel}>{track.resolutionStr}</span>
                      <span className={styles.trackType}>{track.hls ? 'HLS' : 'MP3'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.noTracks}>No audio streams available for this work.</p>
            ))}
        </div>

        {!isLoading && tracks.length > 0 && (
          <button className={styles.playAllBtn} onClick={() => onPlay(work, tracks, 0)}>
            <FaPlay /> Play from start
          </button>
        )}
      </div>
    </div>
  )
}

export default AsmrDetail
