import React, { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import Icon from './Icon'
import Pagination from './Pagination'
import SkeletonGrid from './SkeletonGrid'
import ErrorMessage from './ErrorMessage'
import { Modal } from './Modal'
import { Button } from './Button'
import { useSetting, useUpdateSetting } from '../../hooks/useSettings'
import styles from '../../pages/Watchlist.module.css'

export interface LibraryListEntry {
  key: string
  libId: string
  status: string
  title: string
}

interface LibraryListPageProps<T extends LibraryListEntry> {
  headerTitle: string
  headerSubtitle: string
  filters: string[]
  filterBy: string
  filterBasePath: string
  continueFilter: string
  statusOptions: string[]
  entries: T[]
  total: number
  isLoading: boolean
  error: unknown
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  emptyTitle: string
  emptyFilteredText: string
  emptyAllText: string
  browseLabel: string
  browseTarget: string
  removeListLabel: string
  listNoun: string
  skipConfirmKey: string
  onBulkStatus: (ids: string[], status: string) => void
  onBulkRemove: (ids: string[]) => void
  onStatusChange: (libId: string, status: string) => void
  onRemoveItem: (libId: string) => void
  renderCard: (entry: T) => ReactNode
  modals?: ReactNode
}

function LibraryListPage<T extends LibraryListEntry>({
  headerTitle,
  headerSubtitle,
  filters,
  filterBy,
  filterBasePath,
  continueFilter,
  statusOptions,
  entries,
  total,
  isLoading,
  error,
  page,
  pageSize,
  onPageChange,
  emptyTitle,
  emptyFilteredText,
  emptyAllText,
  browseLabel,
  browseTarget,
  removeListLabel,
  listNoun,
  skipConfirmKey,
  onBulkStatus,
  onBulkRemove,
  onStatusChange,
  onRemoveItem,
  renderCard,
  modals,
}: LibraryListPageProps<T>) {
  const navigate = useNavigate()
  const [manageMode, setManageMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmRemove, setConfirmRemove] = useState<{ ids: string[]; title?: string } | null>(null)
  const [rememberSkip, setRememberSkip] = useState(false)
  const { data: skipConfirm } = useSetting(skipConfirmKey)
  const updateSetting = useUpdateSetting()

  useEffect(() => {
    setSelectedIds(new Set())
    setManageMode(false)
  }, [filterBy])

  const isContinueView = filterBy === continueFilter
  const skipConfirmation = String(skipConfirm) === 'true' || String(skipConfirm) === '1'

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
    onBulkStatus([...selectedIds], status)
    setSelectedIds(new Set())
  }

  const handleBulkAction = () => {
    if (selectedIds.size === 0) return
    if (isContinueView || skipConfirmation) {
      onBulkRemove([...selectedIds])
      setSelectedIds(new Set())
    } else {
      setConfirmRemove({ ids: [...selectedIds] })
    }
  }

  const requestSingleRemove = (entry: T) => {
    if (isContinueView || skipConfirmation) {
      onRemoveItem(entry.libId)
    } else {
      setConfirmRemove({ ids: [entry.libId], title: entry.title })
    }
  }

  const handleConfirmRemove = () => {
    if (!confirmRemove) return
    if (rememberSkip) {
      updateSetting.mutate({ key: skipConfirmKey, value: true })
    }
    if (confirmRemove.ids.length === 1) {
      onRemoveItem(confirmRemove.ids[0])
    } else {
      onBulkRemove(confirmRemove.ids)
    }
    setSelectedIds(new Set())
    setConfirmRemove(null)
    setRememberSkip(false)
  }

  const closeConfirmRemove = () => {
    setConfirmRemove(null)
    setRememberSkip(false)
  }

  return (
    <div className="page-container">
      <header className={styles.header}>
        <h2 className={styles.title}>{headerTitle}</h2>
        <p className={styles.subtitle}>{headerSubtitle}</p>
      </header>

      <div className={styles.controls}>
        <div className={styles.filters}>
          {filters.map((f) => (
            <button
              key={f}
              className={`${styles.filterBtn} ${filterBy === f ? styles.active : ''}`}
              onClick={() => navigate(`${filterBasePath}/${f === 'All' ? '' : f}`)}
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
            <Pagination
              page={page}
              totalPages={Math.max(1, Math.ceil(total / pageSize))}
              canGoNext={entries.length >= pageSize}
              onChange={onPageChange}
              isLoading={isLoading}
            />
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
          {!isContinueView && (
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
              {statusOptions.map((s) => (
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
            <span>{isContinueView ? 'Reset Selected' : 'Remove Selected'}</span>
          </button>
        </div>
      )}

      {isLoading ? (
        <SkeletonGrid />
      ) : error ? (
        <ErrorMessage message={(error as Error).message} />
      ) : entries.length === 0 ? (
        <div className={styles.emptyState}>
          <h3 className={styles.emptyTitle}>{emptyTitle}</h3>
          <p className={styles.emptyText}>
            {filterBy !== 'All' ? emptyFilteredText : emptyAllText}
          </p>
          <button className={styles.emptyBtn} onClick={() => navigate(browseTarget)}>
            <Icon name="search" size={14} />
            <span>{browseLabel}</span>
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
              {renderCard(entry)}
              {!isContinueView && !manageMode && (
                <div className={styles.cardActions}>
                  <select
                    className={styles.statusSelect}
                    value={entry.status}
                    onChange={(e) => onStatusChange(entry.libId, e.currentTarget.value)}
                  >
                    {statusOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    className={styles.removeBtn}
                    onClick={() => requestSingleRemove(entry)}
                    title={removeListLabel}
                    aria-label={removeListLabel}
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
          <Pagination
            page={page}
            totalPages={Math.max(1, Math.ceil(total / pageSize))}
            canGoNext={entries.length >= pageSize}
            onChange={onPageChange}
            isLoading={isLoading}
            variant="labeled"
          />
        </div>
      )}

      {modals}

      <Modal
        isOpen={!!confirmRemove}
        onClose={closeConfirmRemove}
        title={`Remove from ${listNoun}`}
      >
        <Modal.Body>
          <p>
            {confirmRemove && confirmRemove.ids.length === 1
              ? `Are you sure you want to remove "${confirmRemove.title}" from your ${listNoun}?`
              : `Are you sure you want to remove ${confirmRemove?.ids.length ?? 0} selected items from your ${listNoun}?`}
          </p>
          <label>
            <input
              type="checkbox"
              checked={rememberSkip}
              onChange={(e) => setRememberSkip(e.target.checked)}
            />
            Don&apos;t ask again
          </label>
        </Modal.Body>
        <Modal.Actions>
          <Button variant="secondary" onClick={closeConfirmRemove}>
            No
          </Button>
          <Button variant="danger" onClick={handleConfirmRemove}>
            Yes
          </Button>
        </Modal.Actions>
      </Modal>
    </div>
  )
}

export default LibraryListPage
