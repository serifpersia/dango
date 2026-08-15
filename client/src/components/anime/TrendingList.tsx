import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa'
import ErrorMessage from '../common/ErrorMessage'
import AnimeCard from './AnimeCard'
import { useInfiniteTrendingList } from '../../hooks/useAnimeData'
import styles from './TrendingList.module.css'
import { useLowEndMode } from '../../contexts/LowEndModeContext'

interface TrendingListProps {
  title: string
}

const SORT_TRENDING = 'TRENDING_DESC'
const SORT_ALL_TIME = 'POPULARITY_DESC'
const PAGE_SIZE = 10

export default function TrendingList({ title }: TrendingListProps) {
  const { lowEndMode } = useLowEndMode()
  const [sort, setSort] = useState(() => {
    return localStorage.getItem('trending_sort') || SORT_TRENDING
  })
  const [anilistAvailable, setAnilistAvailable] = useState<boolean | null>(null)
  const carouselRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/anilist-status')
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setAnilistAvailable(j.available)
      })
      .catch(() => {
        if (!cancelled) setAnilistAvailable(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (anilistAvailable === false && sort === SORT_TRENDING) {
      setSort(SORT_ALL_TIME)
    }
  }, [anilistAvailable, sort])

  useEffect(() => {
    localStorage.setItem('trending_sort', sort)
  }, [sort])

  const showTrendingOption = anilistAvailable !== false

  const sortOptions = [
    ...(showTrendingOption ? [{ value: SORT_TRENDING, label: 'Trending' }] : []),
    { value: SORT_ALL_TIME, label: 'All Time' },
  ]

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, error } =
    useInfiniteTrendingList(sort, PAGE_SIZE)

  const trendingList = useMemo(() => {
    return data?.pages.flatMap((page) => page) || []
  }, [data])

  const handleScroll = useCallback(() => {
    if (!carouselRef.current || !hasNextPage || isFetchingNextPage || isLoading) return

    const { scrollLeft, clientWidth, scrollWidth } = carouselRef.current
    if (scrollLeft + clientWidth > scrollWidth * 0.6) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage])

  const scroll = useCallback(
    (direction: 'left' | 'right') => {
      const container = carouselRef.current
      if (!container) return

      const { scrollLeft, clientWidth, scrollWidth } = container
      const offset = clientWidth * 0.8

      if (direction === 'right' && hasNextPage && !isFetchingNextPage) {
        if (scrollLeft + clientWidth > scrollWidth - 100) {
          fetchNextPage()
        }
      }

      container.scrollTo({
        left: direction === 'left' ? scrollLeft - offset : scrollLeft + offset,
        behavior: lowEndMode ? 'auto' : 'smooth',
      })
    },
    [lowEndMode, hasNextPage, isFetchingNextPage, fetchNextPage]
  )

  return (
    <section style={{ marginBottom: '2.5rem' }}>
      {/* Header — matches AnimeSection header style */}
      <div className={styles['section-header']}>
        <div className={styles['title-wrapper']}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            {title}
          </div>
          <div className={styles['nav-arrows']}>
            <button
              className={styles['nav-button']}
              type="button"
              onClick={(e) => {
                e.preventDefault()
                scroll('left')
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
                scroll('right')
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

      {/* Carousel */}
      {isLoading ? (
        <div className={styles.carousel}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className={styles.carouselItem}>
              <div className={styles.skeletonPoster} />
              <div className={styles.skeletonText} />
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorMessage
          message={error instanceof Error ? error.message : 'An unknown error occurred'}
        />
      ) : (
        <div className={styles.carouselContainer}>
          <div className={styles.carousel} ref={carouselRef} onScroll={handleScroll}>
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
      )}
    </section>
  )
}
