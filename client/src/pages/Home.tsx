import React, { useEffect, useMemo, useCallback, useRef, useState } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { FaChevronLeft, FaChevronRight, FaHistory } from 'react-icons/fa'
import { Button } from '../components/common/Button'
import AnimeSection from '../components/anime/AnimeSection'
import TrendingList from '../components/anime/TrendingList'
import LatestReleasesList from '../components/anime/LatestReleasesList'
import Schedule from '../components/anime/Schedule'
import AnimeCard from '../components/anime/AnimeCard'
import SkeletonGrid from '../components/common/SkeletonGrid'
import RemoveConfirmationModal from '../components/common/RemoveConfirmationModal'
import SpotlightBanner from '../components/anime/SpotlightBanner'
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
import styles from './Home.module.css'

type ActiveTab = 'latest' | 'season' | 'popular' | 'week'

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

  const { data: nextPageData } = usePaginatedCurrentSeason(page + 1, seasonFormat)

  const { titlePreference } = useTitlePreference()
  const [itemToRemove, setItemToRemove] = React.useState<{ id: string; name: string } | null>(null)
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

  const { data: spotlightAnime } = useSpotlightBanners()
  const cwList = useMemo(() => continueWatchingInfinite?.pages || [], [continueWatchingInfinite])

  const { data: currentSeason, isLoading: loadingSeason } = usePaginatedCurrentSeason(
    page,
    seasonFormat
  )
  const seasonLimit = 14

  const canGoNext =
    currentSeason && currentSeason.length >= seasonLimit && nextPageData && nextPageData.length > 0

  const removeCw = useMutation({
    mutationFn: async (showId: string) => {
      await fetch('/api/continue-watching/remove', {
        method: 'POST',
        body: JSON.stringify({ showId }),
        headers: { 'Content-Type': 'application/json' },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
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

  const handleConfirmRemove = useCallback(
    (options: { removeFromWatchlist?: boolean }) => {
      if (!itemToRemove) return
      removeCw.mutate(itemToRemove.id)
      if (options.removeFromWatchlist) removeWatchlistMutation.mutate(itemToRemove.id)
      setItemToRemove(null)
    },
    [itemToRemove, removeCw, removeWatchlistMutation]
  )

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
        return <LatestReleasesList />
      case 'season':
        return (
          <section style={{ marginBottom: '2.5rem' }}>
            <div className={styles['section-header']} ref={seasonalRef}>
              <div className={styles['title-wrapper']}>
                <div className="section-title" style={{ marginBottom: 0 }}>
                  Current Season
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  style={{
                    width: '90px',
                    height: '34px',
                    padding: '0 8px',
                    paddingRight: '1.5rem',
                    backgroundColor: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 700,
                    cursor: 'pointer',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    backgroundImage:
                      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%23a1a1aa' stroke-width='2' viewBox='0 0 12 12'%3E%3Cpolyline points='3 5 6 8 9 5'/%3E%3C/svg%3E\")",
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                  }}
                  value={seasonFormat}
                  onChange={(e) => setSeasonFormat(e.currentTarget.value)}
                >
                  <option value="TV">TV</option>
                  <option value="ONA">ONA</option>
                  <option value="OVA">OVA</option>
                  <option value="MOVIE">Movie</option>
                  <option value="ALL">All</option>
                  <option value="ADULT">Mature</option>
                </select>
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
                    <FaChevronLeft size={14} />
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
                    <FaChevronRight size={14} />
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
        return <TrendingList title="Trending" />
      case 'week':
        return (
          <AnimeSection
            title="This Week"
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
      <SpotlightBanner animeList={spotlightAnime || []} />
      <QueueRail
        title="Queue"
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
      {/* ── Continue Watching ── */}
      <AnimeSection
        title="Continue Watching"
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
          <div className={styles.emptyState}>
            <FaHistory size={48} className={styles.emptyStateIcon} />
            <div>
              <h3 className={styles.emptyStateTitle}>Nothing is here...</h3>
              <p className={styles.emptyStateText}>
                You haven't watched anything yet. Start exploring and watch something first!
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setActiveTab('popular')}
              style={{ marginTop: '1rem' }}
            >
              Explore Trending
            </Button>
          </div>
        }
      />

      {/* ── Tab Selector ── */}
      <div className={styles.tabBar}>
        {tabsWithWeek.map((tab) => (
          <Button
            key={tab.key}
            variant={displayTab === tab.key ? 'primary' : 'secondary'}
            size="sm"
            className={`${styles.tabButton} ${displayTab === tab.key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      <div className={styles.tabContent}>{renderTabContent()}</div>

      <Schedule />

      <RemoveConfirmationModal
        isOpen={!!itemToRemove}
        onClose={() => setItemToRemove(null)}
        onConfirm={handleConfirmRemove}
        animeName={itemToRemove?.name || ''}
        scenario="continueWatching"
      />
    </div>
  )
}

export default Home
