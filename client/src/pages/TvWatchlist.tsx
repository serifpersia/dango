import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import MediaCard from '../components/common/MediaCard'
import LibraryListPage from '../components/common/LibraryListPage'
import ResetProgressModal from '../components/common/ResetProgressModal'
import TvPopup from '../components/tv/TvPopup'
import { formatTime } from '../lib/utils'
import { isTvAdult, tvWatchPath } from '../lib/tv'
import {
  useTvLibrary,
  useTvContinueWatching,
  useRemoveTvBookmark,
  useRemoveTvProgress,
  useUpdateTvStatus,
  useBatchUpdateTvStatus,
  useBatchRemoveTv,
  useBatchRemoveTvProgress,
  TV_LIBRARY_STATUSES,
  type ContinueWatchingTvItem,
  type TvLibraryItem,
} from '../hooks/useTvLibrary'

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
  const bulkUpdateStatus = useBatchUpdateTvStatus()
  const bulkRemove = useBatchRemoveTv()
  const bulkResetProgress = useBatchRemoveTvProgress()

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
    <LibraryListPage
      headerTitle="My TV Watchlist"
      headerSubtitle="Track and manage your movies and shows"
      filters={FILTERS}
      filterBy={filterBy}
      filterBasePath="/tv-watchlist"
      continueFilter="Continue Watching"
      statusOptions={[...TV_LIBRARY_STATUSES]}
      entries={entries}
      total={total}
      isLoading={isLoading}
      error={error}
      page={page}
      pageSize={PAGE_SIZE}
      onPageChange={setPage}
      emptyTitle="Your TV watchlist is looking a bit empty"
      emptyFilteredText="No titles match this filter."
      emptyAllText="Let's find something to watch!"
      browseLabel="Browse TV & Movies"
      browseTarget="/tv"
      removeListLabel="Remove from TV Watchlist"
      listNoun="TV watchlist"
      skipConfirmKey="tvSkipRemoveConfirmation"
      onBulkStatus={(ids, status) => bulkUpdateStatus.mutate({ ids, status })}
      onBulkRemove={(ids) => {
        if (isCW) bulkResetProgress.mutate(ids)
        else bulkRemove.mutate(ids)
      }}
      onStatusChange={(id, status) => updateStatus.mutate({ id, status })}
      onRemoveItem={(libId) => removeBookmark.mutate(libId)}
      renderCard={(entry) => (
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
          metaRow={entry.year ? <span style={{ opacity: 0.75 }}>{entry.year}</span> : undefined}
          onRemove={isCW ? () => setResetTarget(entry) : undefined}
          renderPopup={(anchorRect, helpers) => (
            <TvPopup
              item={{
                id: entry.tmdbId ?? 0,
                title: entry.title || '',
                year: entry.year || '',
                type: entry.mediaType || 'tv',
                image: entry.poster || '',
              }}
              anchorRect={anchorRect}
              onMouseEnter={helpers.onMouseEnter}
              onMouseLeave={helpers.onMouseLeave}
              onRequestClose={helpers.close}
            />
          )}
        />
      )}
      modals={
        <ResetProgressModal
          isOpen={!!resetTarget}
          itemName={resetTarget?.title}
          progressKind="watch"
          listLabel="my TV watchlist"
          alsoRemove={alsoRemoveFromWatchlist}
          onAlsoRemoveChange={setAlsoRemoveFromWatchlist}
          onClose={() => {
            setResetTarget(null)
            setAlsoRemoveFromWatchlist(false)
          }}
          onConfirm={handleConfirmReset}
        />
      }
    />
  )
}
