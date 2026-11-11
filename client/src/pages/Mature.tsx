import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import Icon from '../components/common/Icon'
import Pagination from '../components/common/Pagination'
import AnimeCard from '../components/anime/AnimeCard'
import SkeletonGrid from '../components/common/SkeletonGrid'
import MatureConsentModal from '../components/common/MatureConsentModal'
import AdultPlayerModal from '../components/anime/AdultPlayerModal'
import { Button } from '../components/common/Button'
import ErrorMessage from '../components/common/ErrorMessage'
import { useMatureConsent } from '../hooks/useMatureConsent'
import { useProviders } from '../hooks/useProviders'
import { trpcClient, useTRPC } from '../lib/trpc'
import { hideVirtualKeyboard } from '../hooks/useVirtualKeyboard'
import type { AnimeShow } from '../types/player'
import searchStyles from './Search.module.css'
import styles from './Mature.module.css'

type MatureShow = AnimeShow

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

const sortLabels: Record<string, string> = {
  released_at: 'Release date',
  published_at: 'Recent update',
  saved: 'Saved',
  today_views: 'Today views',
  weekly_views: 'Weekly views',
  monthly_views: 'Monthly views',
  views: 'Total views',
}

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

const MATURE_SEARCH_NUMBERS = new Set(['page', 'limit', 'year', 'minScore', 'minEpisodes'])

const MATURE_SEARCH_KEYS = new Set([
  'provider',
  'query',
  'page',
  'limit',
  'type',
  'status',
  'season',
  'year',
  'country',
  'genres',
  'genre',
  'excludeGenres',
  'sortBy',
  'order',
  'studio',
  'blacklist',
  'minScore',
  'minEpisodes',
])

type MatureSearchInput = {
  provider?: string
  query?: string
  page?: number
  limit?: number
  type?: string
  status?: string
  season?: string
  year?: number
  country?: string
  genres?: string
  genre?: string
  excludeGenres?: string
  sortBy?: string
  order?: string
  studio?: string
  blacklist?: string
  minScore?: number
  minEpisodes?: number
}

function parseMatureSearchInput(paramString: string): MatureSearchInput {
  const params = new URLSearchParams(paramString)
  const input: MatureSearchInput = {}
  for (const [key, value] of params.entries()) {
    if (!MATURE_SEARCH_KEYS.has(key)) continue
    if (MATURE_SEARCH_NUMBERS.has(key)) {
      ;(input as Record<string, string | number>)[key] = Number(value) || 0
    } else {
      ;(input as Record<string, string | number>)[key] = value
    }
  }
  return input
}

export default function Mature() {
  const navigate = useNavigate()
  const trpc = useTRPC()
  const [searchParams, setSearchParams] = useSearchParams()
  const { hasConsent, grant } = useMatureConsent()

  useEffect(() => {
    document.title = 'Mature - dango'
  }, [])

  const [category, setCategory] = useState<'hentai' | 'adult'>(
    searchParams.get('category') === 'adult' ? 'adult' : 'hentai'
  )
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
  const [adultPlayback, setAdultPlayback] = useState<{
    id: string
    name: string
    provider: string
  } | null>(null)
  const { options: allProviderOptions } = useProviders()
  const hentaiStreamingOptions = useMemo(
    () => allProviderOptions.filter((o) => o.mature && (o.kind ?? 'anime') === 'anime'),
    [allProviderOptions]
  )
  const adultStreamingOptions = useMemo(
    () => allProviderOptions.filter((o) => o.mature && o.kind === 'adult'),
    [allProviderOptions]
  )
  const providerOptions = useMemo(
    () =>
      category === 'adult'
        ? adultStreamingOptions.map((o) => ({ value: o.id, label: o.label }))
        : [
            ...META_PROVIDER_OPTIONS,
            ...hentaiStreamingOptions.map((o) => ({ value: o.id, label: o.label })),
          ],
    [category, adultStreamingOptions, hentaiStreamingOptions]
  )

  const { data: filters } = useQuery({
    ...trpc.data.matureFilters.queryOptions(),
    enabled: hasConsent,
    staleTime: Infinity,
  })

  useEffect(() => {
    if (providerOptions.length === 0) return
    if (providerOptions.some((o) => o.value === provider)) return
    setProvider(providerOptions[0].value)
    setPage(1)
  }, [providerOptions, provider])

  const isMetaProvider = category === 'hentai' && (provider === 'anilist' || provider === 'mal')
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
  const sortChoices = remoteSortSupported
    ? (streamingFilters?.sorts ?? []).length > 0
      ? (streamingFilters?.sorts ?? []).map((value) => ({
          value,
          label: sortLabels[value] || value.replace(/_/g, ' '),
        }))
      : remoteSortOptions
    : []

  useEffect(() => {
    if (!remoteSortSupported) return
    const sorts = streamingFilters?.sorts ?? []
    if (sorts.length === 0) return
    if (sorts.includes(remoteSort)) return
    setRemoteSort(sorts[0])
  }, [remoteSortSupported, streamingFilters, remoteSort])

  const limit = isMetaProvider ? 14 : (caps?.pageSize ?? 14)

  interface UrlSnapshot {
    category: 'hentai' | 'adult'
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
    if (s.category === 'adult') p.set('category', 'adult')
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
    category,
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
  } = useQuery({
    ...trpc.data.matureSearch.queryOptions(parseMatureSearchInput(paramString)),
    enabled: hasConsent && providerOptions.some((o) => o.value === provider),
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
  const totalPages =
    response?.total != null ? Math.max(1, Math.ceil(response.total / limit)) : undefined

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

  const handleCategoryChange = (next: 'hentai' | 'adult') => {
    const nextOptions =
      next === 'adult'
        ? adultStreamingOptions.map((o) => ({ value: o.id, label: o.label }))
        : [
            ...META_PROVIDER_OPTIONS,
            ...hentaiStreamingOptions.map((o) => ({ value: o.id, label: o.label })),
          ]
    const nextProvider = next === 'adult' ? (nextOptions[0]?.value ?? '') : 'anilist'
    setCategory(next)
    setProvider(nextProvider)
    setPage(1)
    setGenre('')
    setRemoteSort('')
    setQuery('')
    setSubmittedQuery('')
    setStudio('')
    setSubmittedStudio('')
    writeParams(
      snapshot({
        category: next,
        provider: nextProvider,
        page: 1,
        genre: '',
        remoteSort: '',
        query: '',
      })
    )
  }

  const handleCardClick = async (e: React.MouseEvent<HTMLElement>, show: MatureShow) => {
    if (category === 'adult') {
      e.preventDefault()
      e.stopPropagation()
      setAdultPlayback({ id: show.id || show._id, name: show.name, provider })
      return
    }
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
          const st = await trpcClient.data.anilistStatus.query()
          anilistUp = st?.available === true
        } catch {
          anilistUp = false
        }
        if (anilistUp) {
          const data = await trpcClient.data.matureResolve.query({ title: show.name })
          navigate(`/anime/${(data as { id: number }).id}`)
          return
        }
        const data = await trpcClient.data.matureAllocate.mutate({
          provider,
          nativeId: id,
          title: show.name,
          thumbnail: show.thumbnail,
        })
        if (!data?.id) throw new Error('Allocate failed')
        navigate(`/anime/${data.id}`)
        return
      }
      const data = await trpcClient.data.matureResolve.query({ title: show.name })
      navigate(`/anime/${(data as { id: number }).id}`)
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
      <div className={searchStyles.header}>
        <h1 className={searchStyles.pageTitle}>Mature</h1>
        <p className={searchStyles.pageSubtitle}>
          Browse 18+ titles across AniList and streaming providers
        </p>
      </div>

      <div className={searchStyles.filterContainer}>
        <div className={searchStyles.searchBarWrapper}>
          <div className={searchStyles.inputIconWrapper}>
            <Icon name="search" className={searchStyles.searchIcon} />
            <input
              type="text"
              placeholder={`Search ${providerOptions.find((p) => p.value === provider)?.label}...`}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch()
              }}
              className={searchStyles.searchInput}
            />
          </div>
          <div className={searchStyles.searchActions}>
            <select
              value={category}
              onChange={(e) => handleCategoryChange(e.currentTarget.value as 'hentai' | 'adult')}
              className={searchStyles.providerSelect}
              aria-label="Category"
            >
              <option value="hentai">Hentai</option>
              <option value="adult">Adult</option>
            </select>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.currentTarget.value)}
              className={searchStyles.providerSelect}
              aria-label="Provider"
            >
              {providerOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <Button onClick={handleSearch} className={searchStyles.searchBtn}>
              Search
            </Button>
            {isMetaProvider && (
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`${searchStyles.filterToggleBtn} ${showFilters ? searchStyles.active : ''}`}
              >
                <Icon name="filter" /> Filters
              </button>
            )}
            {remoteSortSupported && (
              <select
                value={remoteSort}
                onChange={(e) => {
                  setRemoteSort(e.currentTarget.value)
                  setPage(1)
                  writeParams(snapshot({ remoteSort: e.currentTarget.value, page: 1 }))
                }}
                className={searchStyles.providerSelect}
                aria-label="Sort"
              >
                {sortChoices.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {(provider === 'anilist' || provider === 'mal') && (
          <div
            className={`${searchStyles.advancedFilters} ${showFilters ? searchStyles.show : ''}`}
          >
            <div className={searchStyles.filterDivider} />
            <div className={searchStyles.filterGrid}>
              <div className={searchStyles.filterItem}>
                <label>Sort By</label>
                <select value={sort} onChange={(e) => setSort(e.currentTarget.value)}>
                  {sortOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={searchStyles.filterItem}>
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
                  <div className={searchStyles.filterItem}>
                    <label>Season</label>
                    <select value={season} onChange={(e) => setSeason(e.currentTarget.value)}>
                      {seasonOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={searchStyles.filterItem}>
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
            <div className={searchStyles.filterActions}>
              <Button onClick={handleSearch} className={searchStyles.searchBtn}>
                Apply Filters
              </Button>
            </div>
          </div>
        )}

        {!isMetaProvider && !!filters && (genreSupported || orderSupported || studioSupported) && (
          <div className={`${searchStyles.advancedFilters} ${searchStyles.show}`}>
            <div className={searchStyles.filterDivider} />
            <div className={`${searchStyles.filterGrid} ${styles.tightGrid}`}>
              {orderSupported && (
                <div className={`${searchStyles.filterItem} ${styles.shrinkSelect}`}>
                  <label>Order</label>
                  <select
                    value={effectiveOrder}
                    onChange={(e) => {
                      setRemoteOrder(e.currentTarget.value)
                      setPage(1)
                      writeParams(snapshot({ remoteOrder: e.currentTarget.value, page: 1 }))
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
                <div className={`${searchStyles.filterItem} ${styles.shrinkSelect}`}>
                  <label>Genre</label>
                  <select
                    value={genre}
                    onChange={(e) => {
                      if (orderSupported) {
                        setGenre(e.currentTarget.value)
                        setPage(1)
                        writeParams(snapshot({ genre: e.currentTarget.value, page: 1 }))
                      } else {
                        handleGenreChange(e.currentTarget.value)
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
                <div className={searchStyles.filterItem}>
                  <label>Studio</label>
                  <input
                    type="text"
                    list="mature-studio-list"
                    placeholder="Studio name..."
                    value={studio}
                    onChange={(e) => setStudio(e.currentTarget.value)}
                    onFocus={(e) => {
                      try {
                        ;(
                          e.currentTarget as HTMLInputElement & { showPicker?: () => void }
                        ).showPicker?.()
                      } catch {
                        // ignore
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSearch()
                    }}
                  />
                  <datalist id="mature-studio-list">
                    {(streamingFilters?.studios ?? []).map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
              )}
            </div>
            {genre && genreSupported && !orderSupported && (
              <p className={searchStyles.pageSubtitle}>
                Browsing the {prettyLabel(genre)} genre - search text is ignored while a genre is
                selected.
              </p>
            )}
            {(orderSupported || studioSupported) && (
              <div className={searchStyles.filterActions}>
                <Button onClick={handleSearch} className={searchStyles.searchBtn}>
                  Apply Filters
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {isError && (
        <ErrorMessage message={(error as unknown as Error)?.message || 'Search failed'} />
      )}

      {isLoading ? (
        <SkeletonGrid count={limit} />
      ) : results.length === 0 ? (
        <div className={searchStyles.noResults}>
          <h3>No results found</h3>
          <p>Try a different query, genre or provider</p>
        </div>
      ) : (
        <>
          <div className={searchStyles.resultsHeader}>
            <h2 className={searchStyles.resultsTitle}>
              {response?.total ?? results.length} result
              {(response?.total ?? results.length) === 1 ? '' : 's'}
            </h2>
            <div className={searchStyles.pagination}>
              <Pagination
                page={page}
                totalPages={totalPages}
                canGoNext={hasMore}
                onChange={handlePageChange}
                variant="labeled"
              />
            </div>
          </div>
          <div className={category === 'adult' ? styles.resultsGrid : searchStyles.resultsGrid}>
            {results.map((show) => (
              <div key={`${provider}-${show._id}`} onClickCapture={(e) => handleCardClick(e, show)}>
                <AnimeCard anime={show} wide={category === 'adult'} />
              </div>
            ))}
          </div>
          <div className={searchStyles.bottomPagination}>
            <div className={searchStyles.pagination}>
              <Pagination
                page={page}
                totalPages={totalPages}
                canGoNext={hasMore}
                onChange={handlePageChange}
                variant="labeled"
              />
            </div>
          </div>
        </>
      )}
      <AdultPlayerModal item={adultPlayback} onClose={() => setAdultPlayback(null)} />
    </div>
  )
}
