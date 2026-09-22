import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import MediaCard from '../components/common/MediaCard'
import LibraryListPage from '../components/common/LibraryListPage'
import AsmrPopup from '../components/asmr/AsmrPopup'
import { useAsmrPopup } from '../hooks/useAsmrPopup'
import AsmrResetProgressModal from '../components/asmr/AsmrResetProgressModal'
import { formatTime } from '../lib/utils'
import {
  useAsmrLibrary,
  useAsmrContinueListening,
  useRemoveAsmrBookmark,
  useUpdateAsmrStatus,
  useToggleAsmrBookmark,
  useBatchUpdateAsmrStatus,
  useBatchRemoveAsmr,
  useBatchRemoveAsmrProgress,
  asmrLibraryId,
  ASMR_LIBRARY_STATUSES,
  type ContinueListeningItem,
  type AsmrLibraryItem,
} from '../hooks/useAsmrLibrary'

const FILTERS = ['All', 'Continue Listening', ...ASMR_LIBRARY_STATUSES]

const PAGE_SIZE = 24

type GridEntry = {
  key: string
  libId: string
  rjCode: string
  title: string
  thumbnail: string
  status: string
  isAdult: boolean
  trackLabel?: string
  progressPercent?: number
  progressLabel?: string
  detailTarget: string
}

function continueLabel(item: ContinueListeningItem): string | undefined {
  const current = item.currentTime ?? 0
  const total = item.duration ?? 0
  const trackNo = (item.trackIndex ?? 0) + 1
  if (total > 0) return `Track ${trackNo} · ${formatTime(current)} / ${formatTime(total)}`
  return `Track ${trackNo}`
}

export default function ListeningList() {
  const { filter: filterBy = 'All' } = useParams<{ filter: string }>()
  const [page, setPage] = useState(1)
  const [resetTarget, setResetTarget] = useState<GridEntry | null>(null)

  useEffect(() => {
    document.title = 'Listening List - dango'
  }, [])

  useEffect(() => {
    setPage(1)
  }, [filterBy])

  const isCL = filterBy === 'Continue Listening'
  const libraryQuery = useAsmrLibrary(isCL ? 'All' : filterBy, page, PAGE_SIZE)
  const clQuery = useAsmrContinueListening(100)
  const removeBookmark = useRemoveAsmrBookmark()
  const updateStatus = useUpdateAsmrStatus()
  const { toggle, bookmarkedIds } = useToggleAsmrBookmark()
  const { popup, openPopup, scheduleClose, cancelClose, closePopup } = useAsmrPopup()
  const bulkUpdateStatus = useBatchUpdateAsmrStatus()
  const bulkRemove = useBatchRemoveAsmr()
  const bulkResetProgress = useBatchRemoveAsmrProgress()

  const entries: GridEntry[] = useMemo(() => {
    if (isCL) {
      return (clQuery.data?.data ?? []).map((item: ContinueListeningItem) => {
        const current = item.currentTime ?? 0
        const total = item.duration ?? 0
        const rj = item.rjCode || item.id
        return {
          key: item.id,
          libId: item.id,
          rjCode: rj,
          title: item.title,
          thumbnail: item.thumbnail || '',
          status: item.status,
          isAdult: !!item.isAdult,
          trackLabel: `Track ${(item.trackIndex ?? 0) + 1}`,
          progressPercent: total > 0 ? Math.min(100, (current / total) * 100) : 0,
          progressLabel: continueLabel(item),
          detailTarget: `/asmr/${encodeURIComponent(rj)}`,
        }
      })
    }
    return ((libraryQuery.data?.data ?? []) as AsmrLibraryItem[]).map((item) => {
      const rj = item.rjCode || item.id
      return {
        key: item.id,
        libId: item.id,
        rjCode: rj,
        title: item.title,
        thumbnail: item.thumbnail || '',
        status: item.status,
        isAdult: !!item.isAdult,
        trackLabel:
          item.lastTrackIndex !== null && item.lastTrackIndex !== undefined
            ? `Track ${item.lastTrackIndex + 1}`
            : undefined,
        progressPercent: undefined,
        progressLabel: undefined,
        detailTarget: `/asmr/${encodeURIComponent(rj)}`,
      }
    })
  }, [isCL, clQuery.data, libraryQuery.data])

  const total = isCL ? (clQuery.data?.total ?? 0) : (libraryQuery.data?.total ?? 0)
  const isLoading = isCL ? clQuery.isLoading : libraryQuery.isLoading
  const error = isCL ? clQuery.error : libraryQuery.error

  return (
    <LibraryListPage
      headerTitle="My Listening List"
      headerSubtitle="Track and manage your ASMR collection"
      filters={FILTERS}
      filterBy={filterBy}
      filterBasePath="/listening-list"
      continueFilter="Continue Listening"
      statusOptions={[...ASMR_LIBRARY_STATUSES]}
      entries={entries}
      total={total}
      isLoading={isLoading}
      error={error}
      page={page}
      pageSize={PAGE_SIZE}
      onPageChange={setPage}
      emptyTitle="Your listening list is looking a bit lonely"
      emptyFilteredText="No works match this filter."
      emptyAllText="Let's find something to listen to!"
      browseLabel="Browse ASMR"
      browseTarget="/asmr"
      removeListLabel="Remove from Listening List"
      listNoun="listening list"
      skipConfirmKey="asmrSkipRemoveConfirmation"
      onBulkStatus={(ids, status) => bulkUpdateStatus.mutate({ ids, status })}
      onBulkRemove={(ids) => {
        if (isCL) bulkResetProgress.mutate(ids)
        else bulkRemove.mutate(ids)
      }}
      onStatusChange={(id, status) => updateStatus.mutate({ id, status })}
      onRemoveItem={(libId) => removeBookmark.mutate(libId)}
      renderCard={(entry) => (
        <MediaCard
          item={{
            id: entry.libId,
            title: entry.title,
            thumbnail: entry.thumbnail,
            typeBadge: entry.rjCode || undefined,
            chapterBadge: entry.trackLabel ?? null,
            isAdult: entry.isAdult,
          }}
          linkTo={entry.detailTarget}
          hoverIcon="info"
          layout="horizontal"
          showInfoButton={!isCL}
          progress={
            entry.progressPercent !== undefined && entry.progressLabel
              ? { percent: entry.progressPercent, label: entry.progressLabel }
              : undefined
          }
          showProgress={isCL}
          display={{
            elements: {
              poster: { typeBadge: true, chapterBadge: true, adultBadge: true },
              info: { title: true, mobileBadges: true, progress: true, meta: false },
            },
          }}
          onRemove={isCL ? () => setResetTarget(entry) : undefined}
          onOpenDetails={
            isCL
              ? undefined
              : (rect) =>
                  openPopup(rect, {
                    rjCode: entry.rjCode,
                    title: entry.title,
                    thumbnail: entry.thumbnail,
                    isAdult: entry.isAdult,
                    listenTarget: entry.detailTarget,
                    progressLabel: entry.progressLabel,
                  })
          }
          onPopupHoverIntent={(inside) => (inside ? cancelClose() : scheduleClose())}
          rawThumbnail
        />
      )}
      modals={
        <>
          <AsmrResetProgressModal
            workId={resetTarget ? resetTarget.libId : null}
            title={resetTarget?.title}
            onClose={() => setResetTarget(null)}
          />
          {popup && (
            <AsmrPopup
              data={popup.data}
              anchorRect={popup.rect}
              bookmarked={bookmarkedIds.has(asmrLibraryId(popup.data.rjCode))}
              onToggleBookmark={() =>
                toggle({
                  rjCode: popup.data.rjCode,
                  title: popup.data.title,
                  thumbnail: popup.data.thumbnail || '',
                  isAdult: popup.data.isAdult,
                })
              }
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
              onRequestClose={closePopup}
            />
          )}
        </>
      }
    />
  )
}
