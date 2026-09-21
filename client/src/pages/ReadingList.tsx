import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import Icon from '../components/common/Icon'
import SkeletonGrid from '../components/common/SkeletonGrid'
import ErrorMessage from '../components/common/ErrorMessage'
import MediaCard from '../components/common/MediaCard'
import MangaPopup from '../components/manga/MangaPopup'
import MangaResetProgressModal from '../components/manga/MangaResetProgressModal'
import { mangaCoverSrc } from '../hooks/useManga'
import { isMangaAdult, mangaNameVariants } from '../lib/manga'
import {
  useMangaLibrary,
  useMangaContinueReading,
  useRemoveMangaBookmark,
  useUpdateMangaStatus,
  useToggleMangaBookmark,
  mangaLibraryId,
  MANGA_LIBRARY_STATUSES,
  type ContinueReadingItem,
  type MangaLibraryItem,
} from '../hooks/useMangaLibrary'
import { useMangaPopup, type MangaPopupData } from '../hooks/useMangaPopup'
import styles from './Watchlist.module.css'

const FILTERS = ['All', 'Continue Reading', ...MANGA_LIBRARY_STATUSES]

const PAGE_SIZE = 24

type GridEntry = {
  key: string
  provider: string
  mangaId: string
  title: string
  altTitle?: string | null
  cover: string
  status: string
  type?: string
  contentRating?: string
  chapterLabel?: string
  progressPercent?: number
  progressLabel?: string
  detailTarget: string
  libId: string
}

const entryPopupData = (entry: GridEntry): MangaPopupData => ({
  provider: entry.provider,
  mangaId: entry.mangaId,
  title: entry.title,
  altTitle: entry.altTitle,
  cover: entry.cover,
  contentRating: entry.contentRating,
  readTarget: entry.detailTarget,
  progressLabel: entry.progressLabel,
})

export default function ReadingList() {
  const { filter: filterBy = 'All' } = useParams<{ filter: string }>()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)

  useEffect(() => {
    document.title = 'Reading List - dango'
  }, [])

  useEffect(() => {
    setPage(1)
  }, [filterBy])

  const isCR = filterBy === 'Continue Reading'
  const libraryQuery = useMangaLibrary(isCR ? 'All' : filterBy, page, PAGE_SIZE)
  const crQuery = useMangaContinueReading(100)
  const removeBookmark = useRemoveMangaBookmark()
  const updateStatus = useUpdateMangaStatus()
  const { toggle, bookmarkedIds } = useToggleMangaBookmark()
  const { popup, openPopup, scheduleClose, cancelClose, closePopup } = useMangaPopup()
  const [resetTarget, setResetTarget] = useState<GridEntry | null>(null)

  const entries: GridEntry[] = useMemo(() => {
    if (isCR) {
      return (crQuery.data?.data ?? []).map((item: ContinueReadingItem) => {
        const page = item.page ?? 0
        const pageCount = item.pageCount ?? 0
        return {
          key: item.id,
          provider: item.provider,
          mangaId: item.mangaId,
          title: item.title,
          altTitle: item.altTitle,
          cover: item.cover || '',
          status: item.status,
          contentRating: item.contentRating || undefined,
          chapterLabel: item.chapterNumber ? `Ch. ${item.chapterNumber}` : undefined,
          progressPercent: pageCount > 0 ? (page / pageCount) * 100 : 0,
          progressLabel:
            item.chapterNumber && pageCount > 0
              ? `Ch. ${item.chapterNumber} · p. ${page}/${pageCount}`
              : undefined,
          detailTarget:
            item.chapterId && item.provider && item.mangaId
              ? `/manga/${item.provider}/${encodeURIComponent(item.mangaId)}/read?chapter=${encodeURIComponent(item.chapterId)}`
              : `/manga/${item.provider}/${encodeURIComponent(item.mangaId)}`,
          libId: item.id,
        }
      })
    }
    return ((libraryQuery.data?.data ?? []) as MangaLibraryItem[]).map((item) => ({
      key: item.id,
      provider: item.provider,
      mangaId: item.mangaId,
      title: item.title,
      altTitle: item.altTitle,
      cover: item.cover || '',
      status: item.status,
      contentRating: item.contentRating || undefined,
      chapterLabel: item.lastChapterNumber ? `Ch. ${item.lastChapterNumber}` : undefined,
      progressPercent: undefined,
      progressLabel: undefined,
      detailTarget: `/manga/${item.provider}/${encodeURIComponent(item.mangaId)}`,
      libId: item.id,
    }))
  }, [isCR, crQuery.data, libraryQuery.data])

  const total = isCR ? (crQuery.data?.total ?? 0) : (libraryQuery.data?.total ?? 0)
  const isLoading = isCR ? crQuery.isLoading : libraryQuery.isLoading
  const error = isCR ? crQuery.error : libraryQuery.error

  return (
    <div className="page-container">
      <header className={styles.header}>
        <h2 className={styles.title}>My Reading List</h2>
        <p className={styles.subtitle}>Track and manage your manga collection</p>
      </header>

      <div className={styles.controls}>
        <div className={styles.filters}>
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`${styles.filterBtn} ${filterBy === f ? styles.active : ''}`}
              onClick={() => navigate(`/reading-list/${f === 'All' ? '' : f}`)}
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
          <h3 className={styles.emptyTitle}>Your reading list is looking a bit lonely</h3>
          <p className={styles.emptyText}>
            {filterBy !== 'All' ? 'No titles match this filter.' : "Let's find something to read!"}
          </p>
          <button className={styles.emptyBtn} onClick={() => navigate('/manga')}>
            <Icon name="search" size={14} />
            <span>Browse Manga</span>
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
                  ...mangaNameVariants({ title: entry.title, altTitle: entry.altTitle }),
                  thumbnail: mangaCoverSrc(entry.provider, entry.cover),
                  chapterBadge: entry.chapterLabel ?? null,
                  isAdult: isMangaAdult(entry),
                }}
                linkTo={entry.detailTarget}
                hoverIcon="book"
                progress={
                  entry.progressPercent !== undefined && entry.progressLabel
                    ? { percent: entry.progressPercent, label: entry.progressLabel }
                    : undefined
                }
                showProgress={isCR}
                display={{
                  elements: {
                    poster: { typeBadge: false, chapterBadge: true, adultBadge: true },
                    info: { title: true, mobileBadges: true, progress: true, meta: false },
                  },
                }}
                onRemove={isCR ? () => setResetTarget(entry) : undefined}
                onOpenDetails={(rect) => openPopup(rect, entryPopupData(entry))}
                onPopupHoverIntent={(inside) => (inside ? cancelClose() : scheduleClose())}
                rawThumbnail
              />
              {!isCR && (
                <div className={styles.cardActions}>
                  <select
                    className={styles.statusSelect}
                    value={entry.status}
                    onChange={(e) =>
                      updateStatus.mutate({ id: entry.libId, status: e.currentTarget.value })
                    }
                  >
                    {MANGA_LIBRARY_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    className={styles.removeBtn}
                    onClick={() => removeBookmark.mutate(entry.libId)}
                    title="Remove from Reading List"
                    aria-label="Remove from Reading List"
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

      {popup && popup.data.provider && (
        <MangaPopup
          data={popup.data}
          anchorRect={popup.rect}
          bookmarked={bookmarkedIds.has(mangaLibraryId(popup.data.provider, popup.data.mangaId))}
          onToggleBookmark={() =>
            toggle({
              id: popup.data.mangaId,
              provider: popup.data.provider,
              title: popup.data.title,
              cover: popup.data.cover,
              altTitle: popup.data.altTitle ?? undefined,
              contentRating: popup.data.contentRating,
            })
          }
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onRequestClose={closePopup}
        />
      )}
      <MangaResetProgressModal
        mangaId={resetTarget ? resetTarget.libId : null}
        title={resetTarget?.title}
        onClose={() => setResetTarget(null)}
      />
    </div>
  )
}
