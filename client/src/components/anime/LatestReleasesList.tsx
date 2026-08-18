import { useState, useEffect, useMemo, useCallback } from 'react'
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa'
import AnimeCard from './AnimeCard'
import ErrorMessage from '../common/ErrorMessage'
import { useInfiniteLatestReleases } from '../../hooks/useAnimeData'
import styles from './TrendingList.module.css'
import { useLowEndMode } from '../../contexts/LowEndModeContext'
import { useCarousel } from '../../hooks/useCarousel'

const formatOptions = [
  { value: 'TV', label: 'TV' },
  { value: 'ONA', label: 'ONA' },
  { value: 'OVA', label: 'OVA' },
  { value: 'MOVIE', label: 'Movie' },
  { value: 'ALL', label: 'All' },
  { value: 'ADULT', label: 'Mature' },
]

const PAGE_SIZE = 10

export default function LatestReleasesList() {
  const { lowEndMode } = useLowEndMode()
  const [format, setFormat] = useState(() => {
    return localStorage.getItem('latest_releases_format') || 'TV'
  })

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, error } =
    useInfiniteLatestReleases(format, PAGE_SIZE)

  const animeList = useMemo(() => {
    return data?.pages.flatMap((page) => page) || []
  }, [data])

  useEffect(() => {
    localStorage.setItem('latest_releases_format', format)
  }, [format])

  const handleReachThreshold = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isLoading) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage])

  const { emblaRef, stepBy } = useCarousel({ onReachThreshold: handleReachThreshold })

  return (
    <section style={{ marginBottom: '2.5rem' }}>
      <div className={styles['section-header']}>
        <div className={styles['title-wrapper']}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            Latest Releases
          </div>
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
            value={format}
            onChange={(e) => setFormat(e.currentTarget.value)}
          >
            {formatOptions.map((opt) => (
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
              {animeList.map((item) => (
                <div key={item._id} className={styles.carouselItem}>
                  <AnimeCard anime={item} />
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
