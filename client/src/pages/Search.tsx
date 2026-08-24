import React, { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'
import {
  FaSearch,
  FaFilter,
  FaChevronDown,
  FaChevronUp,
  FaChevronLeft,
  FaChevronRight,
} from 'react-icons/fa'
import AnimeCard from '../components/anime/AnimeCard'
import SkeletonGrid from '../components/common/SkeletonGrid'
import { Button } from '../components/common/Button'
import ErrorMessage from '../components/common/ErrorMessage'
import { usePaginatedSearchAnime, useGenresAndStudios } from '../hooks/useAnimeData'
import { useLowEndMode } from '../contexts/LowEndModeContext'
import { hideVirtualKeyboard } from '../hooks/useVirtualKeyboard'
import styles from './Search.module.css'

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
  { value: 'ADULT', label: 'Mature' },
]

const seasonOptions: Option[] = [
  { value: 'ALL', label: 'All Seasons' },
  { value: 'Winter', label: 'Winter' },
  { value: 'Spring', label: 'Spring' },
  { value: 'Summer', label: 'Summer' },
  { value: 'Fall', label: 'Fall' },
]

const countryOptions: Option[] = [
  { value: 'ALL', label: 'All Countries' },
  { value: 'JP', label: 'Japan' },
  { value: 'CN', label: 'China' },
]

const sortOptions: Option[] = [
  { value: 'POPULARITY_DESC', label: 'Popularity' },
  { value: 'TRENDING_DESC', label: 'Trending' },
  { value: 'SCORE_DESC', label: 'Score' },
  { value: 'START_DATE_DESC', label: 'Newest' },
  { value: 'START_DATE_ASC', label: 'Oldest' },
  { value: 'EPISODES_DESC', label: 'Most Episodes' },
  { value: 'FAVOURITES_DESC', label: 'Favourites' },
]

const anilistStatusOptions: Option[] = [
  { value: 'RELEASING', label: 'Currently Airing' },
  { value: 'FINISHED', label: 'Finished' },
  { value: 'NOT_YET_RELEASED', label: 'Not Yet Released' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'HIATUS', label: 'Hiatus' },
]

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('query') || '')
  const [page, setPage] = useState(parseInt(searchParams.get('page') || '1'))

  const [type, setType] = useState(searchParams.get('type') || 'ALL')
  const [season, setSeason] = useState(searchParams.get('season') || 'ALL')
  const [year, setYear] = useState(searchParams.get('year') || 'ALL')
  const [country, setCountry] = useState(searchParams.get('country') || 'ALL')
  const [provider, setProvider] = useState(searchParams.get('provider') || 'anilist')
  const [sort, setSort] = useState(searchParams.get('sortBy') || 'POPULARITY_DESC')
  const [status, setStatus] = useState(searchParams.get('status') || '')
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    if (type === 'TV_SHORT') {
      setType('ALL')
    }
  }, [type])
  const { lowEndMode } = useLowEndMode()
  const resultsRef = useRef<HTMLDivElement>(null)

  const { data: metaData } = useGenresAndStudios()
  const availableGenres = metaData?.genres || []

  const [anilistGenreState, setAnilistGenreState] = useState<{
    [key: string]: 'include' | 'exclude'
  }>(() => {
    const states: { [key: string]: 'include' | 'exclude' } = {}
    const genres = searchParams.get('genres')?.split(',') || []
    const exclude = searchParams.get('excludeGenres')?.split(',') || []
    genres.forEach((g) => g && (states[g] = 'include'))
    exclude.forEach((g) => g && (states[g] = 'exclude'))
    return states
  })

  // We only pass filters that are NOT 'page' to usePaginatedSearchAnime
  const filterParams = new URLSearchParams(searchParams)
  filterParams.delete('page')
  const filterString = filterParams.toString()

  const {
    data: results = [],
    isLoading,
    isError,
    error,
  } = usePaginatedSearchAnime(filterString, page, 14)

  const { data: nextPageData } = usePaginatedSearchAnime(filterString, page + 1, 14)

  const [showMature, setShowMature] = useState(false)

  const filteredResults = React.useMemo(() => {
    if (provider === 'anilist' && type === 'ADULT') return results
    if (showMature) return results
    return results.filter((anime) => {
      const isAdult =
        anime.isAdult ||
        anime.rating === 'R+' ||
        anime.rating === 'Rx' ||
        anime.rating?.includes('17+')
      return !isAdult
    })
  }, [results, showMature, provider, type])

  useEffect(() => {
    setQuery(searchParams.get('query') || '')
    setType(searchParams.get('type') || 'ALL')
    setSeason(searchParams.get('season') || 'ALL')
    setYear(searchParams.get('year') || 'ALL')
    setCountry(searchParams.get('country') || 'ALL')
    setProvider(searchParams.get('provider') || 'anilist')
    setSort(searchParams.get('sortBy') || 'POPULARITY_DESC')
    setStatus(searchParams.get('status') || '')
    setPage(parseInt(searchParams.get('page') || '1'))

    const states: { [key: string]: 'include' | 'exclude' } = {}
    const genres = searchParams.get('genres')?.split(',') || []
    const exclude = searchParams.get('excludeGenres')?.split(',') || []
    genres.forEach((g) => g && (states[g] = 'include'))
    exclude.forEach((g) => g && (states[g] = 'exclude'))
    setAnilistGenreState(states)
  }, [searchParams])

  const handleSearch = (newPage = 1) => {
    hideVirtualKeyboard()

    const params = new URLSearchParams()
    if (query.trim()) params.set('query', query.trim())

    if (type !== 'ALL') params.set('type', type)
    if (status) params.set('status', status)
    if (season !== 'ALL') params.set('season', season)
    if (year !== 'ALL') params.set('year', year)
    if (country !== 'ALL') params.set('country', country)
    if (sort !== 'POPULARITY_DESC') params.set('sortBy', sort)

    const anilistGenres = Object.entries(anilistGenreState)
      .filter(([, s]) => s === 'include')
      .map(([g]) => g)
    const anilistExclude = Object.entries(anilistGenreState)
      .filter(([, s]) => s === 'exclude')
      .map(([g]) => g)

    if (anilistGenres.length > 0) params.set('genres', anilistGenres.join(','))
    if (anilistExclude.length > 0) params.set('excludeGenres', anilistExclude.join(','))
    if (type !== 'ADULT' && !showMature) params.set('adult', 'false')

    params.set('provider', 'anilist')

    if (newPage > 1) params.set('page', newPage.toString())

    setSearchParams(params)
    if (newPage !== page) {
      setPage(newPage)
    }
  }

  const handlePageChange = (newPage: number) => {
    handleSearch(newPage)
    if (resultsRef.current) {
      const y = resultsRef.current.getBoundingClientRect().top + window.scrollY - 100
      window.scrollTo({ top: y, behavior: 'smooth' })
    }
  }

  const currentYear = new Date().getFullYear()
  const yearOptions: Option[] = [
    { value: 'ALL', label: 'All Years' },
    ...Array.from({ length: currentYear - 1980 + 1 }, (_, i) => ({
      value: String(currentYear - i),
      label: String(currentYear - i),
    })),
  ]

  const canGoNext = results.length >= 14 && nextPageData && nextPageData.length > 0

  return (
    <div className="page-container">
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>Search Anime</h1>
        <p className={styles.pageSubtitle}>
          Search through thousands of titles and discover your next favorite
        </p>
      </div>

      <div className={styles.filterContainer}>
        <div className={styles.searchBarWrapper}>
          <div className={styles.inputIconWrapper}>
            <FaSearch className={styles.searchIcon} />
            <input
              type="text"
              data-virtual-keyboard="true"
              className={styles.searchInput}
              placeholder="Search by title, character, or studio..."
              value={query}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <div className={styles.searchActions}>
            <Button onClick={() => handleSearch()} className={styles.searchBtn}>
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
              <label>Status</label>
              <select value={status} onChange={(e) => setStatus(e.currentTarget.value)}>
                <option value="">All Status</option>
                {anilistStatusOptions.map((opt) => (
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
            <div className={styles.filterItem}>
              <label>Country</label>
              <select value={country} onChange={(e) => setCountry(e.currentTarget.value)}>
                {countryOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
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
          </div>

          {availableGenres.length > 0 && (
            <div className={styles.genreSection}>
              <label className={styles.genreLabel}>Genres</label>
              <div className={styles.genreContainer}>
                {availableGenres.map((g) => (
                  <button
                    key={g}
                    className={`${styles.genreButton} ${styles[anilistGenreState[g] || '']}`}
                    onClick={() => {
                      setAnilistGenreState((prev) => {
                        const current = prev[g]
                        const newState = { ...prev }
                        if (current === 'include') {
                          newState[g] = 'exclude'
                        } else if (current === 'exclude') {
                          delete newState[g]
                        } else {
                          newState[g] = 'include'
                        }
                        return newState
                      })
                    }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={styles.filterActions}>
            <Button
              variant="secondary"
              onClick={() => {
                setAnilistGenreState({})
                setType('ALL')
                setSeason('ALL')
                setYear('ALL')
                setCountry('ALL')
                setSort('POPULARITY_DESC')
                setStatus('')
                setShowMature(false)
              }}
            >
              Reset All
            </Button>
            <Button onClick={() => handleSearch()} className={styles.applyBtn}>
              Apply Filters
            </Button>
          </div>
        </div>
      </div>

      {isError && <ErrorMessage message={error?.message || 'Error'} />}

      {(type !== 'ALL' ||
        season !== 'ALL' ||
        year !== 'ALL' ||
        Object.keys(anilistGenreState).length > 0) && (
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
                  handleSearch()
                }}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
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
                  handleSearch()
                }}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
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
                  handleSearch()
                }}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
              >
                ✕
              </button>
            </span>
          )}

          {Object.entries(anilistGenreState).map(([genre, state]) => (
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
                  setAnilistGenreState((prev) => {
                    const copy = { ...prev }
                    delete copy[genre]
                    return copy
                  })
                  handleSearch()
                }}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className={styles.resultsHeader} ref={resultsRef}>
        <h2 className={styles.resultsTitle}>
          {query ? `Search Results for "${query}"` : 'Discover Anime'}
        </h2>

        {filteredResults.length > 0 && (
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

      <div className={`${styles.resultsGrid} ${lowEndMode ? styles.lowEnd : ''}`}>
        {isLoading ? (
          <SkeletonGrid />
        ) : (
          filteredResults.map((anime) => <AnimeCard key={anime._id} anime={anime} />)
        )}
      </div>

      {!isLoading && filteredResults.length === 0 && (
        <div className={styles.noResults}>
          <FaSearch size={48} className={styles.noResultsIcon} />
          <h3>No results found</h3>
          <p>Try adjusting your search or filters to find what you're looking for.</p>
        </div>
      )}

      {filteredResults.length > 0 && (
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
    </div>
  )
}
