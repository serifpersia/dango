import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import Icon from '../components/common/Icon'
import SkeletonGrid from '../components/common/SkeletonGrid'
import ErrorMessage from '../components/common/ErrorMessage'
import MediaCard from '../components/common/MediaCard'
import { Modal } from '../components/common/Modal'
import { Button } from '../components/common/Button'
import { formatTime } from '../lib/utils'
import { isTvAdult, tvWatchPath } from '../lib/tv'
import {
  useTvLibrary,
  useTvContinueWatching,
  useRemoveTvBookmark,
  useRemoveTvProgress,
  useUpdateTvStatus,
  TV_LIBRARY_STATUSES,
  type ContinueWatchingTvItem,
  type TvLibraryItem,
} from '../hooks/useTvLibrary'
import styles from './Watchlist.module.css'

const FILTERS = ['All', 'Continue Watching', ...TV_LIBRARY_STATUSES]

const PAGE_SIZE = 24

type GridEntry = {
  key: string
  libId: string
  tmdbId: number
  mediaType: string
  title: string
  poster: string
  year?: string | null
  adult: boolean
  status: string
  badge?: string
  progressPercent?: number
  progressLabel?: string
  watchTarget: string
}

export default function TvWatchlist() {
  const { filter: filterBy = 'All' } = useParams<{ filter: string }>()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [resetTarget, setResetTarget] = useState<GridEntry | null>(null)
  const [alsoRemoveFromWatchlist, setAlsoRemoveFromWatchlist] = useState(false)

  useEffect(() => {
    document.title = 'TV Watchlist - dango'
  }, [])

  useEffect(() => {
    setPage(1)
  }, [filterBy])

  const isCW = filterBy === 'Continue Watching'
  const libraryQuery = useTvLibrary(isCW ? 'All' : filterBy, page, PAGE_SIZE)
  const cwQuery = useTvContinueWatching(100)
  const removeBookmark = useRemoveTvBookmark()
  const removeProgress = useRemoveTvProgress()
  const updateStatus = useUpdateTvStatus()

  const entries: GridEntry[] = useMemo(() => {
    if (isCW) {
      return (cwQuery.data?.data ?? []).map((item: ContinueWatchingTvItem) => {
        const ct = item.currentTime ?? 0
        const dur = item.duration ?? 0
        const s = item.season ?? item.lastSeason ?? 1
        const e = item.episode ?? item.lastEpisode ?? 1
        return {
          key: item.id,
          libId: item.id,
          tmdbId: item.tmdbId,
          mediaType: item.mediaType,
          title: item.title,
          poster: item.poster || '',
          year: item.year,
          adult: isTvAdult({ adult: item.adult === 1 }),
          status: item.status,
          badge: `S${s} E${e}`,
          progressPercent: dur > 0 ? (ct / dur) * 100 : 0,
          progressLabel:
            dur > 0 ? `S${s} E${e} · ${formatTime(ct)} / ${formatTime(dur)}` : `S${s} E${e}`,
          watchTarget: tvWatchPath(item.mediaType, item.tmdbId, s, e),
        }
      })
    }
    return ((libraryQuery.data?.data ?? []) as TvLibraryItem[]).map((item) => ({
      key: item.id,
      libId: item.id,
      tmdbId: item.tmdbId,
      mediaType: item.mediaType,
      title: item.title,
      poster: item.poster || '',
      year: item.year,
      adult: isTvAdult({ adult: item.adult === 1 }),
      status: item.status,
      badge:
        item.lastSeason && item.lastEpisode
          ? `S${item.lastSeason} E${item.lastEpisode}`
          : undefined,
      progressPercent: undefined,
      progressLabel: undefined,
      watchTarget: tvWatchPath(
        item.mediaType,
        item.tmdbId,
        item.lastSeason ?? undefined,
        item.lastEpisode ?? undefined
      ),
    }))
  }, [isCW, cwQuery.data, libraryQuery.data])

  const total = isCW ? (cwQuery.data?.total ?? 0) : (libraryQuery.data?.total ?? 0)
  const isLoading = isCW ? cwQuery.isLoading : libraryQuery.isLoading
  const error = isCW ? cwQuery.error : libraryQuery.error

  const handleConfirmReset = () => {
    if (!resetTarget) return
    removeProgress.mutate({ mediaId: resetTarget.libId })
    if (alsoRemoveFromWatchlist) removeBookmark.mutate(resetTarget.libId)
    setResetTarget(null)
    setAlsoRemoveFromWatchlist(false)
  }

  return (
    <div className="page-container">
      <header className={styles.header}>
        <h2 className={styles.title}>My TV Watchlist</h2>
        <p className={styles.subtitle}>Track and manage your movies and shows</p>
      </header>

      <div className={styles.controls}>
        <div className={styles.filters}>
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`${styles.filterBtn} ${filterBy === f ? styles.active : ''}`}
              onClick={() => navigate(`/tv-watchlist/${f === 'All' ? '' : f}`)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.resultsHeader}>
        <h3 className={styles.resultsTitle}>
          {filterBy}
          <span className={styles.itemCount}>({total} items)</span>
        </h3>
        {total > 0 && (
          <div className={styles.pagination}>
            <button
              className={styles.pageBtn}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || isLoading}
              aria-label="Previous page"
            >
              <Icon name="chevron-left" size={14} />
            </button>
            <span className={styles.pageInfo}>
              Page <strong>{page}</strong>
            </span>
            <button
              className={styles.pageBtn}
              onClick={() => setPage((p) => p + 1)}
              disabled={entries.length < PAGE_SIZE || isLoading}
              aria-label="Next page"
            >
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <SkeletonGrid />
      ) : error ? (
        <ErrorMessage message={(error as Error).message} />
      ) : entries.length === 0 ? (
        <div className={styles.emptyState}>
          <h3 className={styles.emptyTitle}>Your TV watchlist is looking a bit empty</h3>
          <p className={styles.emptyText}>
            {filterBy !== 'All' ? 'No titles match this filter.' : "Let's find something to watch!"}
          </p>
          <button className={styles.emptyBtn} onClick={() => navigate('/tv')}>
            <Icon name="search" size={14} />
            <span>Browse TV & Movies</span>
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          {entries.map((entry) => (
            <div key={entry.key} className={styles.itemWrapper}>
              <MediaCard
                item={{
                  id: entry.libId,
                  title: entry.title,
                  thumbnail: entry.poster,
                  typeBadge: entry.mediaType === 'movie' ? 'Movie' : 'TV',
                  chapterBadge: entry.badge ?? null,
                  isAdult: entry.adult,
                }}
                linkTo={entry.watchTarget}
                hoverIcon="play"
                progress={
                  entry.progressPercent !== undefined && entry.progressLabel
                    ? { percent: entry.progressPercent, label: entry.progressLabel }
                    : undefined
                }
                showProgress={isCW}
                metaRow={
                  entry.year ? <span style={{ opacity: 0.75 }}>{entry.year}</span> : undefined
                }
                onRemove={isCW ? () => setResetTarget(entry) : undefined}
              />
              {!isCW && (
                <div className={styles.cardActions}>
                  <select
                    className={styles.statusSelect}
                    value={entry.status}
                    onChange={(e) =>
                      updateStatus.mutate({ id: entry.libId, status: e.currentTarget.value })
                    }
                  >
                    {TV_LIBRARY_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    className={styles.removeBtn}
                    onClick={() => removeBookmark.mutate(entry.libId)}
                    title="Remove from TV Watchlist"
                    aria-label="Remove from TV Watchlist"
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {total > 0 && (
        <div className={styles.bottomPagination}>
          <div className={styles.pagination}>
            <button
              className={styles.pageBtn}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || isLoading}
            >
              <Icon name="chevron-left" size={14} />
              <span>Previous</span>
            </button>
            <span className={styles.pageInfo}>
              Page <strong>{page}</strong>
            </span>
            <button
              className={styles.pageBtn}
              onClick={() => setPage((p) => p + 1)}
              disabled={entries.length < PAGE_SIZE || isLoading}
            >
              <span>Next</span>
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
        </div>
      )}

      <Modal
        isOpen={!!resetTarget}
        onClose={() => {
          setResetTarget(null)
          setAlsoRemoveFromWatchlist(false)
        }}
        title="Reset Progress"
      >
        <Modal.Body>
          <p>
            Are you sure you want to remove your watch progress for &quot;{resetTarget?.title}
            &quot;?
          </p>
          <label>
            <input
              type="checkbox"
              checked={alsoRemoveFromWatchlist}
              onChange={(e) => setAlsoRemoveFromWatchlist(e.target.checked)}
            />
            Also remove from my TV watchlist
          </label>
        </Modal.Body>
        <Modal.Actions>
          <Button
            variant="secondary"
            onClick={() => {
              setResetTarget(null)
              setAlsoRemoveFromWatchlist(false)
            }}
          >
            No
          </Button>
          <Button variant="danger" onClick={handleConfirmReset}>
            Yes
          </Button>
        </Modal.Actions>
      </Modal>
    </div>
  )
}
