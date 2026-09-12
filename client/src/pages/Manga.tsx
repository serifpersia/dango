import React, { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { FaBook, FaSearch } from 'react-icons/fa'
import ToggleSwitch from '../components/common/ToggleSwitch'
import GenericModal from '../components/common/GenericModal'
import { Button } from '../components/common/Button'
import ErrorMessage from '../components/common/ErrorMessage'
import MangaCard from '../components/manga/MangaCard'
import MangaDetail from '../components/manga/MangaDetail'
import MangaReader from '../components/manga/MangaReader'
import {
  useMangaBrowse,
  useMangaDetail,
  type MangaCard as MangaCardType,
  type MangaChapter,
  type MangaProviderName,
} from '../hooks/useManga'
import { hideVirtualKeyboard } from '../hooks/useVirtualKeyboard'
import styles from '../components/manga/Manga.module.css'

const PROVIDERS: { value: MangaProviderName; label: string }[] = [
  { value: 'mangadex', label: 'MangaDex' },
  { value: 'mangapill', label: 'MangaPill' },
]

const DEX_SORTS = [
  { value: 'popular', label: 'Popular' },
  { value: 'latest', label: 'Latest' },
  { value: 'rating', label: 'Top Rated' },
  { value: 'followed', label: 'Most Followed' },
]

const DEX_STATUS = [
  { value: '', label: 'Any Status' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
  { value: 'hiatus', label: 'Hiatus' },
  { value: 'cancelled', label: 'Cancelled' },
]

const PILL_STATUS = [
  { value: '', label: 'Any Status' },
  { value: 'publishing', label: 'Publishing' },
  { value: 'finished', label: 'Finished' },
  { value: 'on hiatus', label: 'On Hiatus' },
  { value: 'discontinued', label: 'Discontinued' },
]

const PILL_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'manga', label: 'Manga' },
  { value: 'novel', label: 'Novel' },
  { value: 'one-shot', label: 'One-Shot' },
  { value: 'doujinshi', label: 'Doujinshi' },
]

const SAFE_RATINGS = [{ value: 'safe', label: 'Safe' }]
const FULL_RATINGS = [
  { value: 'safe', label: 'Safe' },
  { value: 'suggestive', label: 'Suggestive' },
  { value: 'erotica', label: 'Erotica' },
  { value: 'pornographic', label: 'Pornographic' },
]

const MATURE_CONSENT_KEY = 'agreedToViewMature'

export default function Manga() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [hasConsent, setHasConsent] = useState(
    () => localStorage.getItem(MATURE_CONSENT_KEY) === 'true'
  )
  const [showMatureModal, setShowMatureModal] = useState(false)
  const [queryInput, setQueryInput] = useState(searchParams.get('q') || '')

  const provider = (searchParams.get('provider') as MangaProviderName) || 'mangadex'
  const query = searchParams.get('q') || ''
  const page = parseInt(searchParams.get('page') || '1')
  const sort = searchParams.get('sort') || 'popular'
  const status = searchParams.get('status') || ''
  const type = searchParams.get('type') || ''
  const rating = searchParams.get('rating') || 'safe'
  const mangaId = searchParams.get('id') || ''
  const chapterId = searchParams.get('chapter') || ''

  useEffect(() => {
    document.title = 'Manga - dango'
  }, [])

  useEffect(() => {
    const sync = () => setHasConsent(localStorage.getItem(MATURE_CONSENT_KEY) === 'true')
    window.addEventListener('focus', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('focus', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const showMature = hasConsent
  const activeRating = showMature ? rating : 'safe'
  const ratingOptions = showMature ? FULL_RATINGS : SAFE_RATINGS

  const update = (patch: Record<string, string>, resetPage = false) => {
    const next = new URLSearchParams(searchParams)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (resetPage) next.delete('page')
    setSearchParams(next)
  }

  const browse = useMangaBrowse({
    provider,
    query,
    page,
    sort,
    status,
    type,
    rating: activeRating,
    mature: showMature,
  })
  const items = (browse.data?.items ?? []) as MangaCardType[]
  const hasNext = browse.data?.hasNext ?? false

  const detailQuery = useMangaDetail(
    mangaId ? provider : null,
    mangaId || null,
    activeRating,
    showMature
  )
  const detail = detailQuery.data
  const activeChapter: MangaChapter | null =
    detail && chapterId ? (detail.chapters.find((c) => c.id === chapterId) ?? null) : null

  const discordSessionRef = useRef<string>('')
  if (!discordSessionRef.current) {
    discordSessionRef.current = `manga-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  useEffect(() => {
    if (!detail || !activeChapter) {
      fetch('/api/discord/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: 'manga' }),
      }).catch(() => {})
      return
    }
    const isAdult =
      detail.contentRating === 'erotica' ||
      detail.contentRating === 'pornographic' ||
      detail.type === 'doujinshi'
    const send = () => {
      fetch('/api/discord/manga', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: detail.title,
          chapterLabel: `Chapter ${activeChapter.number}`,
          isPlaying: true,
          thumbnail: detail.cover || '',
          thumbnails: [detail.cover].filter(Boolean),
          isAdult,
          sessionId: discordSessionRef.current,
        }),
      }).catch(() => {})
      fetch('/api/discord/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: discordSessionRef.current }),
      }).catch(() => {})
    }
    send()
    const id = window.setInterval(send, 60000)
    return () => window.clearInterval(id)
  }, [detail, activeChapter])

  useEffect(() => {
    if (queryInput !== query) setQueryInput(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    hideVirtualKeyboard()
    update({ q: queryInput }, true)
  }

  const handleMatureToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked && !hasConsent) {
      setShowMatureModal(true)
    }
  }

  const handleAcceptMature = () => {
    localStorage.setItem(MATURE_CONSENT_KEY, 'true')
    setHasConsent(true)
    setShowMatureModal(false)
    update({}, true)
  }

  const handleDeclineMature = () => {
    setShowMatureModal(false)
  }

  const handleSelect = (item: MangaCardType) => {
    const next = new URLSearchParams(searchParams)
    if (item.provider !== provider) next.set('provider', item.provider)
    next.set('id', item.id)
    next.delete('chapter')
    setSearchParams(next)
  }

  const handleBackToBrowse = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('id')
    next.delete('chapter')
    setSearchParams(next)
  }

  const handleBackToDetail = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('chapter')
    setSearchParams(next)
  }

  const handleOpenChapter = (ch: MangaChapter) => {
    if (ch.externalUrl) {
      window.open(ch.externalUrl, '_blank', 'noopener,noreferrer')
      return
    }
    const next = new URLSearchParams(searchParams)
    next.set('chapter', ch.id)
    setSearchParams(next)
  }

  const statusOptions = provider === 'mangapill' ? PILL_STATUS : DEX_STATUS
  const showTypeSelect = provider === 'mangapill'
  const showRatingSelect = provider === 'mangadex'

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>
          <FaBook /> Manga
        </h1>
        <form className={styles.searchForm} onSubmit={handleSearch}>
          <input
            className={styles.searchInput}
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Search manga titles..."
            aria-label="Search manga"
          />
          <button className={styles.searchBtn} type="submit" aria-label="Search">
            <FaSearch size={14} />
          </button>
        </form>
        <select
          className={styles.select}
          value={provider}
          onChange={(e) => {
            const next = new URLSearchParams(searchParams)
            next.set('provider', e.target.value)
            next.delete('page')
            next.delete('id')
            next.delete('chapter')
            next.delete('status')
            next.delete('type')
            setSearchParams(next)
          }}
          aria-label="Manga provider"
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {!mangaId && (
        <div className={styles.filterRow}>
          {provider === 'mangadex' && (
            <select
              className={styles.select}
              value={sort}
              onChange={(e) => update({ sort: e.target.value }, true)}
              aria-label="Sort manga"
            >
              {DEX_SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <select
            className={styles.select}
            value={status}
            onChange={(e) => update({ status: e.target.value }, true)}
            aria-label="Filter by status"
          >
            {statusOptions.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {showTypeSelect && (
            <select
              className={styles.select}
              value={type}
              onChange={(e) => update({ type: e.target.value }, true)}
              aria-label="Filter by type"
            >
              {PILL_TYPES.filter((o) => o.value !== 'doujinshi' || showMature).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {showRatingSelect && (
            <select
              className={styles.select}
              value={activeRating}
              onChange={(e) => update({ rating: e.target.value }, true)}
              aria-label="Content rating"
            >
              {ratingOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {!hasConsent && (
            <div className={styles.matureToggleWrap}>
              <label className={styles.matureLabel} htmlFor="manga-mature-toggle">
                Mature
              </label>
              <ToggleSwitch
                id="manga-mature-toggle"
                isChecked={false}
                onChange={handleMatureToggle}
              />
            </div>
          )}
        </div>
      )}

      {mangaId && chapterId && detail && activeChapter ? (
        <MangaReader
          provider={provider}
          mangaTitle={detail.title}
          chapter={activeChapter}
          chapters={detail.chapters}
          onBack={handleBackToDetail}
          onOpenChapter={handleOpenChapter}
        />
      ) : mangaId ? (
        detailQuery.isLoading ? (
          <div aria-hidden>
            <div
              className={`${styles.skeletonThumb} ${styles.shimmer}`}
              style={{ maxWidth: '12rem' }}
            />
            <div className={`${styles.skeletonLine} ${styles.shimmer}`} style={{ width: '40%' }} />
            <div className={`${styles.skeletonLine} ${styles.shimmer}`} style={{ width: '70%' }} />
          </div>
        ) : detailQuery.isError || !detail ? (
          <ErrorMessage message="Failed to load this title. Please try again." />
        ) : (
          <MangaDetail
            detail={detail}
            onBack={handleBackToBrowse}
            onOpenChapter={handleOpenChapter}
          />
        )
      ) : browse.isError ? (
        <ErrorMessage message="Failed to load manga. Please try again." />
      ) : browse.isLoading && items.length === 0 ? (
        <div className={styles.grid} aria-hidden>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className={styles.skeletonCard}>
              <div className={`${styles.skeletonThumb} ${styles.shimmer}`} />
              <div
                className={`${styles.skeletonLine} ${styles.shimmer}`}
                style={{ width: '88%' }}
              />
              <div
                className={`${styles.skeletonLine} ${styles.shimmer}`}
                style={{ width: '55%' }}
              />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className={styles.statusMsg}>No titles found. Try another search or provider.</p>
      ) : (
        <>
          <div className={`${styles.grid} ${browse.isFetching ? styles.fetching : ''}`}>
            {items.map((item) => (
              <MangaCard key={`${item.provider}-${item.id}`} item={item} onSelect={handleSelect} />
            ))}
          </div>
          <nav className={styles.pagination}>
            <button
              className={styles.pageBtn}
              disabled={page <= 1}
              onClick={() => update({ page: String(page - 1) })}
            >
              Previous
            </button>
            <span className={styles.pageIndicator}>Page {page}</span>
            <button
              className={styles.pageBtn}
              disabled={!hasNext}
              onClick={() => update({ page: String(page + 1) })}
            >
              Next
            </button>
          </nav>
        </>
      )}

      {showMatureModal && (
        <GenericModal
          isOpen={showMatureModal}
          title="Content Warning"
          onClose={handleDeclineMature}
        >
          <div style={{ padding: 'var(--space-4)', textAlign: 'center' }}>
            <p>This section contains mature content intended for adult audiences.</p>
            <p>
              By proceeding, you confirm that you are <strong>18 years of age or older</strong> (or
              the age of majority in your jurisdiction) and wish to view this content.
            </p>
            <p
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--text-secondary)',
                marginTop: 'var(--space-4)',
              }}
            >
              You can reset this preference at any time in the <strong>Settings</strong> page.
            </p>
            <div
              style={{
                marginTop: 'var(--space-4)',
                display: 'flex',
                gap: 'var(--space-2-5)',
                justifyContent: 'center',
              }}
            >
              <Button variant="secondary" onClick={handleDeclineMature}>
                Go Back
              </Button>
              <Button onClick={handleAcceptMature}>I'm 18+, Continue</Button>
            </div>
          </div>
        </GenericModal>
      )}
    </div>
  )
}
