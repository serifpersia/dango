import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router'
import Icon from '../common/Icon'
import { Button } from '../common/Button'
import { Modal } from '../common/Modal'
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
                <select
                  value={latestType}
                  onChange={(e) => setLatestType(e.target.value as 'tv' | 'movie')}
                  style={{
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
                    backgroundImage:
                      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%23a1a1aa' stroke-width='2' viewBox='0 0 12 12'%3E%3Cpolyline points='3 5 6 8 9 5'/%3E%3C/svg%3E\")",
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                  }}
                >
                  <option value="tv">TV Shows</option>
                  <option value="movie">Movies</option>
                </select>
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
                <select
                  value={trendingSort}
                  onChange={(e) => setTrendingSort(e.target.value)}
                  style={{
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
                    backgroundImage:
                      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%23a1a1aa' stroke-width='2' viewBox='0 0 12 12'%3E%3Cpolyline points='3 5 6 8 9 5'/%3E%3C/svg%3E\")",
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                  }}
                >
                  {TRENDING_SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <select
                  value={trendingType}
                  onChange={(e) => setTrendingType(e.target.value as 'multi' | 'tv' | 'movie')}
                  style={{
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
                    backgroundImage:
                      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%23a1a1aa' stroke-width='2' viewBox='0 0 12 12'%3E%3Cpolyline points='3 5 6 8 9 5'/%3E%3C/svg%3E\")",
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                  }}
                >
                  <option value="multi">All</option>
                  <option value="tv">TV Shows</option>
                  <option value="movie">Movies</option>
                </select>
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
          <div className={styles.emptyState}>
            <Icon name="tv" size={48} className={styles.emptyStateIcon} />
            <div>
              <h3 className={styles.emptyStateTitle}>Nothing is here...</h3>
              <p className={styles.emptyStateText}>
                You haven&apos;t watched anything yet. Search TV & Movies and start watching to
                track progress.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate('/tv-search')}
              style={{ marginTop: '1rem' }}
            >
              Browse TV & Movies
            </Button>
          </div>
        }
      >
        {items.map((item) => {
          const ct = item.currentTime ?? 0
          const dur = item.duration ?? 0
          const s = item.season ?? item.lastSeason ?? 1
          const e = item.episode ?? item.lastEpisode ?? 1
          const label =
            dur > 0 ? `S${s} E${e} · ${formatTime(ct)} / ${formatTime(dur)}` : `S${s} E${e}`
          return (
            <MediaCard
              key={item.id}
              item={{
                id: item.id,
                title: item.title,
                thumbnail: item.poster || '',
                typeBadge: item.mediaType === 'movie' ? 'Movie' : 'TV',
                chapterBadge: `S${s} E${e}`,
                isAdult: isTvAdult({ adult: item.adult === 1 }),
              }}
              linkTo={tvWatchPath(item.mediaType, item.tmdbId, s, e)}
              hoverIcon="play"
              progress={dur > 0 ? { percent: (ct / dur) * 100, label } : undefined}
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

      <Modal
        isOpen={!!resetTarget}
        onClose={() => {
          setResetTarget(null)
          setAlsoRemoveFromWatchlist(false)
        }}
        title="Reset Progress"
      >
        <Modal.Body>
          <p>
            Are you sure you want to remove your watch progress for &quot;{resetTarget?.title}
            &quot;?
          </p>
          <label>
            <input
              type="checkbox"
              checked={alsoRemoveFromWatchlist}
              onChange={(e) => setAlsoRemoveFromWatchlist(e.target.checked)}
            />
            Also remove from my TV watchlist
          </label>
        </Modal.Body>
        <Modal.Actions>
          <Button
            variant="secondary"
            onClick={() => {
              setResetTarget(null)
              setAlsoRemoveFromWatchlist(false)
            }}
          >
            No
          </Button>
          <Button variant="danger" onClick={handleConfirmReset}>
            Yes
          </Button>
        </Modal.Actions>
      </Modal>
    </div>
  )
}

export default TvHome
