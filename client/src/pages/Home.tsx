import React, { useEffect, useMemo, useCallback, useRef, useState } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import Icon from '../components/common/Icon'
import AnimeSection from '../components/anime/AnimeSection'
import TrendingList from '../components/anime/TrendingList'
import LatestReleasesList from '../components/anime/LatestReleasesList'
import Schedule from '../components/anime/Schedule'
import AnimeCard from '../components/anime/AnimeCard'
import SkeletonGrid from '../components/common/SkeletonGrid'
import SpotlightBanner from '../components/anime/SpotlightBanner'
import { SpotlightSkeleton } from '../components/common/SpotlightBanner'
import HomeEmptyState from '../components/common/HomeEmptyState'
import ResetProgressModal from '../components/common/ResetProgressModal'
import SectionSelect from '../components/common/SectionSelect'
import QueueRail from '../components/player/QueueRail'
import {
  usePaginatedCurrentSeason,
  useAllContinueWatching,
  useRemoveFromWatchlist,
  useSpotlightBanners,
  useQueue,
  useRemoveFromQueue,
  useClearQueue,
  useReorderQueue,
  useThisWeekSchedule,
} from '../hooks/useAnimeData'
import { useTitlePreference } from '../contexts/TitlePreferenceContext'
import { useContentType, type ContentType } from '../contexts/ContentTypeContext'
import OptionTabs from '../components/common/OptionTabs'
import MangaHome from '../components/manga/MangaHome'
import TvHome from '../components/tv/TvHome'
import AsmrHome from '../components/asmr/AsmrHome'
import TvSpotlightBanner from '../components/tv/TvSpotlightBanner'
import MangaSpotlightBanner from '../components/manga/MangaSpotlightBanner'
import AsmrSpotlightBanner from '../components/asmr/AsmrSpotlightBanner'
import { useTvTrending } from '../hooks/useTv'
import { useMangaTrending } from '../hooks/useManga'
import { useAsmrSpotlight } from '../hooks/useAsmr'
import { fetchApi } from '../lib/fetchApi'
import styles from './Home.module.css'

type ActiveTab = 'latest' | 'season' | 'popular' | 'week'

const CONTENT_OPTIONS: { value: ContentType; label: string }[] = [
  { value: 'anime', label: 'Anime' },
  { value: 'manga', label: 'Manga' },
  { value: 'tv', label: 'TV & Movies' },
  { value: 'asmr', label: 'ASMR' },
]

const Home: React.FC = () => {
  const queryClient = useQueryClient()
  const [page, setPage] = React.useState(1)
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    return (localStorage.getItem('home_activeTab') as ActiveTab) || 'latest'
  })
  const [seasonFormat, setSeasonFormat] = useState(() => {
    return localStorage.getItem('season_format') || 'TV'
  })
  const seasonalRef = useRef<HTMLDivElement>(null)

  const { data: nextPageData } = usePaginatedCurrentSeason(
    page + 1,
    seasonFormat,
    activeTab === 'season'
  )

  const { titlePreference } = useTitlePreference()
  const { contentType, setContentType } = useContentType()
  const [itemToRemove, setItemToRemove] = React.useState<{ id: string; name: string } | null>(null)
  const [alsoRemoveFromWatchlist, setAlsoRemoveFromWatchlist] = React.useState(false)
  const removeWatchlistMutation = useRemoveFromWatchlist()
  const { data: queueData = [] } = useQueue()

  const removeQueue = useRemoveFromQueue()
  const clearQueue = useClearQueue()
  const reorderQueue = useReorderQueue()

  useEffect(() => {
    document.title = 'Home - dango'
  }, [])

  const { data: thisWeekList, isLoading: loadingThisWeek } = useThisWeekSchedule()

  useEffect(() => {
    localStorage.setItem('home_activeTab', activeTab)
  }, [activeTab])

  useEffect(() => {
    localStorage.setItem('season_format', seasonFormat)
    setPage(1)
  }, [seasonFormat])

  useEffect(() => {
    if (thisWeekList !== undefined && thisWeekList.length === 0 && activeTab === 'week') {
      setActiveTab('latest')
    }
  }, [thisWeekList, activeTab])

  const {
    data: continueWatchingInfinite,
    isLoading: loadingContinueWatching,
    fetchNextPage: fetchMoreContinueWatching,
    hasNextPage: hasMoreContinueWatching,
    isFetchingNextPage: fetchingMoreContinueWatching,
  } = useAllContinueWatching()

  const handleReachContinueWatchingThreshold = useCallback(() => {
    if (hasMoreContinueWatching && !fetchingMoreContinueWatching && !loadingContinueWatching) {
      fetchMoreContinueWatching()
    }
  }, [
    hasMoreContinueWatching,
    fetchingMoreContinueWatching,
    loadingContinueWatching,
    fetchMoreContinueWatching,
  ])

  const { data: spotlightAnime, isLoading: loadingSpotlight } = useSpotlightBanners()
  const { data: tvTrending, isLoading: loadingTvSpotlight } = useTvTrending(
    'all',
    'week',
    1,
    contentType === 'tv'
  )
  const { data: asmrSpotlight, isLoading: loadingAsmrSpotlight } = useAsmrSpotlight(
    contentType === 'asmr'
  )
  const { data: mangaTrending, isLoading: loadingMangaSpotlight } = useMangaTrending()
  const cwList = useMemo(() => continueWatchingInfinite?.pages || [], [continueWatchingInfinite])

  const { data: currentSeason, isLoading: loadingSeason } = usePaginatedCurrentSeason(
    page,
    seasonFormat,
    activeTab === 'season'
  )
  const seasonLimit = 14

  const canGoNext =
    currentSeason && currentSeason.length >= seasonLimit && nextPageData && nextPageData.length > 0

  const removeCw = useMutation({
    mutationFn: async (showId: string) => {
      await fetchApi('/api/continue-watching/remove', {
        method: 'POST',
        body: JSON.stringify({ showId }),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
      if (hasMoreContinueWatching && cwList.length - 1 < 14) {
        fetchMoreContinueWatching()
      }
    },
  })

  const handleRemove = useCallback(
    (id: string) => {
      const show = cwList?.find((s) => String(s.id) === String(id))
      if (show) {
        const displayTitle = (show[titlePreference as keyof typeof show] as string) || show.name
        setItemToRemove({ id, name: displayTitle })
      }
    },
    [cwList, titlePreference]
  )

  const handleConfirmRemove = useCallback(() => {
    if (!itemToRemove) return
    removeCw.mutate(itemToRemove.id)
    if (alsoRemoveFromWatchlist) removeWatchlistMutation.mutate(itemToRemove.id)
    setItemToRemove(null)
    setAlsoRemoveFromWatchlist(false)
  }, [itemToRemove, removeCw, removeWatchlistMutation, alsoRemoveFromWatchlist])

  const tabs: { key: ActiveTab; label: string }[] = [
    { key: 'latest', label: 'Latest Releases' },
    { key: 'season', label: 'Current Season' },
    { key: 'popular', label: 'Trending' },
  ]

  const hasThisWeek = thisWeekList !== undefined && thisWeekList.length > 0
  const tabsWithWeek = hasThisWeek
    ? [{ key: 'week' as ActiveTab, label: 'This Week' }, ...tabs]
    : tabs

  const displayTab = activeTab === 'week' && !hasThisWeek ? 'latest' : activeTab

  const renderTabContent = () => {
    switch (displayTab) {
      case 'latest':
        return <LatestReleasesList eyebrow="Fresh episodes" />
      case 'season':
        return (
          <section style={{ marginBottom: '2.5rem' }}>
            <div className={styles['section-header']} ref={seasonalRef}>
              <div className={styles['title-wrapper']}>
                <div className="title-stack">
                  <div className="section-eyebrow">This season</div>
                  <div className="section-title" style={{ marginBottom: 0 }}>
                    Current Season
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <SectionSelect
                  ariaLabel="Season format"
                  width={90}
                  value={seasonFormat}
                  onChange={setSeasonFormat}
                  options={[
                    { value: 'TV', label: 'TV' },
                    { value: 'ONA', label: 'ONA' },
                    { value: 'OVA', label: 'OVA' },
                    { value: 'MOVIE', label: 'Movie' },
                    { value: 'ALL', label: 'All' },
                    { value: 'ADULT', label: 'Mature' },
                  ]}
                />
                <div className={styles['pagination-controls']}>
                  <button
                    className={styles['nav-button']}
                    onClick={() => {
                      if (page > 1) {
                        setPage((p) => p - 1)
                        if (seasonalRef.current) {
                          const y =
                            seasonalRef.current.getBoundingClientRect().top + window.scrollY - 120
                          window.scrollTo({ top: y, behavior: 'smooth' })
                        }
                      }
                    }}
                    disabled={page === 1}
                    style={{ opacity: page === 1 ? 0.3 : 1 }}
                    aria-label="Previous page"
                  >
                    <Icon name="chevron-left" size={14} />
                  </button>
                  <span className={styles['page-info']}>{page}</span>
                  <button
                    className={styles['nav-button']}
                    onClick={() => {
                      setPage((p) => p + 1)
                      if (seasonalRef.current) {
                        const y =
                          seasonalRef.current.getBoundingClientRect().top + window.scrollY - 120
                        window.scrollTo({ top: y, behavior: 'smooth' })
                      }
                    }}
                    disabled={!canGoNext}
                    style={{ opacity: canGoNext ? 1 : 0.3 }}
                    aria-label="Next page"
                  >
                    <Icon name="chevron-right" size={14} />
                  </button>
                </div>
              </div>
            </div>

            <div
              className={`grid-container ${styles.seasonGrid}`}
              style={{
                minHeight: '300px',
                alignContent: 'start',
              }}
            >
              {loadingSeason ? (
                <SkeletonGrid count={seasonLimit} />
              ) : (
                currentSeason
                  ?.slice(0, seasonLimit)
                  .map((anime) => <AnimeCard key={anime._id} anime={anime} />)
              )}
            </div>
          </section>
        )
      case 'popular':
        return <TrendingList title="Trending" eyebrow="Discover" />
      case 'week':
        return (
          <AnimeSection
            title="This Week"
            eyebrow="Aired this week"
            animeList={thisWeekList || []}
            continueWatching={false}
            carousel
            loading={loadingThisWeek}
          />
        )
      default:
        return null
    }
  }

  return (
    <div style={{ paddingBottom: '2rem' }}>
      {contentType === 'anime' &&
        (loadingSpotlight && !spotlightAnime?.length ? (
          <SpotlightSkeleton />
        ) : (
          <SpotlightBanner animeList={spotlightAnime || []} />
        ))}

      {contentType === 'tv' &&
        (loadingTvSpotlight && !tvTrending?.results?.length ? (
          <SpotlightSkeleton />
        ) : (
          tvTrending?.results &&
          tvTrending.results.length > 0 && <TvSpotlightBanner items={tvTrending.results} />
        ))}

      {contentType === 'manga' &&
        (loadingMangaSpotlight && !mangaTrending?.length ? (
          <SpotlightSkeleton />
        ) : (
          mangaTrending &&
          mangaTrending.length > 0 && <MangaSpotlightBanner mangaList={mangaTrending} />
        ))}

      {contentType === 'asmr' &&
        (loadingAsmrSpotlight && !asmrSpotlight?.length ? (
          <SpotlightSkeleton />
        ) : (
          asmrSpotlight && asmrSpotlight.length > 0 && <AsmrSpotlightBanner works={asmrSpotlight} />
        ))}

      <OptionTabs
        ariaLabel="Content type"
        options={CONTENT_OPTIONS}
        value={contentType}
        onChange={setContentType}
      />

      {contentType === 'manga' ? (
        <MangaHome />
      ) : contentType === 'tv' ? (
        <TvHome />
      ) : contentType === 'asmr' ? (
        <AsmrHome />
      ) : (
        <>
          <AnimeSection
            title="Continue Watching"
            eyebrow="Pick up where you left off"
            titleLink="/watchlist/Continue Watching"
            animeList={cwList}
            continueWatching
            carousel
            collapsible
            defaultExpanded={cwList.length > 0}
            onRemove={handleRemove}
            loading={loadingContinueWatching}
            onReachThreshold={handleReachContinueWatchingThreshold}
            scrollThreshold={0.7}
            isFetchingNextPage={fetchingMoreContinueWatching}
            emptyState={
              <HomeEmptyState
                icon="history"
                text="You haven't watched anything yet. Start exploring and watch something first!"
                actionLabel="Explore Trending"
                onAction={() => setActiveTab('popular')}
              />
            }
          />

          <QueueRail
            title="Queue"
            eyebrow="Up next"
            items={queueData}
            onRemove={(item) =>
              removeQueue.mutate({ showId: item.showId, episodeNumber: item.episodeNumber })
            }
            showClearAll
            onClear={() => clearQueue.mutate()}
            onReorder={(items) =>
              reorderQueue.mutate(
                items.map((item) => ({
                  id: item.id,
                  showId: item.showId,
                  episodeNumber: item.episodeNumber,
                }))
              )
            }
          />

          <OptionTabs
            ariaLabel="Browse anime"
            options={tabsWithWeek.map((tab) => ({ value: tab.key, label: tab.label }))}
            value={displayTab}
            onChange={setActiveTab}
          />

          <div className={styles.tabContent}>{renderTabContent()}</div>

          <Schedule eyebrow="Never miss an episode" />

          <ResetProgressModal
            isOpen={!!itemToRemove}
            itemName={itemToRemove?.name}
            progressKind="watch"
            listLabel="my watchlist"
            alsoRemove={alsoRemoveFromWatchlist}
            onAlsoRemoveChange={setAlsoRemoveFromWatchlist}
            onClose={() => {
              setItemToRemove(null)
              setAlsoRemoveFromWatchlist(false)
            }}
            onConfirm={handleConfirmRemove}
          />
        </>
      )}
    </div>
  )
}

export default Home
