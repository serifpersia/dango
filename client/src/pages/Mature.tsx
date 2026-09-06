import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FaSearch, FaFilter, FaChevronLeft, FaChevronRight } from 'react-icons/fa'
import AnimeCard from '../components/anime/AnimeCard'
import SkeletonGrid from '../components/common/SkeletonGrid'
import GenericModal from '../components/common/GenericModal'
import { Button } from '../components/common/Button'
import ErrorMessage from '../components/common/ErrorMessage'
import { useMatureConsent } from '../hooks/useMatureConsent'
import { fetchApi } from '../lib/fetchApi'
import { hideVirtualKeyboard } from '../hooks/useVirtualKeyboard'
import styles from './Search.module.css'
import matureStyles from './Mature.module.css'

interface MatureShow {
  _id: string
  id?: string
  name: string
  nativeName?: string
  englishName?: string
  thumbnail: string
  type?: string
  year?: number | null
  isAdult?: boolean
}

interface MatureSearchResponse {
  data: MatureShow[]
  hasMore: boolean
  total?: number
  genres?: { slug: string; name: string }[]
}

interface MatureFilters {
  whGenres: string[]
  opTags: string[]
  opOrders: string[]
  htGenres: string[]
}

const providerOptions = [
  { value: 'anilist', label: 'AniList' },
  { value: 'wh', label: 'WH' },
  { value: 'op', label: 'OP' },
  { value: 'ht', label: 'HT' },
  { value: 'hn', label: 'HN' },
]

const sortOptions = [
  { value: 'POPULARITY_DESC', label: 'Popularity' },
  { value: 'TRENDING_DESC', label: 'Trending' },
  { value: 'SCORE_DESC', label: 'Score' },
  { value: 'START_DATE_DESC', label: 'Newest' },
  { value: 'FAVOURITES_DESC', label: 'Favourites' },
]

const statusOptions = [
  { value: '', label: 'All Status' },
  { value: 'RELEASING', label: 'Currently Airing' },
  { value: 'FINISHED', label: 'Finished' },
  { value: 'NOT_YET_RELEASED', label: 'Not Yet Released' },
]

const hnSortOptions = [
  { value: '', label: 'Relevance' },
  { value: 'visits:desc', label: 'Most Visited' },
  { value: 'title:asc', label: 'Title A-Z' },
]

const opOrderLabels: Record<string, string> = {
  recent: 'Latest',
  popular: 'Popular',
  views: 'Most Viewed',
  rating: 'Top Rated',
  random: 'Random',
}

const seasonOptions = [
  { value: 'ALL', label: 'All Seasons' },
  { value: 'Winter', label: 'Winter' },
  { value: 'Spring', label: 'Spring' },
  { value: 'Summer', label: 'Summer' },
  { value: 'Fall', label: 'Fall' },
]

const providerLimit = (provider: string) => {
  if (provider === 'op') return 24
  return 14
}

const prettyLabel = (slug: string) =>
  slug
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')

export default function Mature() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { hasConsent, grant } = useMatureConsent()

  useEffect(() => {
    document.title = 'Mature - dango'
  }, [])

  const [provider, setProvider] = useState(searchParams.get('provider') || 'anilist')
  const [query, setQuery] = useState(searchParams.get('query') || '')
  const [submittedQuery, setSubmittedQuery] = useState(searchParams.get('query') || '')
  const [page, setPage] = useState(parseInt(searchParams.get('page') || '1', 10) || 1)
  const [sort, setSort] = useState(searchParams.get('sortBy') || 'POPULARITY_DESC')
  const [hnSort, setHnSort] = useState(
    (searchParams.get('provider') === 'hn' && searchParams.get('sortBy')) || ''
  )
  const [status, setStatus] = useState(searchParams.get('status') || '')
  const [season, setSeason] = useState(searchParams.get('season') || 'ALL')
  const [year, setYear] = useState(searchParams.get('year') || 'ALL')
  const [genre, setGenre] = useState(searchParams.get('genre') || '')
  const [opOrder, setOpOrder] = useState(searchParams.get('order') || 'recent')
  const [opStudio, setOpStudio] = useState(searchParams.get('studio') || '')
  const [submittedOpStudio, setSubmittedOpStudio] = useState(searchParams.get('studio') || '')
  const [hnGenres, setHnGenres] = useState<{ slug: string; name: string }[]>([])
  const [showFilters, setShowFilters] = useState(false)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const limit = providerLimit(provider)

  interface UrlSnapshot {
    provider: string
    query: string
    page: number
    sort: string
    hnSort: string
    status: string
    season: string
    year: string
    genre: string
    opOrder: string
    opStudio: string
  }

  const writeParams = (s: UrlSnapshot) => {
    const p = new URLSearchParams()
    if (s.provider !== 'anilist') p.set('provider', s.provider)
    if (s.query.trim()) p.set('query', s.query.trim())
    if (s.page > 1) p.set('page', String(s.page))
    if (s.provider === 'anilist') {
      if (s.sort !== 'POPULARITY_DESC') p.set('sortBy', s.sort)
      if (s.status) p.set('status', s.status)
      if (s.season !== 'ALL') p.set('season', s.season)
      if (s.year !== 'ALL') p.set('year', s.year)
    }
    if (s.provider === 'hn' && s.hnSort) p.set('sortBy', s.hnSort)
    if (s.provider === 'wh' || s.provider === 'ht' || s.provider === 'hn') {
      if (s.genre) p.set('genre', s.genre)
    }
    if (s.provider === 'op') {
      if (s.opOrder !== 'recent') p.set('order', s.opOrder)
      if (s.genre) p.set('genres', s.genre)
      if (s.opStudio.trim()) p.set('studio', s.opStudio.trim())
    }
    setSearchParams(p, { replace: true })
  }

  const snapshot = (over: Partial<UrlSnapshot> = {}): UrlSnapshot => ({
    provider,
    query: submittedQuery,
    page,
    sort,
    hnSort,
    status,
    season,
    year,
    genre,
    opOrder,
    opStudio: submittedOpStudio,
    ...over,
  })

  const { data: filters } = useQuery<MatureFilters>({
    queryKey: ['mature-filters'],
    queryFn: () => fetchApi('/api/mature/filters'),
    enabled: hasConsent,
    staleTime: Infinity,
  })

  const buildParams = () => {
    const params = new URLSearchParams()
    params.set('provider', provider)
    if (submittedQuery.trim()) params.set('query', submittedQuery.trim())
    params.set('page', String(page))
    params.set('limit', String(limit))
    if (provider === 'anilist') {
      params.set('sortBy', sort)
      if (status) params.set('status', status)
      if (season !== 'ALL') params.set('season', season)
      if (year !== 'ALL') params.set('year', year)
    }
    if (provider === 'hn' && hnSort) params.set('sortBy', hnSort)
    if ((provider === 'wh' || provider === 'ht' || provider === 'hn') && genre) {
      params.set('genre', genre)
    }
    if (provider === 'op') {
      params.set('order', opOrder)
      if (genre) params.set('genres', genre)
      if (submittedOpStudio.trim()) params.set('studio', submittedOpStudio.trim())
    }
    return params.toString()
  }

  const paramString = buildParams()

  const {
    data: response,
    isLoading,
    isError,
    error,
  } = useQuery<MatureSearchResponse>({
    queryKey: ['mature-search', paramString],
    queryFn: () => fetchApi(`/api/mature/search?${paramString}`),
    enabled: hasConsent,
  })

  useEffect(() => {
    const facets = response?.genres
    if (provider === 'hn' && facets && facets.length > 0) {
      setHnGenres((prev) => {
        const seen = new Set(prev.map((g) => g.slug))
        const next = [...prev]
        for (const g of facets) {
          if (g.slug && !seen.has(g.slug)) {
            seen.add(g.slug)
            next.push(g)
          }
        }
        return next.length === prev.length ? prev : next
      })
    }
  }, [response, provider])

  const results = (response?.data || []).map((s) => ({ ...s, isAdult: true }))
  const hasMore = response?.hasMore ?? false

  const handleSearch = () => {
    hideVirtualKeyboard()
    setPage(1)
    let nextGenre = genre
    if (provider === 'wh' || provider === 'ht' || provider === 'hn') {
      if (query.trim()) nextGenre = ''
    }
    setGenre(nextGenre)
    if (provider === 'op') setSubmittedOpStudio(opStudio)
    setSubmittedQuery(query)
    writeParams(
      snapshot({
        query,
        page: 1,
        genre: nextGenre,
        opStudio: provider === 'op' ? opStudio : submittedOpStudio,
      })
    )
  }

  const handleProviderChange = (value: string) => {
    setProvider(value)
    setPage(1)
    setHnSort('')
    setGenre('')
    setSubmittedQuery(query)
    writeParams(snapshot({ provider: value, page: 1, hnSort: '', genre: '', query }))
  }

  const handleGenreChange = (value: string) => {
    setGenre(value)
    setPage(1)
    if (value) {
      setQuery('')
      setSubmittedQuery('')
    }
    writeParams(snapshot({ genre: value, page: 1, query: value ? '' : submittedQuery }))
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    writeParams(snapshot({ page: newPage }))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleCardClick = async (e: React.MouseEvent, show: MatureShow) => {
    const id = show.id || show._id
    if (/^\d+$/.test(id)) return
    e.preventDefault()
    e.stopPropagation()
    if (resolvingId) return
    setResolvingId(id)
    try {
      const data = (await fetchApi(
        `/api/mature/resolve?title=${encodeURIComponent(show.name)}`
      )) as { id: number }
      navigate(`/anime/${data.id}`)
    } catch {
      toast.error('Could not match this title on AniList')
    } finally {
      setResolvingId(null)
    }
  }

  const currentYear = new Date().getFullYear()
  const yearOptions = [
    { value: 'ALL', label: 'All Years' },
    ...Array.from({ length: currentYear - 1980 + 1 }, (_, i) => ({
      value: String(currentYear - i),
      label: String(currentYear - i),
    })),
  ]

  const genreOptions =
    provider === 'wh'
      ? (filters?.whGenres || []).map((g) => ({ value: g, label: prettyLabel(g) }))
      : provider === 'ht'
        ? (filters?.htGenres || []).map((g) => ({ value: g, label: prettyLabel(g) }))
        : provider === 'hn'
          ? hnGenres.map((g) => ({ value: g.slug, label: g.name }))
          : []

  if (!hasConsent) {
    return (
      <GenericModal isOpen title="Content Warning" onClose={() => navigate('/home')}>
        <p>This section contains mature 18+ content. Please confirm you are of legal age.</p>
        <Button onClick={grant}>I&apos;m 18+, Continue</Button>
      </GenericModal>
    )
  }

  return (
    <div className="page-container">
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>Mature</h1>
        <p className={styles.pageSubtitle}>
          Browse 18+ titles across AniList and streaming providers
        </p>
      </div>

      <div className={styles.filterContainer}>
        <div className={styles.searchBarWrapper}>
          <div className={styles.inputIconWrapper}>
            <FaSearch className={styles.searchIcon} />
            <input
              type="text"
              placeholder={`Search ${providerOptions.find((p) => p.value === provider)?.label}...`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch()
              }}
              className={styles.searchInput}
            />
          </div>
          <div className={styles.searchActions}>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className={styles.providerSelect}
              aria-label="Provider"
            >
              {providerOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <Button onClick={handleSearch} className={styles.searchBtn}>
              Search
            </Button>
            {provider === 'anilist' && (
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`${styles.filterToggleBtn} ${showFilters ? styles.active : ''}`}
              >
                <FaFilter /> Filters
              </button>
            )}
            {provider === 'hn' && (
              <select
                value={hnSort}
                onChange={(e) => {
                  setHnSort(e.target.value)
                  setPage(1)
                  writeParams(snapshot({ hnSort: e.target.value, page: 1 }))
                }}
                className={styles.providerSelect}
                aria-label="Sort"
              >
                {hnSortOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {provider === 'anilist' && (
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
                <label>Status</label>
                <select value={status} onChange={(e) => setStatus(e.currentTarget.value)}>
                  {statusOptions.map((opt) => (
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
            <div className={styles.filterActions}>
              <Button onClick={handleSearch} className={styles.searchBtn}>
                Apply Filters
              </Button>
            </div>
          </div>
        )}

        {(provider === 'wh' || provider === 'ht' || provider === 'hn') && (
          <div className={`${styles.advancedFilters} ${styles.show}`}>
            <div className={styles.filterDivider} />
            <div className={`${styles.filterGrid} ${matureStyles.tightGrid}`}>
              <div className={`${styles.filterItem} ${matureStyles.shrinkSelect}`}>
                <label>Genre</label>
                <select value={genre} onChange={(e) => handleGenreChange(e.target.value)}>
                  <option value="">All Genres</option>
                  {genreOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {genre && (
              <p className={styles.pageSubtitle}>
                Browsing the {prettyLabel(genre)} genre — search text is ignored while a genre is
                selected.
              </p>
            )}
          </div>
        )}

        {provider === 'op' && (
          <div className={`${styles.advancedFilters} ${styles.show}`}>
            <div className={styles.filterDivider} />
            <div className={`${styles.filterGrid} ${matureStyles.tightGrid}`}>
              <div className={`${styles.filterItem} ${matureStyles.shrinkSelect}`}>
                <label>Order</label>
                <select
                  value={opOrder}
                  onChange={(e) => {
                    setOpOrder(e.target.value)
                    setPage(1)
                    writeParams(snapshot({ opOrder: e.target.value, page: 1 }))
                  }}
                >
                  {(filters?.opOrders || ['recent']).map((o) => (
                    <option key={o} value={o}>
                      {opOrderLabels[o] || o}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`${styles.filterItem} ${matureStyles.shrinkSelect}`}>
                <label>Genre</label>
                <select
                  value={genre}
                  onChange={(e) => {
                    setGenre(e.target.value)
                    setPage(1)
                    writeParams(snapshot({ genre: e.target.value, page: 1 }))
                  }}
                >
                  <option value="">All Genres</option>
                  {(filters?.opTags || []).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.filterItem}>
                <label>Studio</label>
                <input
                  type="text"
                  placeholder="Studio name..."
                  value={opStudio}
                  onChange={(e) => setOpStudio(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearch()
                  }}
                  className={styles.searchInput}
                />
              </div>
            </div>
            <div className={styles.filterActions}>
              <Button onClick={handleSearch} className={styles.searchBtn}>
                Apply Filters
              </Button>
            </div>
          </div>
        )}
      </div>

      {isError && <ErrorMessage message={(error as Error)?.message || 'Search failed'} />}

      {isLoading ? (
        <SkeletonGrid count={limit} />
      ) : results.length === 0 ? (
        <div className={styles.noResults}>
          <h3>No results found</h3>
          <p>Try a different query, genre or provider</p>
        </div>
      ) : (
        <>
          <div className={styles.resultsHeader}>
            <h2 className={styles.resultsTitle}>
              {response?.total ?? results.length} result
              {(response?.total ?? results.length) === 1 ? '' : 's'}
            </h2>
            <div className={styles.pagination}>
              <button
                className={styles.pageBtn}
                disabled={page <= 1}
                onClick={() => handlePageChange(page - 1)}
              >
                <FaChevronLeft /> <span>Prev</span>
              </button>
              <span className={styles.pageInfo}>
                Page <strong>{page}</strong>
              </span>
              <button
                className={styles.pageBtn}
                disabled={!hasMore}
                onClick={() => handlePageChange(page + 1)}
              >
                <span>Next</span> <FaChevronRight />
              </button>
            </div>
          </div>
          <div className={styles.resultsGrid}>
            {results.map((show) => (
              <div key={`${provider}-${show._id}`} onClickCapture={(e) => handleCardClick(e, show)}>
                <AnimeCard anime={show} />
              </div>
            ))}
          </div>
          <div className={styles.bottomPagination}>
            <div className={styles.pagination}>
              <button
                className={styles.pageBtn}
                disabled={page <= 1}
                onClick={() => handlePageChange(page - 1)}
              >
                <FaChevronLeft /> <span>Prev</span>
              </button>
              <span className={styles.pageInfo}>
                Page <strong>{page}</strong>
              </span>
              <button
                className={styles.pageBtn}
                disabled={!hasMore}
                onClick={() => handlePageChange(page + 1)}
              >
                <span>Next</span> <FaChevronRight />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
