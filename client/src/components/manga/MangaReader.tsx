import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FaChevronLeft, FaChevronRight, FaSyncAlt } from 'react-icons/fa'
import { useQueryClient } from '@tanstack/react-query'
import type { MangaChapter } from '../../hooks/useManga'
import { mangaPageSrc, useMangaPages } from '../../hooks/useManga'
import type { MangaProviderName } from '../../hooks/useManga'
import styles from './Manga.module.css'

interface MangaReaderProps {
  provider: MangaProviderName
  mangaTitle: string
  chapter: MangaChapter
  chapters: MangaChapter[]
  onBack: () => void
  onOpenChapter: (chapter: MangaChapter) => void
}

type ReadMode = 'strip' | 'page'
type FitMode = 'width' | 'height'

const MODE_KEY = 'mangaReadMode'
const FIT_KEY = 'mangaFitMode'

function loadMode(): ReadMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'page' ? 'page' : 'strip'
  } catch {
    return 'strip'
  }
}

function loadFit(): FitMode {
  try {
    return localStorage.getItem(FIT_KEY) === 'height' ? 'height' : 'width'
  } catch {
    return 'width'
  }
}

const MangaReader: React.FC<MangaReaderProps> = ({
  provider,
  mangaTitle,
  chapter,
  chapters,
  onBack,
  onOpenChapter,
}) => {
  const [mode, setMode] = useState<ReadMode>(loadMode)
  const [fit, setFit] = useState<FitMode>(loadFit)
  const [pageIndex, setPageIndex] = useState(0)
  const [deadPages, setDeadPages] = useState<Set<number>>(new Set())
  const [retryNonce, setRetryNonce] = useState(0)
  const touchX = useRef<number | null>(null)
  const stripRefs = useRef<Array<HTMLDivElement | null>>([])
  const queryClient = useQueryClient()

  const { data, isLoading, isError } = useMangaPages(provider, chapter.id, true)
  const pages = data?.pages ?? []
  const proxied = pages.map((src) => mangaPageSrc(provider, src))

  const idx = chapters.findIndex((c) => c.id === chapter.id)
  const prev =
    idx > 0 ? ([...chapters.slice(0, idx)].reverse().find((c) => !c.externalUrl) ?? null) : null
  const next = idx >= 0 ? (chapters.slice(idx + 1).find((c) => !c.externalUrl) ?? null) : null

  const goPage = useCallback(
    (dir: 1 | -1) => {
      setPageIndex((i) => {
        const n = i + dir
        if (n < 0) {
          if (prev) onOpenChapter(prev)
          return 0
        }
        if (n >= pages.length) {
          if (next) onOpenChapter(next)
          return i
        }
        return n
      })
    },
    [pages.length, prev, next, onOpenChapter]
  )

  useEffect(() => {
    setPageIndex(0)
    setDeadPages(new Set())
    stripRefs.current = []
    window.scrollTo(0, 0)
  }, [chapter.id])

  useEffect(() => {
    document.title = `${mangaTitle} Ch. ${chapter.number} - dango`
  }, [mangaTitle, chapter.number])

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      // ignore
    }
  }, [mode])
  useEffect(() => {
    try {
      localStorage.setItem(FIT_KEY, fit)
    } catch {
      // ignore
    }
  }, [fit])

  useEffect(() => {
    if (mode === 'page') window.scrollTo(0, 0)
  }, [mode])

  useEffect(() => {
    if (mode !== 'page' || pages.length === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        goPage(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPage(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, pages.length, goPage])

  useEffect(() => {
    if (mode !== 'strip' || pages.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const i = Number((entry.target as HTMLElement).dataset.pageIndex)
            if (!Number.isNaN(i)) setPageIndex(i)
          }
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    )
    stripRefs.current.forEach((el) => el && observer.observe(el))
    return () => observer.disconnect()
  }, [mode, pages.length, data])

  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0].clientX
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return
    const dx = e.changedTouches[0].clientX - touchX.current
    touchX.current = null
    if (Math.abs(dx) < 50) return
    goPage(dx < 0 ? 1 : -1)
  }

  const openChapter = (ch: MangaChapter | null) => {
    if (ch) onOpenChapter(ch)
  }

  const handleImgError = (i: number) =>
    setDeadPages((prev) => {
      if (prev.has(i)) return prev
      const nextSet = new Set(prev)
      nextSet.add(i)
      return nextSet
    })

  const handleRetryPage = (i: number) => {
    setDeadPages((prev) => {
      const nextSet = new Set(prev)
      nextSet.delete(i)
      return nextSet
    })
    setRetryNonce((n) => n + 1)
  }

  const handleRetryPages = () => {
    setDeadPages(new Set())
    setRetryNonce((n) => n + 1)
    queryClient.invalidateQueries({ queryKey: ['mangaPages', provider, chapter.id] })
  }

  const allFailed = pages.length > 0 && deadPages.size >= pages.length
  const withNonce = (src: string) => (retryNonce > 0 ? `${src}&n=${retryNonce}` : src)

  const renderDeadPage = (i: number) => (
    <div className={styles.deadPage} role="alert">
      <span>Page {i + 1} failed to load</span>
      <button className={styles.pageBtn} onClick={() => handleRetryPage(i)}>
        <FaSyncAlt size={12} /> Retry
      </button>
    </div>
  )

  const fitHeight = fit === 'height'

  return (
    <div className={styles.readerShell}>
      <div className={styles.readerBar}>
        <button className={styles.readerIconBtn} onClick={onBack} aria-label="Back to chapters">
          <FaChevronLeft size={14} />
        </button>
        <span className={styles.readerTitle}>
          {mangaTitle} — Ch. {chapter.number}
          {chapter.title ? ` ${chapter.title}` : ''}
        </span>
        {pages.length > 0 && (
          <span className={styles.readerCounter}>
            {Math.min(pageIndex + 1, pages.length)} / {pages.length}
          </span>
        )}
        <div className={styles.readerSegment} role="group" aria-label="Reading mode">
          <button
            type="button"
            aria-pressed={mode === 'strip'}
            className={mode === 'strip' ? styles.readerSegmentActive : ''}
            onClick={() => setMode('strip')}
          >
            Strip
          </button>
          <button
            type="button"
            aria-pressed={mode === 'page'}
            className={mode === 'page' ? styles.readerSegmentActive : ''}
            onClick={() => setMode('page')}
          >
            Page
          </button>
        </div>
        <div className={styles.readerSegment} role="group" aria-label="Fit mode">
          <button
            type="button"
            aria-pressed={!fitHeight}
            className={!fitHeight ? styles.readerSegmentActive : ''}
            onClick={() => setFit('width')}
            title="Fit width — best for portrait / phones"
          >
            Wide
          </button>
          <button
            type="button"
            aria-pressed={fitHeight}
            className={fitHeight ? styles.readerSegmentActive : ''}
            onClick={() => setFit('height')}
            title="Fit height — best for landscape / desktop"
          >
            Tall
          </button>
        </div>
        <button
          className={styles.readerIconBtn}
          disabled={!prev}
          onClick={() => openChapter(prev)}
          aria-label="Previous chapter"
        >
          <FaChevronLeft size={14} />
        </button>
        <button
          className={styles.readerIconBtn}
          disabled={!next}
          onClick={() => openChapter(next)}
          aria-label="Next chapter"
        >
          <FaChevronRight size={14} />
        </button>
      </div>

      {isError ? (
        <p className={styles.statusMsg}>Failed to load pages. Please try again.</p>
      ) : isLoading ? (
        <div className={styles.readerPages} aria-hidden>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className={`${styles.skeletonThumb} ${styles.shimmer}`}
              style={{ width: '100%', maxWidth: '56rem', aspectRatio: '3 / 4' }}
            />
          ))}
        </div>
      ) : pages.length === 0 ? (
        <p className={styles.statusMsg}>No pages found for this chapter.</p>
      ) : allFailed ? (
        <div className={styles.failedBox}>
          <p className={styles.statusMsg}>Page images failed to load (expired or blocked links).</p>
          <button className={styles.pageBtn} onClick={handleRetryPages}>
            <FaSyncAlt size={12} /> Reload pages
          </button>
        </div>
      ) : mode === 'strip' ? (
        <div className={`${styles.readerPages} ${fitHeight ? styles.readerPagesTall : ''}`}>
          {proxied.map((src, i) => (
            <div
              key={`${i}-${pages[i].slice(-32)}`}
              ref={(el) => {
                stripRefs.current[i] = el
              }}
              data-page-index={i}
              className={styles.readerPageWrap}
            >
              {deadPages.has(i) ? (
                renderDeadPage(i)
              ) : (
                <img
                  className={styles.readerPage}
                  src={withNonce(src)}
                  alt={`Page ${i + 1}`}
                  loading={i < 3 ? 'eager' : 'lazy'}
                  draggable={false}
                  onError={() => handleImgError(i)}
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div
            className={`${styles.pageView} ${fitHeight ? styles.pageViewTall : ''}`}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <button
              className={`${styles.tapZone} ${styles.tapZoneLeft}`}
              onClick={() => goPage(-1)}
              aria-label="Previous page"
            >
              <span className={styles.tapChevron}>
                <FaChevronLeft size={16} />
              </span>
            </button>
            {deadPages.has(pageIndex) ? (
              renderDeadPage(pageIndex)
            ) : (
              <img
                key={`${pageIndex}-${pages[pageIndex].slice(-32)}`}
                className={styles.pageImage}
                src={withNonce(proxied[pageIndex])}
                alt={`Page ${pageIndex + 1} of ${pages.length}`}
                draggable={false}
                onError={() => handleImgError(pageIndex)}
              />
            )}
            <button
              className={`${styles.tapZone} ${styles.tapZoneRight}`}
              onClick={() => goPage(1)}
              aria-label="Next page"
            >
              <span className={styles.tapChevron}>
                <FaChevronRight size={16} />
              </span>
            </button>
          </div>
          <nav className={styles.pagination} aria-label="Page navigation">
            <button className={styles.pageBtn} disabled={pageIndex <= 0} onClick={() => goPage(-1)}>
              Previous page
            </button>
            <span className={styles.pageIndicator}>
              {pageIndex + 1} / {pages.length}
            </span>
            <button
              className={styles.pageBtn}
              disabled={pageIndex >= pages.length - 1}
              onClick={() => goPage(1)}
            >
              Next page
            </button>
          </nav>
        </>
      )}

      {(prev || next) && (
        <nav className={styles.pagination}>
          <button className={styles.pageBtn} disabled={!prev} onClick={() => openChapter(prev)}>
            Previous chapter
          </button>
          <button className={styles.pageBtn} disabled={!next} onClick={() => openChapter(next)}>
            Next chapter
          </button>
        </nav>
      )}
    </div>
  )
}

export default MangaReader
