import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router'
import HomeEmptyState from '../common/HomeEmptyState'
import ResetProgressModal from '../common/ResetProgressModal'
import SectionSelect from '../common/SectionSelect'
import MediaSection from '../common/MediaSection'
import MediaCard from '../common/MediaCard'
import TvCard from './TvCard'
import TvPopup from './TvPopup'
import OptionTabs from '../common/OptionTabs'
import { formatTime } from '../../lib/utils'
import { isTvAdult, tvWatchPath } from '../../lib/tv'
import { useTvTrending, useTvSearchPaginated, type TvSearchResult } from '../../hooks/useTv'
import {
  useTvContinueWatching,
  useRemoveTvBookmark,
  useRemoveTvProgress,
} from '../../hooks/useTvLibrary'
import styles from '../../pages/Home.module.css'

type ActiveTab = 'latest' | 'trending'

const TAB_OPTIONS: { value: ActiveTab; label: string }[] = [
  { value: 'latest', label: 'Latest Releases' },
  { value: 'trending', label: 'Trending' },
]

const TRENDING_SORT_OPTIONS = [
  { value: 'trending_week', label: 'Trending Now' },
  { value: 'trending_day', label: 'Trending Today' },
  { value: 'popular', label: 'Popular All Time' },
  { value: 'top_rated', label: 'Top Rated' },
] as const

const TvHome: React.FC = () => {
  const navigate = useNavigate()
  const { data: cwData, isLoading: cwLoading } = useTvContinueWatching(24)
  const removeBookmark = useRemoveTvBookmark()
  const removeProgress = useRemoveTvProgress()
  const [resetTarget, setResetTarget] = useState<{ libId: string; title: string } | null>(null)
  const [alsoRemoveFromWatchlist, setAlsoRemoveFromWatchlist] = useState(false)

  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    return (localStorage.getItem('tv_home_activeTab') as ActiveTab) || 'latest'
  })

  const [latestType, setLatestType] = useState<'tv' | 'movie'>('tv')
  const [trendingSort, setTrendingSort] = useState('trending_week')
  const [trendingType, setTrendingType] = useState<'multi' | 'tv' | 'movie'>('multi')

  const items = cwData?.data ?? []

  React.useEffect(() => {
    localStorage.setItem('tv_home_activeTab', activeTab)
  }, [activeTab])

  const isTrendingTm = trendingSort.startsWith('trending_')
  const trendingTimeWindow = trendingSort === 'trending_day' ? 'day' : 'week'
  const trendingSortMap: Record<string, string> = {
    popular: 'popularity.desc',
    top_rated: 'vote_average.desc',
  }
  const { data: trendingTmData, isLoading: trendingTmLoading } = useTvTrending(
    trendingType === 'multi' ? 'all' : trendingType,
    trendingTimeWindow,
    1,
    isTrendingTm && activeTab === 'trending'
  )
  const { data: trendingDiscoverData, isLoading: trendingDiscoverLoading } = useTvSearchPaginated({
    type: trendingType,
    sort_by: trendingSortMap[trendingSort] || 'popularity.desc',
    page: 1,
  })
  const trendingItems: TvSearchResult[] = isTrendingTm
    ? trendingTmData?.results || []
    : trendingDiscoverData?.results || []
  const trendingLoading = isTrendingTm ? trendingTmLoading : trendingDiscoverLoading

  const { data: latestData, isLoading: latestLoading } = useTvSearchPaginated({
    type: latestType,
    sort_by: 'primary_release_date.desc',
    page: 1,
  })
  const latestItems: TvSearchResult[] = latestData?.results || []

  const handleConfirmReset = () => {
    if (!resetTarget) return
    removeProgress.mutate({ mediaId: resetTarget.libId })
    if (alsoRemoveFromWatchlist) removeBookmark.mutate(resetTarget.libId)
    setResetTarget(null)
    setAlsoRemoveFromWatchlist(false)
  }

  const renderTvCard = useCallback(
    (item: TvSearchResult) => (
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
    ),
    []
  )

  const renderTabContent = () => {
    switch (activeTab) {
      case 'latest':
        return (
          <section>
            <div className={styles['section-header']}>
              <div className={styles['title-wrapper']}>
                <div className="title-stack">
                  <div className="section-eyebrow">Fresh picks</div>
                  <div className="section-title" style={{ marginBottom: 0 }}>
                    Latest Releases
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <SectionSelect
                  ariaLabel="Latest type"
                  value={latestType}
                  onChange={(v) => setLatestType(v as 'tv' | 'movie')}
                  options={[
                    { value: 'tv', label: 'TV Shows' },
                    { value: 'movie', label: 'Movies' },
                  ]}
                />
              </div>
            </div>

            {latestLoading ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                  gap: 'var(--space-6)',
                }}
              >
                {Array.from({ length: 7 }).map((_, i) => (
                  <div
                    key={i}
                    className="skeleton"
                    style={{ aspectRatio: '3 / 4', borderRadius: 'var(--radius-lg)' }}
                  />
                ))}
              </div>
            ) : latestItems.length > 0 ? (
              <MediaSection carousel itemCount={latestItems.length}>
                {latestItems.map(renderTvCard)}
              </MediaSection>
            ) : (
              <div className={styles.emptyState}>
                <p>No latest releases available right now.</p>
              </div>
            )}
          </section>
        )
      case 'trending':
        return (
          <section>
            <div className={styles['section-header']}>
              <div className={styles['title-wrapper']}>
                <div className="title-stack">
                  <div className="section-eyebrow">Discover</div>
                  <div className="section-title" style={{ marginBottom: 0 }}>
                    Trending
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <SectionSelect
                  ariaLabel="Trending sort"
                  value={trendingSort}
                  onChange={setTrendingSort}
                  options={TRENDING_SORT_OPTIONS.map((opt) => ({
                    value: opt.value,
                    label: opt.label,
                  }))}
                />
                <SectionSelect
                  ariaLabel="Trending type"
                  value={trendingType}
                  onChange={(v) => setTrendingType(v as 'multi' | 'tv' | 'movie')}
                  options={[
                    { value: 'multi', label: 'All' },
                    { value: 'tv', label: 'TV Shows' },
                    { value: 'movie', label: 'Movies' },
                  ]}
                />
              </div>
            </div>

            {trendingLoading ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                  gap: 'var(--space-6)',
                }}
              >
                {Array.from({ length: 7 }).map((_, i) => (
                  <div
                    key={i}
                    className="skeleton"
                    style={{ aspectRatio: '3 / 4', borderRadius: 'var(--radius-lg)' }}
                  />
                ))}
              </div>
            ) : trendingItems.length > 0 ? (
              <MediaSection carousel itemCount={trendingItems.length}>
                {trendingItems.map(renderTvCard)}
              </MediaSection>
            ) : (
              <div className={styles.emptyState}>
                <p>No trending content available right now.</p>
              </div>
            )}
          </section>
        )
    }
  }

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <MediaSection
        title="Continue Watching"
        eyebrow="Pick up where you left off"
        titleLink="/tv-watchlist/Continue Watching"
        loading={cwLoading}
        carousel
        collapsible
        defaultExpanded={items.length > 0}
        highlight
        itemCount={items.length}
        loadingSkeleton={<div className="skeleton" style={{ aspectRatio: '3 / 4' }} />}
        skeletonCount={7}
        emptyState={
          <HomeEmptyState
            icon="tv"
            text="You haven't watched anything yet. Search TV & Movies and start watching to track progress."
            actionLabel="Browse TV & Movies"
            onAction={() => navigate('/tv-search')}
          />
        }
      >
        {items.map((item) => {
          const ct = item.currentTime ?? 0
          const dur = item.duration ?? 0
          const s = item.season ?? item.lastSeason ?? 1
          const e = item.episode ?? item.lastEpisode ?? 1
          const isMovieItem = item.mediaType === 'movie'
          const episodeLabel = isMovieItem ? 'Movie' : `S${s} E${e}`
          const isWatched =
            item.completed === true || item.completed === 1 || (dur > 0 && ct >= dur * 0.8)
          const percent = isWatched ? 100 : dur > 0 && ct > 0 ? (ct / dur) * 100 : 0
          const label = isWatched
            ? 'Watched'
            : dur > 0
              ? isMovieItem
                ? `${formatTime(ct)} / ${formatTime(dur)}`
                : `${episodeLabel} · ${formatTime(ct)} / ${formatTime(dur)}`
              : episodeLabel
          return (
            <MediaCard
              key={item.id}
              item={{
                id: item.id,
                title: item.title,
                thumbnail: item.poster || '',
                typeBadge: isMovieItem ? 'Movie' : 'TV',
                chapterBadge: episodeLabel,
                isAdult: isTvAdult({ adult: item.adult === 1 }),
              }}
              linkTo={tvWatchPath(
                item.mediaType,
                item.tmdbId,
                isMovieItem ? undefined : s,
                isMovieItem ? undefined : e
              )}
              hoverIcon="play"
              progress={(dur > 0 || isWatched) && percent > 0 ? { percent, label } : undefined}
              showProgress
              metaRow={item.year ? <span style={{ opacity: 0.75 }}>{item.year}</span> : undefined}
              onRemove={() => setResetTarget({ libId: item.id, title: item.title })}
              renderPopup={(anchorRect, helpers) => (
                <TvPopup
                  item={{
                    id: item.tmdbId ?? 0,
                    title: item.title || '',
                    year: item.year || '',
                    type: item.mediaType || 'tv',
                    image: item.poster || '',
                  }}
                  anchorRect={anchorRect}
                  onMouseEnter={helpers.onMouseEnter}
                  onMouseLeave={helpers.onMouseLeave}
                  onRequestClose={helpers.close}
                />
              )}
            />
          )
        })}
      </MediaSection>

      <OptionTabs
        ariaLabel="Browse TV"
        options={TAB_OPTIONS}
        value={activeTab}
        onChange={setActiveTab}
      />

      <div className={styles.tabContent}>{renderTabContent()}</div>

      <ResetProgressModal
        isOpen={!!resetTarget}
        itemName={resetTarget?.title}
        progressKind="watch"
        listLabel="my TV watchlist"
        alsoRemove={alsoRemoveFromWatchlist}
        onAlsoRemoveChange={setAlsoRemoveFromWatchlist}
        onClose={() => {
          setResetTarget(null)
          setAlsoRemoveFromWatchlist(false)
        }}
        onConfirm={handleConfirmReset}
      />
    </div>
  )
}

export default TvHome
