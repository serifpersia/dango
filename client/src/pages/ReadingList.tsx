import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import MediaCard from '../components/common/MediaCard'
import LibraryListPage from '../components/common/LibraryListPage'
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
  useBatchUpdateMangaStatus,
  useBatchRemoveManga,
  useBatchRemoveMangaProgress,
  mangaLibraryId,
  MANGA_LIBRARY_STATUSES,
  type ContinueReadingItem,
  type MangaLibraryItem,
} from '../hooks/useMangaLibrary'
import { useMangaPopup, type MangaPopupData } from '../hooks/useMangaPopup'

const FILTERS = ['All', 'Continue Reading', ...MANGA_LIBRARY_STATUSES]

const PAGE_SIZE = 24

type GridEntry = {
  key: string
  libId: string
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
  const [page, setPage] = useState(1)
  const [resetTarget, setResetTarget] = useState<GridEntry | null>(null)

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
  const bulkUpdateStatus = useBatchUpdateMangaStatus()
  const bulkRemove = useBatchRemoveManga()
  const bulkResetProgress = useBatchRemoveMangaProgress()

  const entries: GridEntry[] = useMemo(() => {
    if (isCR) {
      return (crQuery.data?.data ?? []).map((item: ContinueReadingItem) => {
        const page = item.page ?? 0
        const pageCount = item.pageCount ?? 0
        return {
          key: item.id,
          libId: item.id,
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
        }
      })
    }
    return ((libraryQuery.data?.data ?? []) as MangaLibraryItem[]).map((item) => ({
      key: item.id,
      libId: item.id,
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
    }))
  }, [isCR, crQuery.data, libraryQuery.data])

  const total = isCR ? (crQuery.data?.total ?? 0) : (libraryQuery.data?.total ?? 0)
  const isLoading = isCR ? crQuery.isLoading : libraryQuery.isLoading
  const error = isCR ? crQuery.error : libraryQuery.error

  return (
    <LibraryListPage
      headerTitle="My Reading List"
      headerSubtitle="Track and manage your manga collection"
      filters={FILTERS}
      filterBy={filterBy}
      filterBasePath="/reading-list"
      continueFilter="Continue Reading"
      statusOptions={[...MANGA_LIBRARY_STATUSES]}
      entries={entries}
      total={total}
      isLoading={isLoading}
      error={error}
      page={page}
      pageSize={PAGE_SIZE}
      onPageChange={setPage}
      emptyTitle="Your reading list is looking a bit lonely"
      emptyFilteredText="No titles match this filter."
      emptyAllText="Let's find something to read!"
      browseLabel="Browse Manga"
      browseTarget="/manga"
      removeListLabel="Remove from Reading List"
      listNoun="reading list"
      skipConfirmKey="mangaSkipRemoveConfirmation"
      onBulkStatus={(ids, status) => bulkUpdateStatus.mutate({ ids, status })}
      onBulkRemove={(ids) => {
        if (isCR) bulkResetProgress.mutate(ids)
        else bulkRemove.mutate(ids)
      }}
      onStatusChange={(id, status) => updateStatus.mutate({ id, status })}
      onRemoveItem={(libId) => removeBookmark.mutate(libId)}
      renderCard={(entry) => (
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
      )}
      modals={
        <>
          {popup && popup.data.provider && (
            <MangaPopup
              data={popup.data}
              anchorRect={popup.rect}
              bookmarked={bookmarkedIds.has(
                mangaLibraryId(popup.data.provider, popup.data.mangaId)
              )}
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
        </>
      }
    />
  )
}
