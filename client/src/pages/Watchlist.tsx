import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  FaChevronDown,
  FaChevronUp,
  FaFilter,
  FaSearch,
  FaTrash,
  FaChevronLeft,
  FaChevronRight,
  FaCheck,
  FaCheckCircle,
  FaRegCircle,
  FaPencilAlt,
} from 'react-icons/fa'

import AnimeCard from '../components/anime/AnimeCard'
import SkeletonGrid from '../components/common/SkeletonGrid'
import ErrorMessage from '../components/common/ErrorMessage'
import RemoveConfirmationModal from '../components/common/RemoveConfirmationModal'
import { Button } from '../components/common/Button'

import {
  usePaginatedWatchlist,
  useRemoveFromWatchlist,
  useBatchRemoveFromWatchlist,
  useBatchRemoveFromContinueWatching,
  useBatchUpdateWatchlistStatus,
  usePaginatedAllContinueWatching,
  useGenresAndStudios,
} from '../hooks/useAnimeData'
import { useSetting, useUpdateSetting } from '../hooks/useSettings'
import { useLowEndMode } from '../contexts/LowEndModeContext'
import { useTitlePreference } from '../contexts/TitlePreferenceContext'
import styles from './Watchlist.module.css'

const FILTERS = [
  'All',
  'Continue Watching',
  'Watching',
  'Completed',
  'On-Hold',
  'Dropped',
  'Planned',
]

const STATUS_OPTIONS = FILTERS.slice(2)

interface Option {
  value: string
  label: string
}

const typeOptions: Option[] = [
  { value: 'ALL', label: 'All Types' },
  { value: 'TV', label: 'TV Series' },
  { value: 'Movie', label: 'Movie' },
  { value: 'OVA', label: 'OVA' },
  { value: 'ONA', label: 'ONA' },
  { value: 'TV_SHORT', label: 'TV Short' },
  { value: 'SPECIAL', label: 'Special' },
]

const seasonOptions: Option[] = [
  { value: 'ALL', label: 'All Seasons' },
  { value: 'WINTER', label: 'Winter' },
  { value: 'SPRING', label: 'Spring' },
  { value: 'SUMMER', label: 'Summer' },
  { value: 'FALL', label: 'Fall' },
]

const Watchlist: React.FC = () => {
  const { filter: filterBy = 'All' } = useParams<{ filter: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(parseInt(searchParams.get('page') || '1'))
  const [query, setQuery] = useState(searchParams.get('query') || '')
  const [sortBy, setSortBy] = useState(searchParams.get('sortBy') || 'last_added')
  const [type, setType] = useState(searchParams.get('type') || 'ALL')
  const [season, setSeason] = useState(searchParams.get('season') || 'ALL')
  const [year, setYear] = useState(searchParams.get('year') || 'ALL')
  const [genreStates, setGenreStates] = useState<{ [key: string]: 'include' | 'exclude' }>(() => {
    const states: { [key: string]: 'include' | 'exclude' } = {}
    const genres = searchParams.get('genres')?.split(',').filter(Boolean) || []
    const exclude = searchParams.get('excludeGenres')?.split(',').filter(Boolean) || []
    genres.forEach((g) => g && (states[g] = 'include'))
    exclude.forEach((g) => g && (states[g] = 'exclude'))
    return states
  })
  const [showFilters, setShowFilters] = useState(() =>
    ['type', 'season', 'year', 'genres', 'excludeGenres'].some((key) => searchParams.has(key))
  )
  const { lowEndMode } = useLowEndMode()
  const { titlePreference } = useTitlePreference()
  const { data: metaData } = useGenresAndStudios()
  const availableGenres = metaData?.genres || []
  const gridRef = useRef<HTMLDivElement>(null)

  const [itemToRemove, setItemToRemove] = useState<{
    id?: string
    ids?: string[]
    name?: string
  } | null>(null)

  const [manageMode, setManageMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const isCW = filterBy === 'Continue Watching'
  const watchlistQueryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    params.delete('page')
    params.set('titlePreference', titlePreference)
    return params.toString()
  }, [searchParams, titlePreference])

  const {
    data: cwData,
    isLoading: loadingCW,
    error: errorCW,
  } = usePaginatedAllContinueWatching(watchlistQueryString, page, 14)

  const {
    data: wlData,
    isLoading: loadingWL,
    error: errorWL,
  } = usePaginatedWatchlist(filterBy, watchlistQueryString, page, 14)

  const { data: nextCwData } = usePaginatedAllContinueWatching(watchlistQueryString, page + 1, 14)
  const { data: nextWlData } = usePaginatedWatchlist(filterBy, watchlistQueryString, page + 1, 14)

  const list = useMemo(() => (isCW ? cwData?.data : wlData?.data) || [], [isCW, cwData, wlData])
  const total = useMemo(() => (isCW ? cwData?.total : wlData?.total) || 0, [isCW, cwData, wlData])
  const isLoading = isCW ? loadingCW : loadingWL
  const error = isCW ? errorCW : errorWL
  const nextPageData = isCW ? nextCwData : nextWlData

  useEffect(() => {
    setQuery(searchParams.get('query') || '')
    setSortBy(searchParams.get('sortBy') || 'last_added')
    setType(searchParams.get('type') || 'ALL')
    setSeason(searchParams.get('season') || 'ALL')
    setYear(searchParams.get('year') || 'ALL')
    const states: { [key: string]: 'include' | 'exclude' } = {}
    const genres = searchParams.get('genres')?.split(',').filter(Boolean) || []
    const exclude = searchParams.get('excludeGenres')?.split(',').filter(Boolean) || []
    genres.forEach((g) => g && (states[g] = 'include'))
    exclude.forEach((g) => g && (states[g] = 'exclude'))
    setGenreStates(states)
    setPage(parseInt(searchParams.get('page') || '1'))
    setSelectedIds(new Set())
  }, [searchParams])

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await fetch('/api/watchlist/status', {
        method: 'POST',
        body: JSON.stringify({ id, status }),
        headers: { 'Content-Type': 'application/json' },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchlist'] })
      toast.success('Status updated')
    },
  })

  const removeCw = useMutation({
    mutationFn: async (showId: string) => {
      await fetch('/api/continue-watching/remove', {
        method: 'POST',
        body: JSON.stringify({ showId }),
        headers: { 'Content-Type': 'application/json' },
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] }),
  })

  const removeWl = useRemoveFromWatchlist()
  const { data: skipConfirm } = useSetting('skipRemoveConfirmation')
  const updateSetting = useUpdateSetting()

  const sortedList = useMemo(() => {
    const getSortTitle = (item: (typeof list)[number]) =>
      (item[titlePreference as keyof typeof item] as string) || item.name || ''

    return [...list].sort((a, b) => {
      if (sortBy === 'name_asc') return getSortTitle(a).localeCompare(getSortTitle(b))
      if (sortBy === 'name_desc') return getSortTitle(b).localeCompare(getSortTitle(a))
      return 0
    })
  }, [list, sortBy, titlePreference])

  const currentYear = new Date().getFullYear()
  const yearOptions: Option[] = [
    { value: 'ALL', label: 'All Years' },
    ...Array.from({ length: currentYear - 1980 + 1 }, (_, i) => ({
      value: String(currentYear - i),
      label: String(currentYear - i),
    })),
  ]

  const applyFilters = (nextSortBy = sortBy, newPage = 1) => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('query', query.trim())
    if (nextSortBy !== 'last_added') params.set('sortBy', nextSortBy)
    if (type !== 'ALL') params.set('type', type)
    if (season !== 'ALL') params.set('season', season)
    if (year !== 'ALL') params.set('year', year)
    const includeGenres = Object.entries(genreStates)
      .filter(([, s]) => s === 'include')
      .map(([g]) => g)
    const excludeGenres = Object.entries(genreStates)
      .filter(([, s]) => s === 'exclude')
      .map(([g]) => g)
    if (includeGenres.length > 0) params.set('genres', includeGenres.join(','))
    if (excludeGenres.length > 0) params.set('excludeGenres', excludeGenres.join(','))
    if (newPage > 1) params.set('page', newPage.toString())
    setSearchParams(params)
    if (newPage !== page) {
      setPage(newPage)
    }
  }

  const handlePageChange = (newPage: number) => {
    applyFilters(sortBy, newPage)
    if (gridRef.current) {
      const y = gridRef.current.getBoundingClientRect().top + window.scrollY - 100
      window.scrollTo({ top: y, behavior: 'smooth' })
    }
  }

  const resetFilters = () => {
    setQuery('')
    setSortBy('last_added')
    setType('ALL')
    setSeason('ALL')
    setYear('ALL')
    setGenreStates({})
    setSearchParams(new URLSearchParams())
    setPage(1)
  }

  const toggleGenre = (genre: string) => {
    setGenreStates((prev) => {
      const current = prev[genre]
      const newState = { ...prev }
      if (current === 'include') {
        newState[genre] = 'exclude'
      } else if (current === 'exclude') {
        delete newState[genre]
      } else {
        newState[genre] = 'include'
      }
      return newState
    })
  }

  const handleRemove = (id: string, name: string) => {
    if (isCW) {
      setItemToRemove({ id, name })
      return
    }

    const shouldSkip = String(skipConfirm) === 'true' || String(skipConfirm) === '1'
    if (shouldSkip) {
      removeWl.mutate(id)
    } else {
      setItemToRemove({ id, name })
    }
  }

  const confirmRemove = (opts: { removeFromWatchlist?: boolean; rememberPreference?: boolean }) => {
    if (!itemToRemove) return
    if (itemToRemove.ids) {
      if (isCW) {
        bulkRemoveCw.mutate(itemToRemove.ids)
        if (opts.removeFromWatchlist) {
          bulkRemove.mutate(itemToRemove.ids)
        }
      } else {
        bulkRemove.mutate(itemToRemove.ids)
      }
      setSelectedIds(new Set())
      setItemToRemove(null)
      return
    }
    if (isCW) {
      removeCw.mutate(itemToRemove.id)
      if (opts.removeFromWatchlist) {
        removeWl.mutate(itemToRemove.id)
      }
    } else {
      removeWl.mutate(itemToRemove.id)
    }
    if (opts.rememberPreference)
      updateSetting.mutate({ key: 'skipRemoveConfirmation', value: true })
    setItemToRemove(null)
  }

  const handleStatusChange = (id: string, status: string) => {
    updateStatus.mutate({ id, status })
  }

  const bulkRemove = useBatchRemoveFromWatchlist()
  const bulkRemoveCw = useBatchRemoveFromContinueWatching()
  const bulkUpdateStatus = useBatchUpdateWatchlistStatus()

  const toggleManageMode = () => {
    setManageMode((prev) => {
      const next = !prev
      if (!next) setSelectedIds(new Set())
      return next
    })
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const pageIds = sortedList.map((item) => item.id)
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(pageIds))
    }
  }

  const handleBulkStatus = (status: string) => {
    if (selectedIds.size === 0) return
    bulkUpdateStatus.mutate({ ids: [...selectedIds], status })
    setSelectedIds(new Set())
  }

  const handleBulkRemove = () => {
    if (selectedIds.size === 0) return
    setItemToRemove({ ids: [...selectedIds] })
  }

  const canGoNext = list.length >= 14 && nextPageData && nextPageData.data.length > 0

  return (
    <div className="page-container">
      <header className={styles.header}>
        <h2 className={styles.title}>My Watchlist</h2>
        <p className={styles.subtitle}>Track and manage your anime collection</p>
      </header>

      <div className={styles.controls}>
        <div className={styles.filters}>
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`${styles.filterBtn} ${filterBy === f ? styles.active : ''}`}
              onClick={() => {
                const params = new URLSearchParams(searchParams)
                params.delete('page')
                navigate({
                  pathname: `/watchlist/${f}`,
                  search: params.toString(),
                })
                setPage(1)
              }}
            >
              {f}
            </button>
          ))}
        </div>
        <div>
          <select
            className={styles.sortSelect}
            value={sortBy}
            onChange={(e) => {
              const nextSortBy = e.currentTarget.value
              setSortBy(nextSortBy)
              applyFilters(nextSortBy, page)
            }}
          >
            <option value="last_added">Recently Added</option>
            <option value="name_asc">Name (A-Z)</option>
            <option value="name_desc">Name (Z-A)</option>
          </select>
        </div>
      </div>

      <div className={styles.filterContainer}>
        <div className={styles.searchBarWrapper}>
          <div className={styles.inputIconWrapper}>
            <FaSearch className={styles.searchIcon} />
            <input
              className={styles.searchInput}
              placeholder="Search your watchlist by title..."
              value={query}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
          </div>
          <div className={styles.searchActions}>
            <Button onClick={() => applyFilters()} className={styles.searchBtn}>
              Search
            </Button>
            <button
              className={`${styles.filterToggleBtn} ${showFilters ? styles.active : ''}`}
              onClick={() => setShowFilters(!showFilters)}
            >
              <FaFilter size={14} />
              <span>Filters</span>
              {showFilters ? <FaChevronUp size={12} /> : <FaChevronDown size={12} />}
            </button>
          </div>
        </div>

        <div className={`${styles.advancedFilters} ${showFilters ? styles.show : ''}`}>
          <div className={styles.filterDivider} />

          <div className={styles.filterGrid}>
            <div className={styles.filterItem}>
              <label>Type</label>
              <select value={type} onChange={(e) => setType(e.currentTarget.value)}>
                {typeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.filterItem}>
              <label>Season</label>
              <select value={season} onChange={(e) => setSeason(e.currentTarget.value)}>
                {seasonOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.filterItem}>
              <label>Year</label>
              <select value={year} onChange={(e) => setYear(e.currentTarget.value)}>
                {yearOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {availableGenres.length > 0 && (
            <div className={styles.genreSection}>
              <label className={styles.genreLabel}>Genres</label>
              <div className={styles.genreContainer}>
                {availableGenres.map((genre) => (
                  <button
                    key={genre}
                    className={`${styles.genreButton} ${styles[genreStates[genre] || '']}`}
                    onClick={() => toggleGenre(genre)}
                  >
                    {genre}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={styles.filterActions}>
            <Button variant="secondary" onClick={resetFilters}>
              Reset All
            </Button>
            <Button onClick={() => applyFilters()} className={styles.applyBtn}>
              Apply Filters
            </Button>
          </div>
        </div>
      </div>

      <div className={styles.resultsHeader} ref={gridRef}>
        <h3 className={styles.resultsTitle}>
          {isCW ? 'Continue Watching' : filterBy}
          <span className={styles.itemCount}>({total} items)</span>
        </h3>

        <div className={styles.headerActions}>
          <button
            className={`${styles.manageBtn} ${manageMode ? styles.active : ''}`}
            onClick={toggleManageMode}
          >
            <FaPencilAlt size={13} />
            <span>Bulk Manage</span>
          </button>
          {total > 0 && (
            <div className={styles.pagination}>
              <button
                className={styles.pageBtn}
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1 || isLoading}
                aria-label="Previous page"
              >
                <FaChevronLeft size={14} />
              </button>
              <span className={styles.pageInfo}>
                Page <strong>{page}</strong>
              </span>
              <button
                className={styles.pageBtn}
                onClick={() => handlePageChange(page + 1)}
                disabled={!canGoNext || isLoading}
                aria-label="Next page"
              >
                <FaChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {manageMode && (
        <div className={styles.manageBar}>
          <button className={styles.selectAllBtn} onClick={handleSelectAll}>
            {allSelected ? <FaCheckCircle size={16} /> : <FaRegCircle size={16} />}
            <span>{allSelected ? 'Clear Page' : 'Select All'}</span>
          </button>
          <span className={styles.manageCount}>{selectedIds.size} selected</span>
          <div className={styles.manageSpacer} />
          {!isCW && (
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
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          <button
            className={styles.manageRemoveBtn}
            onClick={handleBulkRemove}
            disabled={selectedIds.size === 0}
          >
            <FaTrash size={13} />
            <span>Remove Selected</span>
          </button>
        </div>
      )}

      {isLoading ? (
        <SkeletonGrid />
      ) : error ? (
        <ErrorMessage message={error.message} />
      ) : (
        <>
          {(type !== 'ALL' ||
            season !== 'ALL' ||
            year !== 'ALL' ||
            Object.keys(genreStates).length > 0 ||
            query.trim()) && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                alignItems: 'center',
                marginBottom: '1.5rem',
              }}
            >
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Active Filters:
              </span>

              {query.trim() && (
                <span
                  className="badge badge-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  Search: {query}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      setQuery('')
                      applyFilters()
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    ✕
                  </button>
                </span>
              )}

              {type !== 'ALL' && (
                <span
                  className="badge badge-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  Type: {type}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      setType('ALL')
                      applyFilters()
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    ✕
                  </button>
                </span>
              )}

              {season !== 'ALL' && (
                <span
                  className="badge badge-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  Season: {season}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      setSeason('ALL')
                      applyFilters()
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    ✕
                  </button>
                </span>
              )}

              {year !== 'ALL' && (
                <span
                  className="badge badge-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  Year: {year}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      setYear('ALL')
                      applyFilters()
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    ✕
                  </button>
                </span>
              )}

              {Object.entries(genreStates).map(([genre, state]) => (
                <span
                  key={genre}
                  className={`badge ${state === 'include' ? 'badge-primary' : 'badge-danger'}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  {state === 'include' ? `+ ${genre}` : `- ${genre}`}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      setGenreStates((prev) => {
                        const copy = { ...prev }
                        delete copy[genre]
                        return copy
                      })
                      applyFilters()
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className={`${styles.grid} ${lowEndMode ? styles.lowEnd : ''}`}>
            {sortedList.map((item) => {
              const selected = selectedIds.has(item.id)
              return (
                <div
                  key={item._id}
                  className={`${styles.itemWrapper} ${selected ? styles.selected : ''}`}
                >
                  {manageMode && (
                    <div
                      className={styles.selectOverlay}
                      onClick={() => toggleSelect(item.id)}
                      title={selected ? 'Deselect' : 'Select'}
                    >
                      <span className={styles.selectBadge}>
                        {selected ? <FaCheck size={12} /> : null}
                      </span>
                    </div>
                  )}
                  <AnimeCard
                    anime={item}
                    continueWatching={isCW}
                    onRemove={() => handleRemove(item.id, item.name)}
                    layout="vertical"
                  />
                  {!isCW && !manageMode && (
                    <div className={styles.cardActions}>
                      <select
                        className={styles.statusSelect}
                        value={item.status}
                        onChange={(e) =>
                          updateStatus.mutate({ id: item.id, status: e.currentTarget.value })
                        }
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <button
                        className={styles.removeBtn}
                        onClick={() => handleRemove(item.id, item.name)}
                        title="Remove from Watchlist"
                        aria-label="Remove from Watchlist"
                      >
                        <FaTrash size={12} />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {!isLoading && sortedList.length === 0 && (
        <div className={styles.emptyState}>
          <h3 className={styles.emptyTitle}>Your watchlist is looking a bit lonely</h3>
          <p className={styles.emptyText}>
            {filterBy !== 'All' ||
            query ||
            type !== 'ALL' ||
            season !== 'ALL' ||
            year !== 'ALL' ||
            Object.keys(genreStates).length > 0
              ? 'No anime match these filters. Try adjusting them to see more titles.'
              : "Let's find something to watch!"}
          </p>
          <button className={styles.emptyBtn} onClick={() => navigate('/search')}>
            <FaSearch size={14} />
            <span>Browse Anime</span>
          </button>
        </div>
      )}

      {total > 0 && (
        <div className={styles.bottomPagination}>
          <div className={styles.pagination}>
            <button
              className={styles.pageBtn}
              onClick={() => handlePageChange(page - 1)}
              disabled={page === 1 || isLoading}
            >
              <FaChevronLeft size={14} />
              <span>Previous</span>
            </button>
            <span className={styles.pageInfo}>
              Page <strong>{page}</strong>
            </span>
            <button
              className={styles.pageBtn}
              onClick={() => handlePageChange(page + 1)}
              disabled={!canGoNext || isLoading}
            >
              <span>Next</span>
              <FaChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      <RemoveConfirmationModal
        isOpen={!!itemToRemove}
        onClose={() => setItemToRemove(null)}
        onConfirm={confirmRemove}
        animeName={itemToRemove?.name || ''}
        scenario={isCW ? 'continueWatching' : 'watchlist'}
        count={itemToRemove?.ids?.length}
      />
    </div>
  )
}

export default Watchlist
