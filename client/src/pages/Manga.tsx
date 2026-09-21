import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams, Navigate } from 'react-router'
import Icon from '../components/common/Icon'
import ToggleSwitch from '../components/common/ToggleSwitch'
import { Modal } from '../components/common/Modal'
import { Button } from '../components/common/Button'
import ErrorMessage from '../components/common/ErrorMessage'
import MediaCard from '../components/common/MediaCard'
import MangaPopup from '../components/manga/MangaPopup'
import { isMangaAdult, mangaNameVariants } from '../lib/manga'
import {
  useMangaBrowse,
  mangaCoverSrc,
  type MangaCard as MangaCardType,
  type MangaProviderName,
} from '../hooks/useManga'
import { useToggleMangaBookmark, mangaLibraryId } from '../hooks/useMangaLibrary'
import { useMangaPopup } from '../hooks/useMangaPopup'
import { useProviders } from '../hooks/useProviders'
import { hideVirtualKeyboard } from '../hooks/useVirtualKeyboard'
import styles from '../components/manga/Manga.module.css'

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

  const {
    options: serverProviders,
    isLoading: providersLoading,
    refetch: refetchProviders,
  } = useProviders()
  const mangaProviders = useMemo(
    () =>
      serverProviders
        .filter((o) => o.kind === 'manga')
        .map((o) => ({ value: o.value, label: o.label })),
    [serverProviders]
  )
  const urlProvider = (searchParams.get('provider') as MangaProviderName) || ''
  const provider = mangaProviders.some((p) => p.value === urlProvider)
    ? urlProvider
    : (mangaProviders[0]?.value ?? urlProvider)
  const query = searchParams.get('q') || ''
  const page = parseInt(searchParams.get('page') || '1')
  const sort = searchParams.get('sort') || 'popular'
  const status = searchParams.get('status') || ''
  const type = searchParams.get('type') || ''
  const rating = searchParams.get('rating') || 'safe'
  const legacyId = searchParams.get('id') || ''

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

  const { toggle, bookmarkedIds } = useToggleMangaBookmark()
  const { popup, openPopup, scheduleClose, cancelClose, closePopup } = useMangaPopup()

  useEffect(() => {
    if (queryInput !== query) setQueryInput(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  if (legacyId) {
    const params = new URLSearchParams()
    if (showMature && rating !== 'safe') params.set('rating', rating)
    const legacyChapter = searchParams.get('chapter') || ''
    if (legacyChapter) params.set('chapter', legacyChapter)
    const querySuffix = params.toString() ? `?${params.toString()}` : ''
    const target = `/manga/${provider}/${encodeURIComponent(legacyId)}${legacyChapter ? `/read${querySuffix}` : querySuffix}`
    return <Navigate to={target} replace />
  }

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
    const params = new URLSearchParams()
    if (showMature && rating !== 'safe') params.set('rating', rating)
    const suffix = params.toString() ? `?${params.toString()}` : ''
    return `/manga/${item.provider}/${encodeURIComponent(item.id)}${suffix}`
  }

  const statusOptions = provider === 'mangapill' ? PILL_STATUS : DEX_STATUS
  const showTypeSelect = provider === 'mangapill'
  const showRatingSelect = provider === 'mangadex'

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>
          <Icon name="book" /> Manga
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
            <Icon name="search" size={14} />
          </button>
        </form>
        <select
          className={styles.select}
          value={provider}
          disabled={mangaProviders.length === 0}
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
          {mangaProviders.length === 0 ? (
            <option value="">
              {providersLoading ? 'Loading providers…' : 'No providers available'}
            </option>
          ) : (
            mangaProviders.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))
          )}
        </select>
        {mangaProviders.length === 0 && !providersLoading && (
          <button
            className={styles.searchBtn}
            type="button"
            onClick={() => refetchProviders()}
            aria-label="Retry loading providers"
          >
            <Icon name="redo" size={14} />
          </button>
        )}
      </div>

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

      {browse.isError ? (
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
            {items.map((item) => {
              const libId = mangaLibraryId(item.provider, item.id)
              return (
                <MediaCard
                  key={`${item.provider}-${item.id}`}
                  item={{
                    id: libId,
                    title: item.title,
                    ...mangaNameVariants(item),
                    thumbnail: mangaCoverSrc(item.provider, item.cover),
                    typeBadge: item.type || undefined,
                    chapterBadge: item.latestChapter ? `Ch. ${item.latestChapter}` : null,
                    isAdult: isMangaAdult(item),
                  }}
                  linkTo={handleSelect(item)}
                  hoverIcon="info"
                  display={{
                    elements: {
                      poster: { typeBadge: true, chapterBadge: true, adultBadge: true },
                      info: { title: true, mobileBadges: true, progress: false, meta: false },
                    },
                  }}
                  onOpenDetails={(rect) =>
                    openPopup(rect, {
                      provider: item.provider,
                      mangaId: item.id,
                      title: item.title,
                      altTitle: item.altTitle,
                      cover: item.cover,
                      contentRating: item.contentRating,
                      readTarget: handleSelect(item),
                      rating: activeRating,
                      mature: showMature,
                    })
                  }
                  onPopupHoverIntent={(inside) => (inside ? cancelClose() : scheduleClose())}
                  rawThumbnail
                />
              )
            })}
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

      {popup && (
        <MangaPopup
          data={popup.data}
          anchorRect={popup.rect}
          bookmarked={bookmarkedIds.has(mangaLibraryId(popup.data.provider, popup.data.mangaId))}
          onToggleBookmark={() =>
            toggle({
              id: popup.data.mangaId,
              provider: popup.data.provider,
              title: popup.data.title,
              cover: popup.data.cover,
              altTitle: popup.data.altTitle ?? undefined,
              contentRating: popup.data.contentRating,
            })
          }
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onRequestClose={closePopup}
        />
      )}

      {showMatureModal && (
        <Modal isOpen={showMatureModal} title="Content Warning" onClose={handleDeclineMature}>
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
        </Modal>
      )}
    </div>
  )
}
