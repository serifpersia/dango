import { useCallback, useMemo } from 'react'
import Icon from '../common/Icon'
import SectionSelect from '../common/SectionSelect'
import ErrorMessage from '../common/ErrorMessage'
import AnimeCard from './AnimeCard'
import { useInfiniteTrendingList } from '../../hooks/useAnimeData'
import styles from './TrendingList.module.css'
import { useLowEndMode } from '../../contexts/LowEndModeContext'
import { useCarousel } from '../../hooks/useCarousel'
import { useLocalStorage } from '../../hooks/useLocalStorage'

interface TrendingListProps {
  title: string
  eyebrow?: string
}

const SORT_TRENDING = 'TRENDING_DESC'
const SORT_ALL_TIME = 'POPULARITY_DESC'
const PAGE_SIZE = 10

export default function TrendingList({ title, eyebrow }: TrendingListProps) {
  const { lowEndMode } = useLowEndMode()
  const [sort, setSort] = useLocalStorage<string>('trending_sort', SORT_TRENDING)

  const sortOptions = [
    { value: SORT_TRENDING, label: 'Trending' },
    { value: SORT_ALL_TIME, label: 'All Time' },
  ]

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, error } =
    useInfiniteTrendingList(sort, PAGE_SIZE)

  const trendingList = useMemo(() => {
    return data?.pages.flatMap((page) => page) || []
  }, [data])

  const handleReachThreshold = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isLoading) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage])

  const { emblaRef, stepBy, canScrollPrev, canScrollNext } = useCarousel({
    onReachThreshold: handleReachThreshold,
    slideCount: trendingList.length,
  })

  return (
    <section className={styles.sectionWrapper}>
      <div className={styles['section-header']}>
        <div className={styles['title-wrapper']}>
          <div className="title-stack">
            {eyebrow && <div className="section-eyebrow">{eyebrow}</div>}
            <div className={`section-title ${styles.sectionTitleNoMargin}`}>{title}</div>
          </div>
        </div>

        <div className={styles['header-actions']}>
          <SectionSelect
            ariaLabel="Trending sort"
            width={120}
            value={sort}
            options={sortOptions}
            onChange={setSort}
          />
          {(canScrollPrev || canScrollNext) && (
            <div className={styles['nav-arrows']}>
              {canScrollPrev && (
                <button
                  className={styles['nav-button']}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    stepBy('left', lowEndMode)
                  }}
                  aria-label="Scroll left"
                >
                  <Icon name="chevron-left" />
                </button>
              )}
              {canScrollNext && (
                <button
                  className={styles['nav-button']}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    stepBy('right', lowEndMode)
                  }}
                  aria-label="Scroll right"
                >
                  <Icon name="chevron-right" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className={styles.carouselContainer}>
          <div className={styles.carousel}>
            <div className={styles.carouselInner}>
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className={styles.carouselItem}>
                  <div className={styles.skeletonPoster} />
                  <div className={styles.skeletonText} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : isError ? (
        <ErrorMessage
          message={error instanceof Error ? error.message : 'An unknown error occurred'}
        />
      ) : (
        <div className={styles.carouselContainer}>
          <div className={styles.carousel} ref={emblaRef}>
            <div className={styles.carouselInner}>
              {trendingList.map((item, i) => (
                <div key={item._id} className={styles.carouselItem}>
                  <div className={styles.rankCard}>
                    <AnimeCard anime={item} />
                  </div>
                  <div
                    className={`${styles.rankPill} ${
                      i === 0
                        ? styles.rankGold
                        : i === 1
                          ? styles.rankSilver
                          : i === 2
                            ? styles.rankBronze
                            : ''
                    }`}
                  >
                    {i + 1}
                  </div>
                </div>
              ))}
              {isFetchingNextPage && (
                <div
                  className={styles.carouselItem}
                  style={{
                    minWidth: '150px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <div className={styles.skeletonPoster} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
