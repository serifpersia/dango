import React, { useCallback, useEffect, useState } from 'react'
import { FaHeadphones, FaSearch } from 'react-icons/fa'
import { useParams, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import ToggleSwitch from '../components/common/ToggleSwitch'
import GenericModal from '../components/common/GenericModal'
import { Button } from '../components/common/Button'
import AsmrCard from '../components/asmr/AsmrCard'
import AsmrDetail from '../components/asmr/AsmrDetail'
import AsmrPlayer from '../components/asmr/AsmrPlayer'
import JasmrCookieModal from '../components/asmr/JasmrCookieModal'
import { useAsmrBrowse, useAsmrWork } from '../hooks/useAsmr'
import { useTranslate } from '../hooks/useTranslate'
import type { AsmrTrack, AsmrWork } from '../hooks/useAsmr'
import styles from '../components/asmr/Asmr.module.css'

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

const MATURE_CONSENT_KEY = 'agreedToViewMature'

const Asmr: React.FC = () => {
  const { rj: rjParam } = useParams<{ rj: string }>()
  const navigate = useNavigate()
  const [hasConsent, setHasConsent] = useState(
    () => localStorage.getItem(MATURE_CONSENT_KEY) === 'true'
  )
  const [showMatureModal, setShowMatureModal] = useState(false)
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
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
    () => localStorage.getItem('asmrTranslateEN') === 'true'
  )
  const [showJasmrModal, setShowJasmrModal] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    const handleAuthRequired = () => setShowJasmrModal(true)
    window.addEventListener('JASMR_AUTH_REQUIRED', handleAuthRequired)
    return () => window.removeEventListener('JASMR_AUTH_REQUIRED', handleAuthRequired)
  }, [])

  useEffect(() => {
    localStorage.setItem('asmrTranslateEN', String(translateEN))
  }, [translateEN])

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

  const handleSelectWork = useCallback(
    (work: AsmrWork) => {
      const rj = work.id || work._id
      if (rj) navigate(`/asmr/${rj}`)
      else setSelectedWork(work)
    },
    [navigate]
  )

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
    <div className={`${styles.page} ${player ? styles.pageWithPlayer : ''}`}>
      {!(player && playerExpanded) && (
        <>
          <header className={styles.header}>
            <h1 className={styles.pageTitle}>
              <FaHeadphones /> ASMR
            </h1>

            <form className={styles.searchForm} onSubmit={handleSearch}>
              <input
                className={styles.searchInput}
                type="text"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="Search works, circles, CV… (-word excludes)"
                aria-label="Search ASMR works"
              />
              <button className={styles.searchBtn} type="submit" aria-label="Search">
                <FaSearch />
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
                setSort(e.target.value)
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
                setRating(e.target.value)
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
                  onChange={(e) => setTranslateEN(e.target.checked)}
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
                  return (
                    <AsmrCard
                      key={work._id || work.id}
                      work={displayWork}
                      onSelect={handleSelectWork}
                    />
                  )
                })}
              </div>

              <nav className={styles.pagination}>
                <button
                  className={styles.pageBtn}
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span className={styles.pageIndicator}>Page {page}</span>
                <button
                  className={styles.pageBtn}
                  disabled={!hasNext}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </nav>
            </>
          )}
        </>
      )}

      {selectedWork && (
        <AsmrDetail work={selectedWork} onClose={handleCloseDetail} onPlay={handlePlay} t={tAsmr} />
      )}

      {showJasmrModal && (
        <JasmrCookieModal
          isOpen={showJasmrModal}
          onClose={() => setShowJasmrModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['asmrBrowse'] })
            queryClient.invalidateQueries({ queryKey: ['asmrWork'] })
          }}
        />
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

      {player && (
        <AsmrPlayer
          title={player.work.name}
          images={playerImages}
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
