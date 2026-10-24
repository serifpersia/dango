import { profileStorage } from '../lib/profileStorage'
import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../components/common/Icon'
import { useParams, useNavigate, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import ToggleSwitch from '../components/common/ToggleSwitch'
import MatureConsentModal from '../components/common/MatureConsentModal'
import MediaCard from '../components/common/MediaCard'
import Pagination from '../components/common/Pagination'
import AsmrDetail from '../components/asmr/AsmrDetail'
import AsmrPopup from '../components/asmr/AsmrPopup'
import { useAsmrPopup } from '../hooks/useAsmrPopup'
import { useMatureConsent } from '../hooks/useMatureConsent'
import AsmrPlayer from '../components/asmr/AsmrPlayer'
import JasmrCookieModal from '../components/asmr/JasmrCookieModal'
import { subscribeAuthRequired } from '../lib/auth-bus'
import { useAsmrBrowse, useAsmrWork } from '../hooks/useAsmr'
import { useToggleAsmrBookmark, asmrLibraryId } from '../hooks/useAsmrLibrary'
import { asmrWorkId, isAsmrAdult } from '../lib/asmr'
import { useTranslate } from '../hooks/useTranslate'
import type { AsmrTrack, AsmrWork } from '../hooks/useAsmr'
import styles from '../components/asmr/Asmr.module.css'
import pageStyles from '../components/common/page.module.css'
import { qk } from '../lib/queryKeys'

const SORT_GROUPS = [
  {
    label: 'Date',
    options: [
      { value: 'latest', label: 'Latest' },
      { value: 'oldest', label: 'Oldest' },
    ],
  },
  {
    label: 'Title',
    options: [
      { value: 'title_asc', label: 'A → Z' },
      { value: 'title_desc', label: 'Z → A' },
    ],
  },
  {
    label: 'Popular (Views)',
    options: [
      { value: 'popular_recent', label: 'Recent' },
      { value: 'popular_week', label: 'Week' },
      { value: 'popular_month', label: 'Month' },
      { value: 'popular_6_months', label: '6 Months' },
      { value: 'popular_year', label: 'Year' },
      { value: 'popular', label: 'All Time' },
    ],
  },
  {
    label: 'Most Commented',
    options: [
      { value: 'comments_week', label: 'Week' },
      { value: 'comments_month', label: 'Month' },
      { value: 'comments_year', label: 'Year' },
      { value: 'comments', label: 'All Time' },
    ],
  },
  {
    label: 'Other',
    options: [{ value: 'random', label: 'Random' }],
  },
]

const TYPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'sfw', label: 'SFW / 全年齢' },
  { value: 'r-15', label: 'R-15' },
  { value: 'r-18', label: 'NSFW / R18' },
  { value: 'yuri', label: 'Yuri / Girls love / 百合' },
  { value: 'otokonoko', label: 'Otoko no ko / 男の娘' },
  { value: 'futanari', label: 'Futanari / フタナリ' },
  { value: 'r-18g', label: 'R-18G / グロ' },
]

const SAFE_TYPE_OPTIONS = [{ value: 'sfw', label: 'SFW / 全年齢' }]

const Asmr: React.FC = () => {
  const { rj: rjParam } = useParams<{ rj: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { hasConsent, grant: grantMatureConsent } = useMatureConsent()
  const [showMatureModal, setShowMatureModal] = useState(false)
  const [queryInput, setQueryInput] = useState(() => searchParams.get('q') || '')
  const [query, setQuery] = useState(() => searchParams.get('q') || '')
  const [sort, setSort] = useState('latest')
  const [rating, setRating] = useState('sfw')
  const [page, setPage] = useState(1)
  const [selectedWork, setSelectedWork] = useState<AsmrWork | null>(null)
  const [player, setPlayer] = useState<{
    work: AsmrWork
    tracks: AsmrTrack[]
    index: number
  } | null>(null)
  const [playerExpanded, setPlayerExpanded] = useState(true)
  const [translateEN, setTranslateEN] = useState(
    () => profileStorage.getItem('asmrTranslateEN') === 'true'
  )
  const [showJasmrModal, setShowJasmrModal] = useState(false)
  const queryClient = useQueryClient()
  const { toggle: toggleBookmark, bookmarkedIds } = useToggleAsmrBookmark()
  const { popup, openPopup, scheduleClose, cancelClose, closePopup } = useAsmrPopup()

  useEffect(() => {
    return subscribeAuthRequired('jasmr', () => setShowJasmrModal(true))
  }, [])

  useEffect(() => {
    profileStorage.setItem('asmrTranslateEN', String(translateEN))
  }, [translateEN])

  const showMature = hasConsent

  const activeRating = showMature ? rating : 'sfw'
  const typeOptions = showMature ? TYPE_OPTIONS : SAFE_TYPE_OPTIONS
  const { data, isLoading, isError, isFetching } = useAsmrBrowse(query, page, sort, activeRating)
  const shows = React.useMemo(() => data?.shows ?? [], [data?.shows])
  const hasNext = data?.hasNext ?? false

  useEffect(() => {
    if (!rjParam) {
      if (selectedWork && !player) setSelectedWork(null)
      return
    }
    const rjUpper = rjParam.toUpperCase()
    if (
      player &&
      (player.work.id?.toUpperCase() === rjUpper || player.work._id?.toUpperCase() === rjUpper)
    ) {
      if (selectedWork) setSelectedWork(null)
      return
    }
    const found = shows.find((w) => (w.id || w._id)?.toUpperCase() === rjUpper)
    if (found) {
      if (!selectedWork || (selectedWork.id || selectedWork._id) !== (found.id || found._id)) {
        setSelectedWork(found)
      }
    } else if (!selectedWork || (selectedWork.id || selectedWork._id)?.toUpperCase() !== rjUpper) {
      setSelectedWork({ _id: rjUpper, id: rjUpper, name: rjUpper } as AsmrWork)
    }
  }, [rjParam, shows, player, selectedWork])

  const handleCloseDetail = useCallback(() => {
    navigate('/asmr')
  }, [navigate])

  useEffect(() => {
    if (!rjParam && player) setPlayer(null)
  }, [rjParam, player])

  const { data: playerDetail } = useAsmrWork(player ? player.work.id || null : null)
  const playerImages = player
    ? [player.work.thumbnail, ...(playerDetail?.images || [])].filter(Boolean)
    : []

  const translateTexts = [
    ...shows.map((w) => w.name),
    selectedWork?.name || '',
    player?.work.name || '',
    ...(playerDetail?.chapters?.map((c) => c.label) || []),
  ].filter(Boolean) as string[]
  const { t: tAsmr } = useTranslate(translateTexts, translateEN)

  useEffect(() => {
    const raw = player
      ? player.work.name
      : selectedWork
        ? selectedWork.name
        : rjParam
          ? rjParam.toUpperCase()
          : ''
    const display = raw ? (translateEN ? tAsmr(raw) : raw) : ''
    const title = display ? `${display} - dango` : 'dango'
    document.title = title
    try {
      window.history.replaceState(window.history.state, title, window.location.href)
    } catch {
      // ignore
    }
  }, [selectedWork, player, rjParam, translateEN, tAsmr])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setQuery(queryInput)
    setPage(1)
    const next = new URLSearchParams(searchParams)
    if (queryInput.trim()) next.set('q', queryInput.trim())
    else next.delete('q')
    next.delete('page')
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    const q = searchParams.get('q') || ''
    setQueryInput((prev) => (prev === q ? prev : q))
    setQuery((prev) => (prev === q ? prev : q))
    setPage(1)
  }, [searchParams])

  const handleMatureToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.currentTarget.checked && !hasConsent) {
      setShowMatureModal(true)
    }
  }

  const handleAcceptMature = () => {
    grantMatureConsent()
    setShowMatureModal(false)
    setPage(1)
  }

  const handleDeclineMature = () => {
    setShowMatureModal(false)
  }

  const handlePlay = useCallback((work: AsmrWork, tracks: AsmrTrack[], index: number) => {
    setSelectedWork(null)
    setPlayerExpanded(true)
    setPlayer({ work, tracks, index })
  }, [])

  return (
    <div className={`${pageStyles.page} ${player ? pageStyles.pageWithPlayer : ''}`}>
      {!(player && playerExpanded) && (
        <>
          <header className={pageStyles.header}>
            <h1 className={pageStyles.pageTitle}>
              <Icon name="headphones" /> ASMR
            </h1>

            <form className={pageStyles.searchForm} onSubmit={handleSearch}>
              <input
                className={pageStyles.searchInput}
                type="text"
                value={queryInput}
                onChange={(e) => setQueryInput(e.currentTarget.value)}
                placeholder="Search works, circles, CV… (-word excludes)"
                aria-label="Search ASMR works"
              />
              <button className={pageStyles.searchBtn} type="submit" aria-label="Search">
                <Icon name="search" />
              </button>
            </form>
          </header>

          <div className={styles.filterBar}>
            <label className={styles.filterLabel} htmlFor="asmr-sort">
              Sort
            </label>
            <select
              id="asmr-sort"
              className={styles.sortSelect}
              value={sort}
              onChange={(e) => {
                setSort(e.currentTarget.value)
                setPage(1)
              }}
            >
              {SORT_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            <label className={styles.filterLabel} htmlFor="asmr-rating">
              Type
            </label>
            <select
              id="asmr-rating"
              className={styles.sortSelect}
              value={rating}
              onChange={(e) => {
                setRating(e.currentTarget.value)
                setPage(1)
              }}
            >
              {typeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <div className={styles.filterTogglesGroup}>
              <div className={styles.translateToggleWrap}>
                <span className={styles.filterLabel}>JP</span>
                <ToggleSwitch
                  id="asmr-translate-toggle"
                  isChecked={translateEN}
                  onChange={(e) => setTranslateEN(e.currentTarget.checked)}
                />
                <span className={styles.filterLabel}>EN</span>
              </div>

              {!hasConsent && (
                <div className={styles.matureToggleWrap}>
                  <label className={styles.matureLabel} htmlFor="asmr-mature-toggle">
                    Mature
                  </label>
                  <ToggleSwitch
                    id="asmr-mature-toggle"
                    isChecked={false}
                    onChange={handleMatureToggle}
                  />
                </div>
              )}
            </div>
          </div>

          {isError ? (
            <p className={styles.statusMsg}>Failed to load works. Please try again.</p>
          ) : isLoading && shows.length === 0 ? (
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
          ) : shows.length === 0 ? (
            <p className={styles.statusMsg}>No works found.</p>
          ) : (
            <>
              <div className={`${styles.grid} ${isFetching ? styles.fetching : ''}`}>
                {shows.map((work) => {
                  const displayWork = translateEN ? { ...work, name: tAsmr(work.name) } : work
                  const rj = asmrWorkId(work)
                  const libId = asmrLibraryId(rj)
                  const bookmarked = bookmarkedIds.has(libId)
                  const listenTarget = `/asmr/${encodeURIComponent(rj)}`
                  return (
                    <div key={work._id || work.id} className={styles.asmrCardWrap}>
                      <MediaCard
                        item={{
                          id: libId,
                          title: displayWork.name,
                          thumbnail: work.thumbnail || '',
                          typeBadge: rj || undefined,
                          isAdult: isAsmrAdult(work),
                        }}
                        linkTo={listenTarget}
                        hoverIcon="info"
                        layout="horizontal"
                        showInfoButton
                        display={{
                          elements: {
                            poster: { typeBadge: true, chapterBadge: false, adultBadge: true },
                            info: { title: true, mobileBadges: true, progress: false, meta: false },
                          },
                        }}
                        onOpenDetails={(rect) =>
                          openPopup(rect, {
                            rjCode: rj,
                            title: displayWork.name,
                            thumbnail: work.thumbnail || '',
                            isAdult: isAsmrAdult(work),
                            rating: work.rating,
                            listenTarget,
                          })
                        }
                        onPopupHoverIntent={(inside) => (inside ? cancelClose() : scheduleClose())}
                        rawThumbnail
                      />
                      <button
                        className={`${styles.bookmarkBtn} ${bookmarked ? styles.bookmarked : ''}`}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          toggleBookmark({
                            rjCode: rj,
                            title: work.name,
                            thumbnail: work.thumbnail || '',
                            isAdult: isAsmrAdult(work),
                          })
                        }}
                        title={bookmarked ? 'Remove from listening list' : 'Add to listening list'}
                        aria-label={
                          bookmarked ? 'Remove from listening list' : 'Add to listening list'
                        }
                        aria-pressed={bookmarked}
                      >
                        <Icon name={bookmarked ? 'check' : 'plus'} size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>

              <Pagination
                page={page}
                canGoNext={hasNext}
                onChange={(next) => setPage(next)}
                variant="labeled"
              />
            </>
          )}
        </>
      )}

      {selectedWork && (
        <AsmrDetail work={selectedWork} onClose={handleCloseDetail} onPlay={handlePlay} t={tAsmr} />
      )}

      {popup && (
        <AsmrPopup
          data={popup.data}
          anchorRect={popup.rect}
          bookmarked={bookmarkedIds.has(asmrLibraryId(popup.data.rjCode))}
          onToggleBookmark={() =>
            toggleBookmark({
              rjCode: popup.data.rjCode,
              title: popup.data.title,
              thumbnail: popup.data.thumbnail || '',
              isAdult: popup.data.isAdult,
            })
          }
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onRequestClose={closePopup}
        />
      )}

      {showJasmrModal && (
        <JasmrCookieModal
          isOpen={showJasmrModal}
          onClose={() => setShowJasmrModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: [qk.asmrBrowse] })
            queryClient.invalidateQueries({ queryKey: [qk.asmrWork] })
          }}
        />
      )}

      {showMatureModal && (
        <MatureConsentModal
          isOpen
          scope="section"
          showResetHint
          onClose={handleDeclineMature}
          onGrant={handleAcceptMature}
        />
      )}

      {player && (
        <AsmrPlayer
          title={player.work.name}
          images={playerImages as string[]}
          chapters={playerDetail?.chapters || []}
          tracks={player.tracks}
          trackIndex={player.index}
          expanded={playerExpanded}
          isAdult={!!player.work.isAdult}
          rjCode={player.work.id || player.work._id}
          t={tAsmr}
          onTrackChange={(index) => setPlayer((p) => (p ? { ...p, index } : p))}
          onExpandedChange={setPlayerExpanded}
          onClose={() => {
            setPlayer(null)
            setPlayerExpanded(true)
            if (rjParam) navigate('/asmr')
          }}
        />
      )}
    </div>
  )
}

export default Asmr
