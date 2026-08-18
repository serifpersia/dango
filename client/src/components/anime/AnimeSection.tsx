import React from 'react'
import { Link } from 'react-router'
import { FaChevronDown, FaChevronLeft, FaChevronRight, FaChevronUp } from 'react-icons/fa'
import AnimeCard from './AnimeCard'
import AnimeCardSkeleton from './AnimeCardSkeleton'
import SkeletonGrid from '../common/SkeletonGrid'
import styles from './AnimeSection.module.css'
import { useLowEndMode } from '../../contexts/LowEndModeContext'
import { useCarousel } from '../../hooks/useCarousel'

interface Anime {
  _id: string
  id: string
  name: string
  thumbnail: string
  nativeName?: string
  englishName?: string
  type?: string
  episodeNumber?: number
  currentTime?: number
  duration?: number
  watchedCount?: number
  episodeCount?: number
  nextEpisodeToWatch?: string
  newEpisodesCount?: number
  availableEpisodesDetail?: {
    sub?: string[]
    dub?: string[]
  }
}

interface AnimeSectionConfig {
  elements?: {
    poster?: {
      typeBadge?: boolean
      episodeBadge?: boolean
      removeButton?: boolean
      adultBadge?: boolean
    }
    info?: {
      title?: boolean
      mobileBadges?: boolean
      progress?: boolean
      meta?: boolean
    }
  }
}

interface AnimeSectionProps {
  title: string
  animeList: Anime[]
  continueWatching?: boolean
  titleLink?: string
  onRemove?: (id: string) => void
  loading?: boolean
  showSeeMore?: boolean
  emptyState?: React.ReactNode
  carousel?: boolean
  cardConfig?: AnimeSectionConfig
  layout?: 'vertical' | 'horizontal'
  onReachThreshold?: () => void
  scrollThreshold?: number
  isFetchingNextPage?: boolean
  collapsible?: boolean
  defaultExpanded?: boolean
}

const AnimeSection: React.FC<AnimeSectionProps> = ({
  title,
  animeList,
  continueWatching,
  titleLink,
  onRemove,
  loading,
  showSeeMore,
  emptyState,
  carousel,
  cardConfig,
  layout,
  onReachThreshold,
  scrollThreshold,
  isFetchingNextPage,
  collapsible,
  defaultExpanded = true,
}) => {
  const { lowEndMode } = useLowEndMode()
  const { emblaRef, stepBy, scrollToStart } = useCarousel({
    onReachThreshold,
    threshold: scrollThreshold,
  })
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded)

  React.useEffect(() => {
    setIsExpanded(defaultExpanded)
  }, [defaultExpanded])

  const prevCwLength = React.useRef(0)
  React.useEffect(() => {
    if (continueWatching && animeList.length > 0 && isExpanded) {
      if (animeList.length <= prevCwLength.current || prevCwLength.current === 0) {
        scrollToStart()
      }
    }
    if (animeList.length > 0) {
      prevCwLength.current = animeList.length
    }
  }, [animeList.length, continueWatching, isExpanded, scrollToStart])

  const shouldRenderSection = !(!loading && animeList.length === 0 && !emptyState && !collapsible)
  if (!shouldRenderSection) return null

  const isActuallyCarousel = carousel
  const defaultLayout = 'vertical'
  const currentLayout = layout || defaultLayout

  if (!loading && animeList.length === 0 && !emptyState) return null

  return (
    <section
      className={continueWatching ? styles['continue-watching'] : undefined}
      style={{ marginBottom: '2.5rem' }}
    >
      <div className={styles['section-header']}>
        <div className={styles['title-wrapper']}>
          {titleLink ? (
            <Link to={titleLink} className={styles['title-link']}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {title}
              </div>
            </Link>
          ) : (
            <div className="section-title" style={{ marginBottom: 0 }}>
              {title}
            </div>
          )}
          {carousel && animeList.length > 0 && isExpanded && (
            <div className={styles['nav-arrows']}>
              <button
                className={styles['nav-button']}
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  stepBy('left', lowEndMode)
                }}
              >
                <FaChevronLeft />
              </button>
              <button
                className={styles['nav-button']}
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  stepBy('right', lowEndMode)
                }}
              >
                <FaChevronRight />
              </button>
            </div>
          )}
        </div>
        <div className={styles['header-controls']}>
          {showSeeMore && (
            <div className={styles['header-actions']}>
              <Link
                to="/watchlist/Continue Watching"
                className="btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
              >
                View All
              </Link>
            </div>
          )}
          {collapsible && (
            <button
              className={styles['collapse-button']}
              type="button"
              onClick={() => setIsExpanded((open) => !open)}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? `Collapse ${title}` : `Expand ${title}`}
            >
              {isExpanded ? <FaChevronUp /> : <FaChevronDown />}
            </button>
          )}
        </div>
      </div>

      {isExpanded &&
        (isActuallyCarousel ? (
          !loading && animeList.length === 0 && emptyState ? (
            <div>{emptyState}</div>
          ) : (
            <div className={styles['carousel-container']}>
              <div className={styles.carousel} ref={emblaRef}>
                <div className={styles['carousel-inner']}>
                  {loading && animeList.length === 0
                    ? Array.from({ length: 7 }).map((_, i) => (
                        <div key={i} className={styles['carousel-card']}>
                          <AnimeCardSkeleton layout={currentLayout} />
                        </div>
                      ))
                    : animeList.map((anime, index) => (
                        <div key={anime._id} className={styles['carousel-card']}>
                          <AnimeCard
                            anime={anime}
                            continueWatching={continueWatching}
                            onRemove={onRemove}
                            isLCP={index < 4 && title === 'Latest Releases'}
                            config={cardConfig}
                            layout={currentLayout}
                          />
                        </div>
                      ))}
                  {isFetchingNextPage && (
                    <div className={styles['carousel-card']}>
                      <AnimeCardSkeleton layout={currentLayout} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="grid-container">
            {loading && animeList.length === 0 ? (
              <SkeletonGrid count={6} layout={currentLayout} />
            ) : animeList.length > 0 ? (
              animeList.map((anime, index) => (
                <AnimeCard
                  key={anime._id}
                  anime={anime}
                  continueWatching={continueWatching}
                  onRemove={onRemove}
                  isLCP={index < 4 && title === 'Latest Releases'}
                  config={cardConfig}
                  layout={currentLayout}
                />
              ))
            ) : !loading ? (
              <div style={{ gridColumn: '1 / -1' }}>{emptyState}</div>
            ) : null}
          </div>
        ))}
    </section>
  )
}

export default React.memo(AnimeSection)
