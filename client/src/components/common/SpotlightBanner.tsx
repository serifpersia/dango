import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router'
import Icon, { type IconName } from './Icon'
import FadeImage from './FadeImage'
import SectionSelect from './SectionSelect'
import styles from './SpotlightBanner.module.css'

export interface SpotlightSlide {
  key: string
  bannerSrc: string
  posterSrc: string
  posterAlt: string
  title: string
  detailTo: string
  score?: string | number | null
  metaItems: string[]
  tags: string[]
  synopsis: string
  primaryLabel: string
  primaryIcon: IconName
  onPrimary: () => void
  onDetails: () => void
  onWatchlist?: () => void
}

interface SpotlightSelector {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}

interface SpotlightBannerProps {
  slides: SpotlightSlide[]
  posterAspect?: 'portrait' | 'landscape'
  eyebrow?: string
  selector?: SpotlightSelector
}

const AUTOPLAY_MS = 8000

const hasScore = (score: SpotlightSlide['score']) =>
  score !== undefined && score !== null && score !== ''

export const SpotlightSkeleton: React.FC = () => (
  <div className={`${styles.bannerContainer} ${styles.skeleton} skeleton`} />
)

const SpotlightBanner: React.FC<SpotlightBannerProps> = ({
  slides,
  posterAspect = 'portrait',
  eyebrow = 'Spotlight',
  selector,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [autoplayResetKey, setAutoplayResetKey] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [hasFocus, setHasFocus] = useState(false)
  const [autoplayEnabled, setAutoplayEnabled] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  const [pendingIndex, setPendingIndex] = useState<number | null>(null)
  const [loadedTick, setLoadedTick] = useState(0)
  const [ambient, setAmbient] = useState({ front: '', back: '', flip: false })
  const lastScrollTime = useRef(0)
  const touchStartX = useRef<number>(0)
  const loadedSrcs = useRef<Set<string>>(new Set())
  const pendingTimer = useRef<number | null>(null)
  const currentIndexRef = useRef(0)

  const bannerSrcFor = useCallback((slide: SpotlightSlide) => slide.bannerSrc, [])

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
      const src = bannerSrcFor(slides[index])
      setAmbient((prev) =>
        prev.flip
          ? { front: src, back: prev.back, flip: false }
          : { front: prev.front, back: src, flip: true }
      )
      setCurrentIndex(index)
    },
    [resetAutoplay, slides, bannerSrcFor]
  )

  const requestSlide = useCallback(
    (index: number) => {
      if (slides.length === 0) return
      const target = ((index % slides.length) + slides.length) % slides.length
      if (loadedSrcs.current.has(bannerSrcFor(slides[target]))) {
        commitSlide(target)
      } else {
        setPendingIndex(target)
      }
    },
    [slides, bannerSrcFor, commitSlide]
  )

  useEffect(() => {
    let cancelled = false
    slides.forEach((slide) => {
      const src = bannerSrcFor(slide)
      if (!src || loadedSrcs.current.has(src)) return
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
  }, [slides, bannerSrcFor])

  useEffect(() => {
    if (slides.length === 0) return
    if (!ambient.front) {
      const src = bannerSrcFor(slides[0])
      setAmbient({ front: src, back: '', flip: false })
    }
  }, [slides, ambient.front, bannerSrcFor])

  useEffect(() => {
    if (pendingIndex === null) return
    if (pendingIndex < 0 || pendingIndex >= slides.length) {
      setPendingIndex(null)
      return
    }
    if (loadedSrcs.current.has(bannerSrcFor(slides[pendingIndex]))) {
      commitSlide(pendingIndex)
    }
  }, [pendingIndex, loadedTick, slides, bannerSrcFor, commitSlide])

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

  const dotsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = dotsRef.current
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
  }, [slides.length, nextSlide, prevSlide, resetAutoplay])

  useEffect(() => {
    if (slides.length < 2 || isPaused || hasFocus || !autoplayEnabled) return
    const timer = setTimeout(nextSlide, AUTOPLAY_MS)
    return () => clearTimeout(timer)
  }, [
    currentIndex,
    nextSlide,
    slides.length,
    autoplayResetKey,
    isPaused,
    hasFocus,
    autoplayEnabled,
  ])

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
    if (currentIndex >= slides.length) {
      setCurrentIndex(0)
    }
  }, [slides.length, currentIndex])

  if (slides.length === 0) return null

  const safeIndex = currentIndex >= slides.length ? 0 : currentIndex
  currentIndexRef.current = safeIndex

  const handleTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    touchStartX.current = e.touches[0].clientX
  }

  const handleTouchEnd = (e: React.TouchEvent<HTMLElement>) => {
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
      onFocusCapture={() => setHasFocus(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHasFocus(false)
      }}
      role="region"
      aria-label={eyebrow}
      aria-roledescription="carousel"
    >
      <div
        className={`${styles.hero} ${isPaused || hasFocus || !autoplayEnabled ? styles.paused : ''}`}
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

        <div className={styles.viewport}>
          <div className={styles.track} style={{ transform: `translateX(-${safeIndex * 100}%)` }}>
            {slides.map((slide, index) => (
              <div
                key={slide.key}
                className={`${styles.slide} ${index === safeIndex ? styles.active : ''}`}
                aria-hidden={index !== safeIndex}
              >
                <div
                  className={`${styles.slideInner} ${
                    posterAspect === 'landscape' ? styles.slideInnerLandscape : ''
                  }`}
                >
                  <Link
                    to={slide.detailTo}
                    className={`${styles.posterStage} ${posterAspect === 'landscape' ? styles.landscapeStage : ''}`}
                    aria-label={`View details for ${slide.title}`}
                    tabIndex={index === safeIndex ? 0 : -1}
                  >
                    <FadeImage
                      src={slide.posterSrc}
                      alt={slide.posterAlt}
                      className={
                        posterAspect === 'landscape' ? styles.posterLandscape : styles.poster
                      }
                      decoding="async"
                    />
                    <span className={styles.posterCaption} aria-hidden="true">
                      <span>{slide.metaItems[0] || eyebrow}</span>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                    </span>
                  </Link>
                  <div className={styles.info}>
                    <h1
                      className={`${styles.title} ${slide.title.length > 40 ? styles.titleLong : ''} ${styles.rise}`}
                    >
                      <Link
                        to={slide.detailTo}
                        className={styles.titleLink}
                        aria-label={`View details for ${slide.title}`}
                        tabIndex={index === safeIndex ? 0 : -1}
                      >
                        {slide.title}
                      </Link>
                    </h1>
                    {slide.metaItems.length > 0 && (
                      <div className={`${styles.metaRow} ${styles.rise}`}>
                        {slide.metaItems.map((item, idx) => (
                          <React.Fragment key={idx}>
                            <span className={styles.metaItem}>{item}</span>
                            {idx < slide.metaItems.length - 1 && (
                              <div className={styles.metaDivider} />
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                    {(slide.tags.length > 0 || hasScore(slide.score)) && (
                      <div className={`${styles.genres} ${styles.rise}`}>
                        {slide.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className={styles.genreTag}>
                            {tag}
                          </span>
                        ))}
                        {hasScore(slide.score) && (
                          <span className={styles.scoreChip}>
                            <Icon name="star" size={12} />
                            <span>{slide.score}</span>
                          </span>
                        )}
                      </div>
                    )}
                    {slide.synopsis && (
                      <p className={`${styles.summary} ${styles.rise}`}>{slide.synopsis}</p>
                    )}
                    <div className={`${styles.actions} ${styles.rise}`}>
                      <button
                        className={styles.watchBtn}
                        onClick={slide.onPrimary}
                        tabIndex={index === safeIndex ? 0 : -1}
                      >
                        <Icon name={slide.primaryIcon} size={14} />
                        <span>{slide.primaryLabel}</span>
                      </button>
                      <div className={styles.secondaryRow}>
                        <button
                          className={styles.detailsBtn}
                          onClick={slide.onDetails}
                          tabIndex={index === safeIndex ? 0 : -1}
                        >
                          <Icon name="info-circle" size={15} />
                          <span>Details</span>
                        </button>
                        {slide.onWatchlist && (
                          <button
                            className={styles.secondaryBtn}
                            onClick={slide.onWatchlist}
                            tabIndex={index === safeIndex ? 0 : -1}
                          >
                            <Icon name="plus" size={14} />
                            <span>Watchlist</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {(slides.length > 1 || selector) && (
          <div className={styles.carouselFooter}>
            {selector && (
              <div className={styles.sourcePicker}>
                <SectionSelect
                  ariaLabel={selector.label}
                  value={selector.value}
                  options={selector.options}
                  onChange={selector.onChange}
                />
              </div>
            )}
            {slides.length > 1 && (
              <div className={styles.slideSelector}>
                <span className={styles.slideCount} aria-hidden="true">
                  <span>{String(safeIndex + 1).padStart(2, '0')}</span>
                  <span>/ {String(slides.length).padStart(2, '0')}</span>
                </span>
                <div className={styles.dots} ref={dotsRef} aria-label="Spotlight slides">
                  {slides.map((slide, index) => (
                    <button
                      key={slide.key}
                      type="button"
                      aria-pressed={index === safeIndex}
                      aria-label={`Go to slide ${index + 1}: ${slide.title}`}
                      className={`${styles.dot} ${index === safeIndex ? styles.dotActive : ''}`}
                      onClick={() => selectSlide(index)}
                    >
                      <span
                        className={styles.dotProgress}
                        aria-hidden="true"
                        key={`progress-${autoplayResetKey}-${safeIndex}`}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {slides.length > 1 && (
              <div className={styles.slideControls}>
                <button
                  type="button"
                  className={styles.autoplayBtn}
                  onClick={() => {
                    setAutoplayEnabled((enabled) => !enabled)
                    resetAutoplay()
                  }}
                  aria-label={autoplayEnabled ? 'Pause slideshow' : 'Play slideshow'}
                >
                  <Icon name={autoplayEnabled ? 'pause' : 'play'} size={12} />
                </button>
                <button
                  type="button"
                  className={styles.navArrow}
                  onClick={prevSlide}
                  aria-label="Previous slide"
                >
                  <Icon name="chevron-left" size={15} />
                </button>
                <button
                  type="button"
                  className={styles.navArrow}
                  onClick={nextSlide}
                  aria-label="Next slide"
                >
                  <Icon name="chevron-right" size={15} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default SpotlightBanner
