import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import Icon from '../components/common/Icon'
import AnimeCard from '../components/anime/AnimeCard'
import SkeletonGrid from '../components/common/SkeletonGrid'
import MatureConsentModal from '../components/common/MatureConsentModal'
import { Button } from '../components/common/Button'
import ErrorMessage from '../components/common/ErrorMessage'
import { useMatureConsent } from '../hooks/useMatureConsent'
import { useProviders } from '../hooks/useProviders'
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

interface MatureProviderCaps {
  genre?: boolean
  order?: boolean
  studio?: boolean
  sort?: boolean
  pageSize?: number
}

interface MatureProviderFilters {
  label: string
  browse?: MatureProviderCaps
  genres?: string[]
  orders?: string[]
}

interface MatureFiltersResponse {
  providers: Record<string, MatureProviderFilters>
}

const META_PROVIDER_OPTIONS = [
  { value: 'anilist', label: 'AniList' },
  { value: 'mal', label: 'MAL' },
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

const remoteSortOptions = [
  { value: '', label: 'Relevance' },
  { value: 'visits:desc', label: 'Most Visited' },
  { value: 'title:asc', label: 'Title A-Z' },
]

const orderLabels: Record<string, string> = {
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
  const [sort, setSort] = useState(() => {
    const urlSort = searchParams.get('sortBy')
    if (urlSort) return urlSort
    return provider === 'mal' ? 'SCORE_DESC' : 'POPULARITY_DESC'
  })
  const [remoteSort, setRemoteSort] = useState(searchParams.get('sortBy') || '')
  const [status, setStatus] = useState(searchParams.get('status') || '')
  const [season, setSeason] = useState(searchParams.get('season') || 'ALL')
  const [year, setYear] = useState(searchParams.get('year') || 'ALL')
  const [genre, setGenre] = useState(searchParams.get('genre') || searchParams.get('genres') || '')
  const [remoteOrder, setRemoteOrder] = useState(searchParams.get('order') || 'recent')
  const [studio, setStudio] = useState(searchParams.get('studio') || '')
  const [submittedStudio, setSubmittedStudio] = useState(searchParams.get('studio') || '')
  const [dynamicGenres, setDynamicGenres] = useState<{ slug: string; name: string }[]>([])
  const [showFilters, setShowFilters] = useState(false)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const { options: allProviderOptions } = useProviders()
  const matureStreamingOptions = useMemo(
    () => allProviderOptions.filter((o) => o.mature && (o.kind ?? 'anime') === 'anime'),
    [allProviderOptions]
  )
  const providerOptions = useMemo(
    () => [
      ...META_PROVIDER_OPTIONS,
      ...matureStreamingOptions.map((o) => ({ value: o.value, label: o.label })),
    ],
    [matureStreamingOptions]
  )

  const { data: filters } = useQuery<MatureFiltersResponse>({
    queryKey: ['mature-filters'],
    queryFn: () => fetchApi('/api/mature/filters'),
    enabled: hasConsent,
    staleTime: Infinity,
  })

  const isMetaProvider = provider === 'anilist' || provider === 'mal'
  const streamingFilters = isMetaProvider ? undefined : filters?.providers?.[provider]
  const caps = streamingFilters?.browse
  const staticGenres = streamingFilters?.genres ?? []
  const staticOrders = streamingFilters?.orders ?? []
  const effectiveOrder =
    staticOrders.length > 0 && !staticOrders.includes(remoteOrder) ? staticOrders[0] : remoteOrder
  const genreSupported =
    !isMetaProvider && (caps?.genre === true || staticGenres.length > 0 || dynamicGenres.length > 0)
  const orderSupported = !isMetaProvider && (caps?.order === true || staticOrders.length > 0)
  const studioSupported = !isMetaProvider && caps?.studio === true
  const remoteSortSupported = !isMetaProvider && caps?.sort === true

  const limit = isMetaProvider ? 14 : (caps?.pageSize ?? 14)

  interface UrlSnapshot {
    provider: string
    query: string
    page: number
    sort: string
    remoteSort: string
    status: string
    season: string
    year: string
    genre: string
    remoteOrder: string
    studio: string
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
    } else if (s.provider === 'mal') {
      if (s.sort !== 'SCORE_DESC') p.set('sortBy', s.sort)
      if (s.status) p.set('status', s.status)
    } else {
      const c = filters?.providers?.[s.provider]?.browse
      const orders = filters?.providers?.[s.provider]?.orders ?? []
      const order = orders.length > 0 && !orders.includes(s.remoteOrder) ? orders[0] : s.remoteOrder
      if ((!c || c.sort) && s.remoteSort) p.set('sortBy', s.remoteSort)
      if ((!c || c.genre) && s.genre) p.set('genre', s.genre)
      if ((!c || c.order) && order !== (orders[0] ?? 'recent')) p.set('order', order)
      if ((!c || c.studio) && s.studio.trim()) p.set('studio', s.studio.trim())
    }
    setSearchParams(p, { replace: true })
  }

  const snapshot = (over: Partial<UrlSnapshot> = {}): UrlSnapshot => ({
    provider,
    query: submittedQuery,
    page,
    sort,
    remoteSort,
    status,
    season,
    year,
    genre,
    remoteOrder,
    studio: submittedStudio,
    ...over,
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
    if (provider === 'mal') {
      params.set('sortBy', sort)
      if (status) params.set('status', status)
    } else if (!isMetaProvider) {
      if (genreSupported && genre) params.set('genre', genre)
      if (orderSupported) params.set('order', effectiveOrder)
      if (remoteSortSupported && remoteSort) params.set('sortBy', remoteSort)
      if (studioSupported && submittedStudio.trim()) params.set('studio', submittedStudio.trim())
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
    if (!isMetaProvider && staticGenres.length === 0 && facets && facets.length > 0) {
      setDynamicGenres((prev) => {
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
  }, [response, provider, isMetaProvider, staticGenres.length])

  const results = (response?.data || []).map((s) => ({ ...s, isAdult: true }))
  const hasMore = response?.hasMore ?? false

  const handleSearch = () => {
    hideVirtualKeyboard()
    setPage(1)
    let nextGenre = genre
    if (!isMetaProvider && !orderSupported && query.trim()) nextGenre = ''
    setGenre(nextGenre)
    if (studioSupported) setSubmittedStudio(studio)
    setSubmittedQuery(query)
    writeParams(
      snapshot({
        query,
        page: 1,
        genre: nextGenre,
        studio: studioSupported ? studio : submittedStudio,
      })
    )
  }

  const handleProviderChange = (value: string) => {
    setProvider(value)
    setPage(1)
    setRemoteSort('')
    setGenre('')
    setDynamicGenres([])
    if (value === 'mal') {
      setSort('SCORE_DESC')
    } else if (value === 'anilist') {
      setSort('POPULARITY_DESC')
    }
    setSubmittedQuery(query)
    writeParams(snapshot({ provider: value, page: 1, remoteSort: '', genre: '', query }))
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
    if (provider === 'mal') return
    if (/^\d+$/.test(id)) return
    e.preventDefault()
    e.stopPropagation()
    if (resolvingId) return
    setResolvingId(id)
    try {
      if (provider !== 'anilist') {
        let anilistUp = false
        try {
          const st = (await fetchApi('/api/anilist-status')) as { available?: boolean }
          anilistUp = st?.available === true
        } catch {
          anilistUp = false
        }
        if (anilistUp) {
          const data = (await fetchApi(
            `/api/mature/resolve?title=${encodeURIComponent(show.name)}`
          )) as { id: number }
          navigate(`/anime/${data.id}`)
          return
        }
        const res = await fetch('/api/mature/allocate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider,
            nativeId: id,
            title: show.name,
            thumbnail: show.thumbnail,
          }),
        })
        const data = (await res.json().catch(() => null)) as { id?: string } | null
        if (!res.ok || !data?.id) throw new Error('Allocate failed')
        navigate(`/anime/${data.id}`)
        return
      }
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
    staticGenres.length > 0
      ? staticGenres.map((g) => ({ value: g, label: prettyLabel(g) }))
      : dynamicGenres.map((g) => ({ value: g.slug, label: g.name }))

  if (!hasConsent) {
    return <MatureConsentModal isOpen onClose={() => navigate('/')} onGrant={grant} />
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
            <Icon name="search" className={styles.searchIcon} />
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
            {isMetaProvider && (
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`${styles.filterToggleBtn} ${showFilters ? styles.active : ''}`}
              >
                <Icon name="filter" /> Filters
              </button>
            )}
            {remoteSortSupported && (
              <select
                value={remoteSort}
                onChange={(e) => {
                  setRemoteSort(e.target.value)
                  setPage(1)
                  writeParams(snapshot({ remoteSort: e.target.value, page: 1 }))
                }}
                className={styles.providerSelect}
                aria-label="Sort"
              >
                {remoteSortOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {(provider === 'anilist' || provider === 'mal') && (
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
              {provider === 'anilist' && (
                <>
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
                </>
              )}
            </div>
            <div className={styles.filterActions}>
              <Button onClick={handleSearch} className={styles.searchBtn}>
                Apply Filters
              </Button>
            </div>
          </div>
        )}

        {!isMetaProvider && !!filters && (genreSupported || orderSupported || studioSupported) && (
          <div className={`${styles.advancedFilters} ${styles.show}`}>
            <div className={styles.filterDivider} />
            <div className={`${styles.filterGrid} ${matureStyles.tightGrid}`}>
              {orderSupported && (
                <div className={`${styles.filterItem} ${matureStyles.shrinkSelect}`}>
                  <label>Order</label>
                  <select
                    value={effectiveOrder}
                    onChange={(e) => {
                      setRemoteOrder(e.target.value)
                      setPage(1)
                      writeParams(snapshot({ remoteOrder: e.target.value, page: 1 }))
                    }}
                  >
                    {(staticOrders.length > 0 ? staticOrders : ['recent']).map((o) => (
                      <option key={o} value={o}>
                        {orderLabels[o] || o}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {genreSupported && (
                <div className={`${styles.filterItem} ${matureStyles.shrinkSelect}`}>
                  <label>Genre</label>
                  <select
                    value={genre}
                    onChange={(e) => {
                      if (orderSupported) {
                        setGenre(e.target.value)
                        setPage(1)
                        writeParams(snapshot({ genre: e.target.value, page: 1 }))
                      } else {
                        handleGenreChange(e.target.value)
                      }
                    }}
                  >
                    <option value="">All Genres</option>
                    {genreOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {studioSupported && (
                <div className={styles.filterItem}>
                  <label>Studio</label>
                  <input
                    type="text"
                    placeholder="Studio name..."
                    value={studio}
                    onChange={(e) => setStudio(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSearch()
                    }}
                    className={styles.searchInput}
                  />
                </div>
              )}
            </div>
            {genre && genreSupported && !orderSupported && (
              <p className={styles.pageSubtitle}>
                Browsing the {prettyLabel(genre)} genre — search text is ignored while a genre is
                selected.
              </p>
            )}
            {(orderSupported || studioSupported) && (
              <div className={styles.filterActions}>
                <Button onClick={handleSearch} className={styles.searchBtn}>
                  Apply Filters
                </Button>
              </div>
            )}
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
                <Icon name="chevron-left" /> <span>Prev</span>
              </button>
              <span className={styles.pageInfo}>
                Page <strong>{page}</strong>
              </span>
              <button
                className={styles.pageBtn}
                disabled={!hasMore}
                onClick={() => handlePageChange(page + 1)}
              >
                <span>Next</span> <Icon name="chevron-right" />
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
                <Icon name="chevron-left" /> <span>Prev</span>
              </button>
              <span className={styles.pageInfo}>
                Page <strong>{page}</strong>
              </span>
              <button
                className={styles.pageBtn}
                disabled={!hasMore}
                onClick={() => handlePageChange(page + 1)}
              >
                <span>Next</span> <Icon name="chevron-right" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
