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

  if (!loading && animeList.length === 0 && !emptyState && !collapsible) return null

  const defaultLayout = 'vertical'
  const currentLayout = layout || defaultLayout

  return (
    <section
      className={`${styles.sectionWrapper} ${continueWatching ? styles['continue-watching'] : ''}`}
    >
      <div className={styles['section-header']}>
        <div className={styles['title-wrapper']}>
          {titleLink ? (
            <Link to={titleLink} className={styles['title-link']}>
              <div className={`section-title ${styles.sectionTitleNoMargin}`}>{title}</div>
            </Link>
          ) : (
            <div className={`section-title ${styles.sectionTitleNoMargin}`}>{title}</div>
          )}
          {carousel && animeList.length > 0 && isExpanded && (
            <div className={styles['nav-arrows']}>
              <button
                className={styles['nav-button']}
                type="button"
                aria-label="Scroll left"
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
                aria-label="Scroll right"
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
        (carousel ? (
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
                    : animeList.map((anime) => (
                        <div key={anime._id} className={styles['carousel-card']}>
                          <AnimeCard
                            anime={anime}
                            continueWatching={continueWatching}
                            onRemove={onRemove}
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
              animeList.map((anime) => (
                <AnimeCard
                  key={anime._id}
                  anime={anime}
                  continueWatching={continueWatching}
                  onRemove={onRemove}
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
