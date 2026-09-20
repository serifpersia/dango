import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, Link } from 'react-router'
import Icon from '../common/Icon'
import type { Anime } from '../../hooks/useAnimeData'
import { fixThumbnailUrl, sanitizeText } from '../../lib/utils'
import styles from './SpotlightBanner.module.css'
import { useTitlePreference } from '../../contexts/TitlePreferenceContext'

interface SpotlightBannerProps {
  animeList: Anime[]
}

const AUTOPLAY_MS = 8000

const SpotlightBanner: React.FC<SpotlightBannerProps> = ({ animeList }) => {
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
  const { titlePreference } = useTitlePreference()
  const navigate = useNavigate()
  const top6 = useMemo(() => animeList.slice(0, 6), [animeList])

  const bannerSrcFor = useCallback(
    (anime: Anime) =>
      anime.bannerImage
        ? fixThumbnailUrl(anime.bannerImage, 1280, 560)
        : fixThumbnailUrl(anime.thumbnail, 1280, 450),
    []
  )

  const getTitle = (anime: Anime) => {
    switch (titlePreference) {
      case 'nativeName':
        return anime.nativeName || anime.name
      case 'englishName':
        return anime.englishName || anime.name
      default:
        return anime.name
    }
  }

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
      setAmbient((prev) => ({
        front: src,
        back: prev.front || src,
        flip: !prev.flip,
      }))
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
    top6.forEach((anime) => {
      const src = bannerSrcFor(anime)
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

  const handleWatch = (id: string) => {
    navigate(`/watch/${id}`)
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
            {top6.map((anime, index) => {
              const synopsis = sanitizeText(anime.description ?? '')
              const genres = anime.genres ?? []
              const metadata = [
                anime.type || 'Anime',
                anime.status,
                anime.episodeCount ? `${anime.episodeCount} Episodes` : undefined,
                anime.rating,
              ].filter(Boolean)
              return (
                <div
                  key={anime._id}
                  className={`${styles.slide} ${index === safeIndex ? styles.active : ''}`}
                  aria-hidden={index !== safeIndex}
                >
                  <img
                    src={fixThumbnailUrl(anime.thumbnail, 460, 650)}
                    alt={getTitle(anime)}
                    className={styles.poster}
                    decoding="async"
                  />
                  <div className={styles.info}>
                    <div className={`${styles.kicker} ${styles.rise}`}>
                      <span className={styles.featureLabel}>Spotlight</span>
                      {anime.score && (
                        <span className={styles.scoreChip}>
                          <Icon name="star" size={12} />
                          <span>{anime.score}</span>
                        </span>
                      )}
                    </div>
                    <Link
                      to={`/anime/${anime._id}`}
                      className={`${styles.title} ${styles.rise}`}
                      aria-label={`View details for ${getTitle(anime)}`}
                      tabIndex={index === safeIndex ? 0 : -1}
                    >
                      {getTitle(anime)}
                    </Link>
                    <div className={`${styles.metaRow} ${styles.rise}`}>
                      {metadata.map((item, idx) => (
                        <React.Fragment key={idx}>
                          <span className={styles.metaItem}>{item}</span>
                          {idx < metadata.length - 1 && <div className={styles.metaDivider} />}
                        </React.Fragment>
                      ))}
                    </div>
                    {genres.length > 0 && (
                      <div className={`${styles.genres} ${styles.rise}`}>
                        {genres.slice(0, 3).map((g) => {
                          const genreName = typeof g === 'string' ? g : g?.name
                          return (
                            <span key={genreName} className={styles.genreTag}>
                              {genreName}
                            </span>
                          )
                        })}
                      </div>
                    )}
                    {synopsis && <p className={`${styles.summary} ${styles.rise}`}>{synopsis}</p>}
                    <div className={`${styles.actions} ${styles.rise}`}>
                      <button
                        className={styles.watchBtn}
                        onClick={() => handleWatch(anime._id)}
                        tabIndex={index === safeIndex ? 0 : -1}
                      >
                        <Icon name="play" size={14} />
                        <span>Watch Now</span>
                      </button>
                      <button
                        className={styles.detailsBtn}
                        onClick={() => navigate(`/anime/${anime._id}`)}
                        tabIndex={index === safeIndex ? 0 : -1}
                      >
                        <Icon name="info-circle" size={15} />
                        <span>Details</span>
                      </button>
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

export default SpotlightBanner
