import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router'
import Icon from '../common/Icon'
import styles from '../anime/SpotlightBanner.module.css'
import { tvDetailPath } from '../../lib/tv'

interface TvSpotlightItem {
  id: number
  title: string
  year: string
  type: string
  image: string
  backdrop: string
  overview: string
  vote_average: number
  genre_ids: number[]
}

interface TvSpotlightBannerProps {
  items: TvSpotlightItem[]
}

const GENRE_NAMES: Record<number, string> = {
  10759: 'Action & Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  18: 'Drama',
  10765: 'Sci-Fi & Fantasy',
  9648: 'Mystery',
  28: 'Action',
  12: 'Adventure',
  14: 'Fantasy',
  27: 'Horror',
  878: 'Sci-Fi',
  53: 'Thriller',
  10749: 'Romance',
}

const AUTOPLAY_MS = 8000

const TvSpotlightBanner: React.FC<TvSpotlightBannerProps> = ({ items }) => {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [autoplayResetKey, setAutoplayResetKey] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [pendingIndex, setPendingIndex] = useState<number | null>(null)
  const [loadedTick, setLoadedTick] = useState(0)
  const [ambient, setAmbient] = useState({ front: '', back: '', flip: false })
  const lastScrollTime = useRef(0)
  const touchStartX = useRef<number>(0)
  const loadedSrcs = useRef<Set<string>>(new Set())
  const pendingTimer = useRef<number | null>(null)
  const currentIndexRef = useRef(0)
  const navigate = useNavigate()
  const top6 = useMemo(() => items.slice(0, 6), [items])

  const bannerSrcFor = useCallback(
    (item: TvSpotlightItem) => (item.backdrop ? item.backdrop : item.image),
    []
  )

  const resetAutoplay = useCallback(() => {
    setAutoplayResetKey((k) => k + 1)
  }, [])

  const commitSlide = useCallback(
    (index: number) => {
      if (pendingTimer.current !== null) {
        window.clearTimeout(pendingTimer.current)
        pendingTimer.current = null
      }
      setPendingIndex(null)
      resetAutoplay()
      const src = bannerSrcFor(top6[index])
      setAmbient((prev) =>
        prev.flip
          ? { front: src, back: prev.back, flip: false }
          : { front: prev.front, back: src, flip: true }
      )
      setCurrentIndex(index)
    },
    [resetAutoplay, top6, bannerSrcFor]
  )

  const requestSlide = useCallback(
    (index: number) => {
      if (top6.length === 0) return
      const target = ((index % top6.length) + top6.length) % top6.length
      if (loadedSrcs.current.has(bannerSrcFor(top6[target]))) {
        commitSlide(target)
      } else {
        setPendingIndex(target)
      }
    },
    [top6, bannerSrcFor, commitSlide]
  )

  useEffect(() => {
    let cancelled = false
    top6.forEach((item) => {
      const src = bannerSrcFor(item)
      if (loadedSrcs.current.has(src)) return
      const img = new Image()
      img.src = src
      const markDone = () => {
        if (cancelled || loadedSrcs.current.has(src)) return
        loadedSrcs.current.add(src)
        setLoadedTick((t) => t + 1)
      }
      img.onload = markDone
      img.onerror = markDone
    })
    return () => {
      cancelled = true
    }
  }, [top6, bannerSrcFor])

  useEffect(() => {
    if (top6.length === 0) return
    if (!ambient.front) {
      const src = bannerSrcFor(top6[0])
      setAmbient({ front: src, back: '', flip: false })
    }
  }, [top6, ambient.front, bannerSrcFor])

  useEffect(() => {
    if (pendingIndex === null) return
    if (pendingIndex < 0 || pendingIndex >= top6.length) {
      setPendingIndex(null)
      return
    }
    if (loadedSrcs.current.has(bannerSrcFor(top6[pendingIndex]))) {
      commitSlide(pendingIndex)
    }
  }, [pendingIndex, loadedTick, top6, bannerSrcFor, commitSlide])

  useEffect(() => {
    if (pendingIndex === null) return
    if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current)
    const target = pendingIndex
    pendingTimer.current = window.setTimeout(() => {
      pendingTimer.current = null
      commitSlide(target)
    }, 2500)
    return () => {
      if (pendingTimer.current !== null) {
        window.clearTimeout(pendingTimer.current)
        pendingTimer.current = null
      }
    }
  }, [pendingIndex, commitSlide])

  const selectSlide = useCallback(
    (index: number) => {
      requestSlide(index)
    },
    [requestSlide]
  )

  const nextSlide = useCallback(() => {
    requestSlide(currentIndexRef.current + 1)
  }, [requestSlide])

  const prevSlide = useCallback(() => {
    requestSlide(currentIndexRef.current - 1)
  }, [requestSlide])

  const segmentsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = segmentsRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && Math.abs(e.deltaY) > 5) {
        e.preventDefault()
        e.stopPropagation()
        const now = Date.now()
        if (now - lastScrollTime.current < 300) return
        lastScrollTime.current = now
        resetAutoplay()
        if (e.deltaY > 0) nextSlide()
        else prevSlide()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [top6.length, nextSlide, prevSlide, resetAutoplay])

  useEffect(() => {
    if (top6.length === 0 || isPaused) return
    const timer = setTimeout(nextSlide, AUTOPLAY_MS)
    return () => clearTimeout(timer)
  }, [currentIndex, nextSlide, top6.length, autoplayResetKey, isPaused])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        nextSlide()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prevSlide()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [nextSlide, prevSlide])

  useEffect(() => {
    if (currentIndex >= top6.length) {
      setCurrentIndex(0)
    }
  }, [top6.length, currentIndex])

  if (top6.length === 0) return null

  const safeIndex = currentIndex >= top6.length ? 0 : currentIndex
  currentIndexRef.current = safeIndex

  const handleWatch = (item: TvSpotlightItem) => {
    navigate(tvDetailPath(item.type, item.id))
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touchEndX = e.changedTouches[0].clientX
    const deltaX = touchEndX - touchStartX.current
    if (Math.abs(deltaX) > 50) {
      resetAutoplay()
      if (deltaX > 0) prevSlide()
      else nextSlide()
    }
  }

  return (
    <div
      className={styles.bannerContainer}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div
        className={`${styles.hero} ${isPaused ? styles.paused : ''}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {ambient.front && (
          <img
            src={ambient.front}
            alt=""
            aria-hidden="true"
            className={`${styles.ambient} ${!ambient.flip ? styles.ambientShow : ''}`}
          />
        )}
        {ambient.back && (
          <img
            src={ambient.back}
            alt=""
            aria-hidden="true"
            className={`${styles.ambient} ${ambient.flip ? styles.ambientShow : ''}`}
          />
        )}
        <div className={styles.scrim} aria-hidden="true" />

        {top6.length > 1 && (
          <div className={styles.segments} ref={segmentsRef}>
            {top6.map((_, index) => (
              <i
                key={`${autoplayResetKey}-${index}`}
                className={`${index < safeIndex ? styles.done : ''} ${index === safeIndex ? styles.live : ''}`}
                onClick={() => selectSlide(index)}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
        )}

        <div className={styles.viewport}>
          <div className={styles.track} style={{ transform: `translateX(-${safeIndex * 100}%)` }}>
            {top6.map((item, index) => {
              const genres = item.genre_ids
                .slice(0, 3)
                .map((id) => GENRE_NAMES[id])
                .filter(Boolean)
              const metadata = [item.type === 'tv' ? 'TV Show' : 'Movie', item.year].filter(Boolean)
              return (
                <div
                  key={item.id}
                  className={`${styles.slide} ${index === safeIndex ? styles.active : ''}`}
                  aria-hidden={index !== safeIndex}
                >
                  <div className={styles.slideInner}>
                    <img
                      src={item.image}
                      alt={item.title}
                      className={styles.poster}
                      decoding="async"
                    />
                    <div className={styles.info}>
                      <div className={`${styles.kicker} ${styles.rise}`}>
                        <span className={styles.featureLabel}>Spotlight</span>
                        {item.vote_average > 0 && (
                          <span className={styles.scoreChip}>
                            <Icon name="star" size={12} />
                            <span>{Number(item.vote_average).toFixed(1)}</span>
                          </span>
                        )}
                      </div>
                      <button
                        className={`${styles.title} ${styles.rise}`}
                        onClick={() => handleWatch(item)}
                        tabIndex={index === safeIndex ? 0 : -1}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          textAlign: 'left',
                        }}
                      >
                        {item.title}
                      </button>
                      <div className={`${styles.metaRow} ${styles.rise}`}>
                        {metadata.map((m, idx) => (
                          <React.Fragment key={idx}>
                            <span className={styles.metaItem}>{m}</span>
                            {idx < metadata.length - 1 && <div className={styles.metaDivider} />}
                          </React.Fragment>
                        ))}
                      </div>
                      {genres.length > 0 && (
                        <div className={`${styles.genres} ${styles.rise}`}>
                          {genres.map((g) => (
                            <span key={g} className={styles.genreTag}>
                              {g}
                            </span>
                          ))}
                        </div>
                      )}
                      {item.overview && (
                        <p className={`${styles.summary} ${styles.rise}`}>
                          {item.overview.length > 200
                            ? item.overview.slice(0, 200) + '...'
                            : item.overview}
                        </p>
                      )}
                      <div className={`${styles.actions} ${styles.rise}`}>
                        <button
                          className={styles.watchBtn}
                          onClick={() => handleWatch(item)}
                          tabIndex={index === safeIndex ? 0 : -1}
                        >
                          <Icon name="play" size={14} />
                          <span>Watch Now</span>
                        </button>
                        <button
                          className={styles.detailsBtn}
                          onClick={() => navigate(tvDetailPath(item.type, item.id))}
                          tabIndex={index === safeIndex ? 0 : -1}
                        >
                          <Icon name="info-circle" size={15} />
                          <span>Details</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {top6.length > 1 && (
          <>
            <button
              className={`${styles.navArrow} ${styles.prevArrow}`}
              onClick={() => {
                resetAutoplay()
                prevSlide()
              }}
              aria-label="Previous slide"
            >
              <Icon name="chevron-left" size={20} />
            </button>
            <button
              className={`${styles.navArrow} ${styles.nextArrow}`}
              onClick={() => {
                resetAutoplay()
                nextSlide()
              }}
              aria-label="Next slide"
            >
              <Icon name="chevron-right" size={20} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default TvSpotlightBanner
