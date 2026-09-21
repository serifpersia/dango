import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router'
import Icon from '../components/common/Icon'
import TvCard from '../components/tv/TvCard'
import SkeletonGrid from '../components/common/SkeletonGrid'
import { Button } from '../components/common/Button'
import ErrorMessage from '../components/common/ErrorMessage'
import { useTvSearchPaginated, type TvSearchResult } from '../hooks/useTv'
import { useLowEndMode } from '../contexts/LowEndModeContext'
import { hideVirtualKeyboard } from '../hooks/useVirtualKeyboard'
import styles from './Search.module.css'

interface Option {
  value: string
  label: string
}

const typeOptions: Option[] = [
  { value: 'multi', label: 'All' },
  { value: 'tv', label: 'TV Shows' },
  { value: 'movie', label: 'Movies' },
]

const sortOptions: Option[] = [
  { value: 'popularity.desc', label: 'Popularity' },
  { value: 'vote_average.desc', label: 'Top Rated' },
  { value: 'primary_release_date.desc', label: 'Newest' },
  { value: 'primary_release_date.asc', label: 'Oldest' },
  { value: 'vote_count.desc', label: 'Most Voted' },
]

const TV_GENRES: Record<number, string> = {
  10759: 'Action & Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  10762: 'Kids',
  9648: 'Mystery',
  10765: 'Sci-Fi & Fantasy',
  37: 'Western',
}

const MOVIE_GENRES: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
}

const currentYear = new Date().getFullYear()
const yearOptions: Option[] = [
  { value: 'ALL', label: 'All Years' },
  ...Array.from({ length: currentYear - 1980 + 1 }, (_, i) => ({
    value: String(currentYear - i),
    label: String(currentYear - i),
  })),
]

export default function TvSearch() {
  useEffect(() => {
    document.title = 'Search TV & Movies - dango'
  }, [])

  const [searchParams, setSearchParams] = useSearchParams()
  const { lowEndMode } = useLowEndMode()
  const resultsRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [submittedQuery, setSubmittedQuery] = useState(searchParams.get('q') || '')
  const [page, setPage] = useState(parseInt(searchParams.get('page') || '1', 10) || 1)
  const [type, setType] = useState(searchParams.get('type') || 'multi')
  const [genre, setGenre] = useState(searchParams.get('genre') || '')
  const [year, setYear] = useState(searchParams.get('year') || 'ALL')
  const [sort, setSort] = useState(searchParams.get('sort_by') || 'popularity.desc')
  const [showFilters, setShowFilters] = useState(false)

  const [genreState, setGenreState] = useState<Record<string, 'include' | 'exclude'>>(() => {
    const states: Record<string, 'include' | 'exclude'> = {}
    const g = searchParams.get('genre') || ''
    if (g) states[g] = 'include'
    return states
  })

  const genreOptions = useMemo(() => {
    if (type === 'tv') {
      return Object.entries(TV_GENRES).map(([id, name]) => ({ id, name }))
    }
    if (type === 'movie') {
      return Object.entries(MOVIE_GENRES).map(([id, name]) => ({ id, name }))
    }
    const all = new Map<string, string>()
    for (const [id, name] of Object.entries(TV_GENRES)) all.set(id, name)
    for (const [id, name] of Object.entries(MOVIE_GENRES)) all.set(id, name)
    return Array.from(all.entries()).map(([id, name]) => ({ id, name }))
  }, [type])

  const genreParam = useMemo(() => {
    const included = Object.entries(genreState)
      .filter(([, s]) => s === 'include')
      .map(([g]) => g)
    return included.join(',')
  }, [genreState])

  const {
    data: response,
    isLoading,
    isError,
    error,
  } = useTvSearchPaginated({
    query: submittedQuery,
    type,
    genre: genreParam,
    year,
    sort_by: sort,
    page,
  })

  const results: TvSearchResult[] = response?.results || []
  const totalPages = response?.total_pages || 0
  const totalResults = response?.total_results || 0
  const canGoNext = page < Math.min(totalPages, 500)

  const writeParams = useCallback(
    (overrides: Record<string, string> = {}) => {
      const p = new URLSearchParams()
      const q = overrides.q !== undefined ? overrides.q : submittedQuery
      const t = overrides.type !== undefined ? overrides.type : type
      const y = overrides.year !== undefined ? overrides.year : year
      const s = overrides.sort !== undefined ? overrides.sort : sort
      const pg = overrides.page !== undefined ? overrides.page : String(page)
      const g = overrides.genre !== undefined ? overrides.genre : genreParam

      if (q.trim()) p.set('q', q.trim())
      if (t !== 'multi') p.set('type', t)
      if (g) p.set('genre', g)
      if (y !== 'ALL') p.set('year', y)
      if (s !== 'popularity.desc') p.set('sort_by', s)
      if (pg !== '1') p.set('page', pg)
      setSearchParams(p, { replace: true })
    },
    [submittedQuery, type, year, sort, page, genreParam, setSearchParams]
  )

  const handleSearch = useCallback(() => {
    hideVirtualKeyboard()
    setPage(1)
    setSubmittedQuery(query)
    writeParams({ q: query, page: '1' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [query, writeParams])

  const handlePageChange = useCallback(
    (newPage: number) => {
      setPage(newPage)
      writeParams({ page: String(newPage) })
      if (resultsRef.current) {
        const y = resultsRef.current.getBoundingClientRect().top + window.scrollY - 100
        window.scrollTo({ top: y, behavior: 'smooth' })
      }
    },
    [writeParams]
  )

  const handleGenreClick = useCallback((genreId: string) => {
    setGenreState((prev) => {
      const current = prev[genreId]
      const newState = { ...prev }
      if (current === 'include') {
        newState[genreId] = 'exclude'
      } else if (current === 'exclude') {
        delete newState[genreId]
      } else {
        newState[genreId] = 'include'
      }
      return newState
    })
    setPage(1)
  }, [])

  useEffect(() => {
    const included = Object.entries(genreState)
      .filter(([, s]) => s === 'include')
      .map(([g]) => g)
    const g = included.join(',')
    if (g !== genre) {
      setGenre(g)
      writeParams({ genre: g, page: '1' })
    }
  }, [genreState, genre, setGenre, writeParams])

  return (
    <div className="page-container">
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>Search TV & Movies</h1>
        <p className={styles.pageSubtitle}>
          Discover trending shows, movies, and more powered by TMDB
        </p>
      </div>

      <div className={styles.filterContainer}>
        <div className={styles.searchBarWrapper}>
          <div className={styles.inputIconWrapper}>
            <Icon name="search" className={styles.searchIcon} />
            <input
              type="text"
              data-virtual-keyboard="true"
              className={styles.searchInput}
              placeholder="Search titles..."
              value={query}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <div className={styles.searchActions}>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value)
                setGenreState({})
              }}
              className={styles.providerSelect}
              aria-label="Media type"
            >
              {typeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <Button onClick={handleSearch} className={styles.searchBtn}>
              Search
            </Button>
            <button
              className={`${styles.filterToggleBtn} ${showFilters ? styles.active : ''}`}
              onClick={() => setShowFilters(!showFilters)}
            >
              <Icon name="filter" size={14} />
              <span>Filters</span>
              {showFilters ? (
                <Icon name="chevron-up" size={12} />
              ) : (
                <Icon name="chevron-down" size={12} />
              )}
            </button>
          </div>
        </div>

        <div className={`${styles.advancedFilters} ${showFilters ? styles.show : ''}`}>
          <div className={styles.filterDivider} />
          <div className={styles.filterGrid}>
            <div className={styles.filterItem}>
              <label>Sort By</label>
              <select value={sort} onChange={(e) => setSort(e.currentTarget.value)}>
                {sortOptions.map((opt) => (
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

          {genreOptions.length > 0 && (
            <div className={styles.genreSection}>
              <label className={styles.genreLabel}>Genres</label>
              <div className={styles.genreContainer}>
                {genreOptions.map((g) => (
                  <button
                    key={g.id}
                    className={`${styles.genreButton} ${styles[genreState[g.id] || '']}`}
                    onClick={() => handleGenreClick(g.id)}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={styles.filterActions}>
            <Button
              variant="secondary"
              onClick={() => {
                setGenreState({})
                setYear('ALL')
                setSort('popularity.desc')
                setPage(1)
                writeParams({ genre: '', year: 'ALL', sort: 'popularity.desc', page: '1' })
              }}
            >
              Reset All
            </Button>
            <Button onClick={handleSearch} className={styles.searchBtn}>
              Apply Filters
            </Button>
          </div>
        </div>
      </div>

      {isError && <ErrorMessage message={error?.message || 'Search failed'} />}

      {Object.keys(genreState).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '1.5rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            Active Filters:
          </span>
          {Object.entries(genreState).map(([genreId, state]) => {
            const genreName = genreOptions.find((g) => g.id === genreId)?.name || genreId
            return (
              <span
                key={genreId}
                className={`badge ${state === 'include' ? 'badge-primary' : 'badge-danger'}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                {state === 'include' ? `+ ${genreName}` : `- ${genreName}`}
                <button
                  onClick={() => {
                    const copy = { ...genreState }
                    delete copy[genreId]
                    setGenreState(copy)
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
            )
          })}
        </div>
      )}

      <div className={styles.resultsHeader} ref={resultsRef}>
        <h2 className={styles.resultsTitle}>
          {submittedQuery
            ? `Results for "${submittedQuery}"`
            : genreParam
              ? `Browsing genres`
              : type === 'tv'
                ? 'Popular TV Shows'
                : type === 'movie'
                  ? 'Popular Movies'
                  : 'Trending'}
          {totalResults > 0 && (
            <span
              style={{
                fontWeight: 400,
                color: 'var(--text-tertiary)',
                fontSize: '0.85em',
                marginLeft: '0.5em',
              }}
            >
              ({totalResults.toLocaleString()})
            </span>
          )}
        </h2>

        {results.length > 0 && (
          <div className={styles.pagination}>
            <button
              className={styles.pageBtn}
              onClick={() => handlePageChange(page - 1)}
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
              onClick={() => handlePageChange(page + 1)}
              disabled={!canGoNext || isLoading}
              aria-label="Next page"
            >
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
        )}
      </div>

      <div className={`${styles.resultsGrid} ${lowEndMode ? styles.lowEnd : ''}`}>
        {isLoading ? (
          <SkeletonGrid />
        ) : (
          results.map((item) => (
            <TvCard
              key={`${item.type}-${item.id}`}
              item={{
                id: item.id,
                title: item.title,
                year: item.year,
                type: item.type,
                image: item.image,
                vote_average: item.vote_average,
                adult: item.adult,
              }}
            />
          ))
        )}
      </div>

      {!isLoading && results.length === 0 && (
        <div className={styles.noResults}>
          <Icon name="search" size={48} className={styles.noResultsIcon} />
          <h3>No results found</h3>
          <p>Try adjusting your search or filters to find what you&apos;re looking for.</p>
        </div>
      )}

      {results.length > 0 && (
        <div className={styles.bottomPagination}>
          <div className={styles.pagination}>
            <button
              className={styles.pageBtn}
              onClick={() => handlePageChange(page - 1)}
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
              onClick={() => handlePageChange(page + 1)}
              disabled={!canGoNext || isLoading}
            >
              <span>Next</span>
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
