import React, { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router'
import Icon from '../components/common/Icon'
import { Button } from '../components/common/Button'
import { useMatureConsent } from '../hooks/useMatureConsent'
import { useToggleTvBookmark, useTvLibraryCheck } from '../hooks/useTvLibrary'
import { buildTvId, normalizeTvMediaType, tvWatchPath } from '../lib/tv'
import styles from './TvInfo.module.css'

interface TvDetails {
  id: number
  title: string
  name?: string
  overview: string
  vote_average?: number
  vote_count?: number
  year: string
  poster: string
  backdrop: string
  imdb_id?: string
  adult?: boolean
  genres?: { id: number; name: string }[]
  seasons?: {
    season_number: number
    episode_count: number
    name: string
    poster_path?: string | null
  }[]
  number_of_seasons?: number
  number_of_episodes?: number
  status?: string
  first_air_date?: string
  last_air_date?: string
  networks?: { name: string }[]
  created_by?: { name: string }[]
  episode_run_time?: number[]
}

export default function TvInfo() {
  const { id: tmdbId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const type = normalizeTvMediaType(searchParams.get('type'))
  const { hasConsent: hasMatureConsent } = useMatureConsent()
  const [details, setDetails] = useState<TvDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [selectedSeason, setSelectedSeason] = useState(1)

  const mediaId = buildTvId(type, tmdbId)
  const numericId = Number(tmdbId)

  const { data: libraryCheck } = useTvLibraryCheck(details ? mediaId : undefined)
  const inTvLibrary = !!libraryCheck?.inLibrary
  const { toggle } = useToggleTvBookmark()

  useEffect(() => {
    if (!tmdbId) return
    setLoading(true)
    setError('')
    fetch(`/api/tv/details/${type}/${tmdbId}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load details')
        return r.json()
      })
      .then((data: TvDetails) => {
        setDetails(data)
        setLoading(false)
      })
      .catch((e) => {
        setError(e.message)
        setLoading(false)
      })
  }, [tmdbId, type])

  useEffect(() => {
    document.title = details?.title ? `${details.title} - dango` : 'TV & Movies - dango'
  }, [details?.title])

  const handleStartWatching = () => {
    if (!tmdbId || !details) return
    if (isMovie) {
      navigate(tvWatchPath(type, tmdbId))
    } else {
      navigate(tvWatchPath(type, tmdbId, selectedSeason, 1))
    }
  }

  const handleToggleWatchlist = () => {
    if (!details) return
    toggle({
      tmdbId: numericId,
      mediaType: type,
      title: details.title,
      poster: details.poster,
      year: details.year,
      adult: details.adult,
    })
  }

  const isMovie = type === 'movie'
  const isTv = !isMovie

  const backdropUrl = details?.backdrop ? `https://image.tmdb.org/t/p/w1280${details.backdrop}` : ''

  const posterUrl = details?.poster ? `https://image.tmdb.org/t/p/w500${details.poster}` : ''

  const genreNames = useMemo(() => {
    if (!details?.genres) return []
    return details.genres.map((g) => g.name).slice(0, 5)
  }, [details?.genres])

  const meta = [
    details?.year,
    details?.status,
    isTv && details?.number_of_seasons
      ? `${details.number_of_seasons} Season${details.number_of_seasons > 1 ? 's' : ''}`
      : null,
    isTv && details?.number_of_episodes ? `${details.number_of_episodes} Episodes` : null,
  ].filter(Boolean)

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.heroSkeleton}>
          <div className={styles.skeletonBanner} />
          <div className={styles.skeletonContent}>
            <div className={styles.skeletonPoster} />
            <div className={styles.skeletonInfo}>
              <div className={styles.skeletonTitle} />
              <div className={styles.skeletonMeta} />
              <div className={styles.skeletonDesc} />
              <div className={styles.skeletonActions} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error || !details) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <Icon name="exclamation-triangle" size={48} />
          <h2>Failed to load details</h2>
          <p>{error || 'Something went wrong'}</p>
          <Button onClick={() => navigate(-1)}>Go Back</Button>
        </div>
      </div>
    )
  }

  const matureBlocked = details.adult && !hasMatureConsent

  return (
    <div
      className={styles.container}
      style={
        matureBlocked
          ? { filter: 'blur(14px)', pointerEvents: 'none', userSelect: 'none' }
          : undefined
      }
    >
      <div className={styles.heroSection}>
        <div className={styles.bannerContainer}>
          {backdropUrl && (
            <div className={styles.banner} style={{ backgroundImage: `url(${backdropUrl})` }} />
          )}
          <div className={styles.bannerOverlay} />
        </div>

        <div className={styles.heroContent}>
          <div className={styles.posterContainer}>
            {posterUrl && (
              <img src={posterUrl} alt={details.title} className={styles.poster} decoding="async" />
            )}
          </div>

          <div className={styles.infoGlass}>
            <div className={styles.topInfo}>
              <h1 className={styles.title}>{details.title}</h1>

              <div className={styles.quickMeta}>
                {details.vote_average != null && details.vote_average > 0 && (
                  <div className={styles.metaItem}>
                    <Icon name="star" className={styles.iconStar} />
                    <span>{Number(details.vote_average).toFixed(1)}</span>
                  </div>
                )}
                <div className={styles.metaItem}>
                  <Icon name="tv" className={styles.iconTv} />
                  <span>{isMovie ? 'Movie' : 'TV Show'}</span>
                </div>
                {details.vote_count != null && (
                  <div className={styles.metaItem}>
                    <Icon name="users" className={styles.iconType} />
                    <span>{details.vote_count.toLocaleString()} votes</span>
                  </div>
                )}
              </div>

              {genreNames.length > 0 && (
                <div className={styles.genres}>
                  {genreNames.map((g) => (
                    <span key={g} className={styles.genre}>
                      {g}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {meta.length > 0 && (
              <div className={styles.metaRow}>
                {meta.map((m, i) => (
                  <React.Fragment key={i}>
                    <span className={styles.metaValue}>{m}</span>
                    {i < meta.length - 1 && <span className={styles.metaDivider}>·</span>}
                  </React.Fragment>
                ))}
              </div>
            )}

            {details.overview && (
              <div className={styles.synopsisSection}>
                <h2 className={styles.sectionTitleSmall}>Synopsis</h2>
                <p className={styles.synopsis}>{details.overview}</p>
              </div>
            )}

            <div className={styles.actions}>
              <button className={styles.watchBtn} onClick={handleStartWatching}>
                <Icon name="play" size={14} />
                {isMovie ? 'Watch Now' : `Start S${selectedSeason}`}
              </button>
              <button
                className={`${styles.watchlistBtn} ${inTvLibrary ? styles.active : ''}`}
                onClick={handleToggleWatchlist}
              >
                {inTvLibrary ? <Icon name="check" size={14} /> : <Icon name="plus" size={14} />}
                {inTvLibrary ? 'In Watchlist' : 'Add to Watchlist'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {isTv && details.seasons && details.seasons.length > 0 && (
        <div className={styles.seasonsSection}>
          <h2 className={styles.sectionTitle}>Seasons</h2>
          <div className={styles.seasonsList}>
            {details.seasons
              .filter((s) => s.season_number > 0)
              .map((s) => (
                <button
                  key={s.season_number}
                  className={`${styles.seasonCard} ${selectedSeason === s.season_number ? styles.activeSeason : ''}`}
                  onClick={() => setSelectedSeason(s.season_number)}
                >
                  <div className={styles.seasonPoster}>
                    {s.poster_path ? (
                      <img
                        src={`https://image.tmdb.org/t/p/w200${s.poster_path}`}
                        alt={s.name}
                        loading="lazy"
                      />
                    ) : (
                      <div className={styles.seasonPlaceholder}>
                        <Icon name="tv" size={24} />
                      </div>
                    )}
                  </div>
                  <div className={styles.seasonInfo}>
                    <span className={styles.seasonNumber}>Season {s.season_number}</span>
                    <span className={styles.seasonEpisodes}>{s.episode_count} Episodes</span>
                  </div>
                </button>
              ))}
          </div>
        </div>
      )}

      <div className={styles.detailsSection}>
        <button className={styles.detailsToggleBtn} onClick={() => setShowDetails(!showDetails)}>
          {showDetails ? <Icon name="chevron-up" /> : <Icon name="chevron-down" />}
          {showDetails ? 'Hide Details' : 'Show Details'}
        </button>

        {showDetails && (
          <div className={styles.expandedContent}>
            <div className={styles.detailGrid}>
              {details.first_air_date && (
                <div className={styles.detailItem}>
                  <strong>{isMovie ? 'Release Date' : 'First Air Date'}</strong>
                  <span>{details.first_air_date}</span>
                </div>
              )}
              {details.last_air_date && (
                <div className={styles.detailItem}>
                  <strong>Last Air Date</strong>
                  <span>{details.last_air_date}</span>
                </div>
              )}
              {details.networks && details.networks.length > 0 && (
                <div className={styles.detailItem}>
                  <strong>Networks</strong>
                  <span>{details.networks.map((n) => n.name).join(', ')}</span>
                </div>
              )}
              {details.created_by && details.created_by.length > 0 && (
                <div className={styles.detailItem}>
                  <strong>Created By</strong>
                  <span>{details.created_by.map((c) => c.name).join(', ')}</span>
                </div>
              )}
              {details.episode_run_time && details.episode_run_time.length > 0 && (
                <div className={styles.detailItem}>
                  <strong>Episode Runtime</strong>
                  <span>{details.episode_run_time[0]} min</span>
                </div>
              )}
              {details.imdb_id && (
                <div className={styles.detailItem}>
                  <strong>IMDb</strong>
                  <a
                    href={`https://www.imdb.com/title/${details.imdb_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.imdbLink}
                  >
                    View on IMDb
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {matureBlocked && (
        <div className={styles.matureOverlay}>
          <div className={styles.matureContent}>
            <Icon name="exclamation-triangle" size={48} />
            <h2>Content Warning</h2>
            <p>This content may contain mature themes.</p>
            <Button onClick={() => navigate('/')}>Go Back</Button>
          </div>
        </div>
      )}
    </div>
  )
}
