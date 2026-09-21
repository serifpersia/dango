import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import Icon from '../components/common/Icon'
import SkeletonGrid from '../components/common/SkeletonGrid'
import ErrorMessage from '../components/common/ErrorMessage'
import MediaCard from '../components/common/MediaCard'
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
import styles from './Watchlist.module.css'

const FILTERS = ['All', 'Continue Listening', ...ASMR_LIBRARY_STATUSES]

const PAGE_SIZE = 24

type GridEntry = {
  key: string
  rjCode: string
  title: string
  thumbnail: string
  status: string
  isAdult: boolean
  trackLabel?: string
  progressPercent?: number
  progressLabel?: string
  detailTarget: string
  libId: string
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
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [manageMode, setManageMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    document.title = 'Listening List - dango'
  }, [])

  useEffect(() => {
    setPage(1)
    setSelectedIds(new Set())
  }, [filterBy])

  const isCL = filterBy === 'Continue Listening'
  const libraryQuery = useAsmrLibrary(isCL ? 'All' : filterBy, page, PAGE_SIZE)
  const clQuery = useAsmrContinueListening(100)
  const removeBookmark = useRemoveAsmrBookmark()
  const updateStatus = useUpdateAsmrStatus()
  const { toggle, bookmarkedIds } = useToggleAsmrBookmark()
  const { popup, openPopup, scheduleClose, cancelClose, closePopup } = useAsmrPopup()
  const [resetTarget, setResetTarget] = useState<GridEntry | null>(null)
  const bulkUpdateStatus = useBatchUpdateAsmrStatus()
  const bulkRemove = useBatchRemoveAsmr()
  const bulkResetProgress = useBatchRemoveAsmrProgress()

  const toggleManageMode = () => {
    setManageMode((prev) => {
      if (prev) setSelectedIds(new Set())
      return !prev
    })
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const entries: GridEntry[] = useMemo(() => {
    if (isCL) {
      return (clQuery.data?.data ?? []).map((item: ContinueListeningItem) => {
        const current = item.currentTime ?? 0
        const total = item.duration ?? 0
        const rj = item.rjCode || item.id
        return {
          key: item.id,
          rjCode: rj,
          title: item.title,
          thumbnail: item.thumbnail || '',
          status: item.status,
          isAdult: !!item.isAdult,
          trackLabel: `Track ${(item.trackIndex ?? 0) + 1}`,
          progressPercent: total > 0 ? Math.min(100, (current / total) * 100) : 0,
          progressLabel: continueLabel(item),
          detailTarget: `/asmr/${encodeURIComponent(rj)}`,
          libId: item.id,
        }
      })
    }
    return ((libraryQuery.data?.data ?? []) as AsmrLibraryItem[]).map((item) => {
      const rj = item.rjCode || item.id
      return {
        key: item.id,
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
        libId: item.id,
      }
    })
  }, [isCL, clQuery.data, libraryQuery.data])

  const total = isCL ? (clQuery.data?.total ?? 0) : (libraryQuery.data?.total ?? 0)
  const isLoading = isCL ? clQuery.isLoading : libraryQuery.isLoading
  const error = isCL ? clQuery.error : libraryQuery.error

  const pageIds = entries.map((entry) => entry.libId)
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))

  const handleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const id of pageIds) next.delete(id)
      } else {
        for (const id of pageIds) next.add(id)
      }
      return next
    })
  }

  const handleBulkStatus = (status: string) => {
    if (selectedIds.size === 0) return
    bulkUpdateStatus.mutate({ ids: [...selectedIds], status })
    setSelectedIds(new Set())
  }

  const handleBulkAction = () => {
    if (selectedIds.size === 0) return
    if (isCL) {
      bulkResetProgress.mutate([...selectedIds])
    } else {
      bulkRemove.mutate([...selectedIds])
    }
    setSelectedIds(new Set())
  }

  return (
    <div className="page-container">
      <header className={styles.header}>
        <h2 className={styles.title}>My Listening List</h2>
        <p className={styles.subtitle}>Track and manage your ASMR collection</p>
      </header>

      <div className={styles.controls}>
        <div className={styles.filters}>
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`${styles.filterBtn} ${filterBy === f ? styles.active : ''}`}
              onClick={() => navigate(`/listening-list/${f === 'All' ? '' : f}`)}
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
        <div className={styles.headerActions}>
          <button
            className={`${styles.manageBtn} ${manageMode ? styles.active : ''}`}
            onClick={toggleManageMode}
          >
            <Icon name="pencil-alt" size={13} />
            <span>Bulk Manage</span>
          </button>
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
      </div>

      {manageMode && (
        <div className={styles.manageBar}>
          <button className={styles.selectAllBtn} onClick={handleSelectAll}>
            <span
              className={`${styles.selectAllBox} ${allSelected ? styles.selectAllBoxChecked : ''}`}
              aria-hidden="true"
            />
            <span>{allSelected ? 'Clear Page' : 'Select All'}</span>
          </button>
          <span className={styles.manageCount}>{selectedIds.size} selected</span>
          <div className={styles.manageSpacer} />
          {!isCL && (
            <select
              className={styles.manageStatusSelect}
              value=""
              onChange={(e) => {
                if (e.currentTarget.value) {
                  handleBulkStatus(e.currentTarget.value)
                }
              }}
              disabled={selectedIds.size === 0}
              title="Set status for selected items"
            >
              <option value="">Set status…</option>
              {ASMR_LIBRARY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          <button
            className={styles.manageRemoveBtn}
            onClick={handleBulkAction}
            disabled={selectedIds.size === 0}
          >
            <Icon name="trash" size={13} />
            <span>{isCL ? 'Reset Selected' : 'Remove Selected'}</span>
          </button>
        </div>
      )}

      {isLoading ? (
        <SkeletonGrid />
      ) : error ? (
        <ErrorMessage message={(error as Error).message} />
      ) : entries.length === 0 ? (
        <div className={styles.emptyState}>
          <h3 className={styles.emptyTitle}>Your listening list is looking a bit lonely</h3>
          <p className={styles.emptyText}>
            {filterBy !== 'All'
              ? 'No works match this filter.'
              : "Let's find something to listen to!"}
          </p>
          <button className={styles.emptyBtn} onClick={() => navigate('/asmr')}>
            <Icon name="search" size={14} />
            <span>Browse ASMR</span>
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          {entries.map((entry) => (
            <div
              key={entry.key}
              className={`${styles.itemWrapper} ${selectedIds.has(entry.libId) ? styles.selected : ''}`}
            >
              {manageMode && (
                <div
                  className={styles.selectOverlay}
                  onClick={() => toggleSelect(entry.libId)}
                  title={selectedIds.has(entry.libId) ? 'Deselect' : 'Select'}
                >
                  <span className={styles.selectBadge}>
                    {selectedIds.has(entry.libId) ? <Icon name="check" size={12} /> : null}
                  </span>
                </div>
              )}
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
              {!isCL && !manageMode && (
                <div className={styles.cardActions}>
                  <select
                    className={styles.statusSelect}
                    value={entry.status}
                    onChange={(e) =>
                      updateStatus.mutate({ id: entry.libId, status: e.currentTarget.value })
                    }
                  >
                    {ASMR_LIBRARY_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    className={styles.removeBtn}
                    onClick={() => removeBookmark.mutate(entry.libId)}
                    title="Remove from Listening List"
                    aria-label="Remove from Listening List"
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
    </div>
  )
}
