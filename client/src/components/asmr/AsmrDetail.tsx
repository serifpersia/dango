import React, { useMemo } from 'react'
import Icon from '../common/Icon'
import { useAsmrWork } from '../../hooks/useAsmr'
import {
  useAsmrLibraryCheck,
  useAsmrProgress,
  useToggleAsmrBookmark,
} from '../../hooks/useAsmrLibrary'
import { asmrWorkId } from '../../lib/asmr'
import { formatTime } from '../../lib/utils'
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
  const workId = asmrWorkId(work)
  const { data: libraryCheck } = useAsmrLibraryCheck(workId || undefined)
  const { toggle: toggleBookmark, bookmarkedIds } = useToggleAsmrBookmark()
  const { data: progressData } = useAsmrProgress(workId || undefined)
  const bookmarked = workId ? bookmarkedIds.has(workId) : !!libraryCheck?.inLibrary

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
  const latestProgress = useMemo(() => {
    const rows = progressData?.progress ?? []
    return rows.length > 0 ? rows.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b)) : null
  }, [progressData])
  const resumeIndex =
    latestProgress && latestProgress.trackIndex < tracks.length ? latestProgress.trackIndex : null

  return (
    <div className={styles.detailOverlay} onClick={onClose}>
      <div className={styles.detailModal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.detailClose} onClick={onClose} aria-label="Close">
          <Icon name="times" />
        </button>

        <div className={styles.detailHeader}>
          {work.thumbnail ? (
            <img
              className={styles.detailCover}
              src={work.thumbnail}
              alt={work.name}
              decoding="async"
            />
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
                      <Icon name="play" className={styles.trackIcon} />
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

        <div className={styles.detailActions}>
          {!isLoading && tracks.length > 0 && (
            <button className={styles.playAllBtn} onClick={() => onPlay(work, tracks, 0)}>
              <Icon name="play" /> Play from start
            </button>
          )}

          {!isLoading && resumeIndex !== null && latestProgress && (
            <button className={styles.playAllBtn} onClick={() => onPlay(work, tracks, resumeIndex)}>
              <Icon name="history" /> Resume track {resumeIndex + 1} ·{' '}
              {formatTime(latestProgress.currentTime)}
              {latestProgress.duration > 0 ? ` / ${formatTime(latestProgress.duration)}` : ''}
            </button>
          )}

          {workId && (
            <button
              className={styles.playAllBtn}
              onClick={() =>
                toggleBookmark({
                  rjCode: workId,
                  title: work.name,
                  thumbnail: work.thumbnail || '',
                  isAdult: !!work.isAdult,
                })
              }
              aria-pressed={bookmarked}
            >
              <Icon name={bookmarked ? 'check' : 'plus'} />{' '}
              {bookmarked ? 'In listening list' : 'Add to listening list'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default AsmrDetail
