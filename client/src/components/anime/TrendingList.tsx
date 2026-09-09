import { useCallback, useMemo } from 'react'
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa'
import ErrorMessage from '../common/ErrorMessage'
import AnimeCard from './AnimeCard'
import { useInfiniteTrendingList } from '../../hooks/useAnimeData'
import styles from './TrendingList.module.css'
import { useLowEndMode } from '../../contexts/LowEndModeContext'
import { useCarousel } from '../../hooks/useCarousel'
import { useLocalStorage } from '../../hooks/useLocalStorage'

interface TrendingListProps {
  title: string
}

const SORT_TRENDING = 'TRENDING_DESC'
const SORT_ALL_TIME = 'POPULARITY_DESC'
const PAGE_SIZE = 10

export default function TrendingList({ title }: TrendingListProps) {
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

  const { emblaRef, stepBy } = useCarousel({ onReachThreshold: handleReachThreshold })

  return (
    <section className={styles.sectionWrapper}>
      <div className={styles['section-header']}>
        <div className={styles['title-wrapper']}>
          <div className={`section-title ${styles.sectionTitleNoMargin}`}>{title}</div>
          <div className={styles['nav-arrows']}>
            <button
              className={styles['nav-button']}
              type="button"
              onClick={(e) => {
                e.preventDefault()
                stepBy('left', lowEndMode)
              }}
              aria-label="Scroll left"
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
              aria-label="Scroll right"
            >
              <FaChevronRight />
            </button>
          </div>
        </div>

        <div className={styles['header-actions']}>
          <select
            className={styles.timeSelect}
            value={sort}
            onChange={(e) => setSort(e.currentTarget.value)}
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
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
                  <AnimeCard anime={item} rank={i + 1} />
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
