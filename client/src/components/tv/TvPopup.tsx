import React, { useMemo, useRef, useState, useEffect } from 'react'
import Icon from '../common/Icon'
import { Link } from 'react-router'
import { tvDetailPath, tvWatchPath, buildTvId } from '../../lib/tv'
import { useToggleTvBookmark } from '../../hooks/useTvLibrary'
import MediaPopupShell from '../common/MediaPopupShell'
import styles from '../common/MediaPopup.module.css'

interface TvPopupItem {
  id: number
  title: string
  year: string
  type: string
  image: string
}

interface TvPopupDetails {
  overview?: string
  genres?: { id: number; name: string }[]
  vote_average?: number
  vote_count?: number
  status?: string
  number_of_seasons?: number
  number_of_episodes?: number
}

interface TvPopupProps {
  item: TvPopupItem
  anchorRect: DOMRect
  onMouseEnter: () => void
  onMouseLeave: () => void
  onRequestClose?: () => void
}

const TvPopup: React.FC<TvPopupProps> = ({
  item,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
  onRequestClose,
}) => {
  const mouseInsideRef = useRef(false)
  const [details, setDetails] = useState<TvPopupDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const { toggle, bookmarkedIds } = useToggleTvBookmark()

  const mediaId = buildTvId(item.type, item.id)
  const inWatchlist = bookmarkedIds.has(mediaId)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/tv/details/${item.type}/${item.id}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed')
        return r.json()
      })
      .then((data) => {
        if (!cancelled) {
          setDetails({
            overview: data.overview,
            genres: data.genres,
            vote_average: data.vote_average,
            vote_count: data.vote_count,
            status: data.status,
            number_of_seasons: data.number_of_seasons,
            number_of_episodes: data.number_of_episodes,
          })
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [item.id, item.type])

  const genres = useMemo(() => {
    if (!details?.genres) return []
    return details.genres.slice(0, 4).map((g) => g.name)
  }, [details?.genres])

  const detailPath = tvDetailPath(item.type, item.id)
  const watchPath = tvWatchPath(item.type, item.id)

  const handleToggleWatchlist = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    toggle({
      tmdbId: item.id,
      mediaType: item.type,
      title: item.title,
      poster: item.image,
      year: item.year,
    })
  }

  return (
    <MediaPopupShell
      anchorRect={anchorRect}
      onMouseEnter={() => {
        mouseInsideRef.current = true
        onMouseEnter()
      }}
      onMouseLeave={() => {
        mouseInsideRef.current = false
        onMouseLeave()
      }}
      onRequestClose={onRequestClose}
    >
      <div className={styles.header}>
        <div className={styles.title}>{item.title}</div>
      </div>

      <div className={styles.body}>
        {loading ? (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            <span>Fetching details...</span>
          </div>
        ) : (
          <>
            <div className={styles.metaRow}>
              {details?.vote_average != null && details.vote_average > 0 && (
                <div className={styles.metaItem}>
                  <Icon name="star" className={styles.scoreIcon} size={14} />
                  <span>{Number(details.vote_average).toFixed(1)}</span>
                </div>
              )}
              <div className={styles.metaItem}>
                <Icon name="tv" size={14} />
                <span>{item.type === 'tv' ? 'TV Show' : 'Movie'}</span>
              </div>
              {item.year && (
                <div className={styles.metaItem}>
                  <span>{item.year}</span>
                </div>
              )}
              {details?.status && (
                <div className={styles.metaItem}>
                  <span>{details.status}</span>
                </div>
              )}
            </div>

            {genres.length > 0 && (
              <div className={styles.genres}>
                {genres.map((g) => (
                  <span key={g} className={styles.genre}>
                    {g}
                  </span>
                ))}
              </div>
            )}

            {details?.overview && (
              <div className={styles.synopsis}>
                {details.overview.length > 200
                  ? details.overview.slice(0, 200) + '...'
                  : details.overview}
              </div>
            )}
          </>
        )}
      </div>

      <div className={styles.footer}>
        <div className={styles.primaryAction}>
          <Link to={watchPath} className={styles.watchBtn} onClick={onRequestClose}>
            <Icon name="play" size={14} />
            Watch now
          </Link>
        </div>
        <div className={styles.secondaryActions}>
          <button
            className={`${styles.watchlistBtn} ${inWatchlist ? styles.active : ''}`}
            onClick={handleToggleWatchlist}
          >
            {inWatchlist ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
            <span>{inWatchlist ? 'Remove' : 'Watchlist'}</span>
          </button>
          <Link to={detailPath} className={styles.detailsBtn} onClick={onRequestClose}>
            <Icon name="info-circle" size={12} />
            <span>Details</span>
          </Link>
        </div>
      </div>
    </MediaPopupShell>
  )
}

export default TvPopup
