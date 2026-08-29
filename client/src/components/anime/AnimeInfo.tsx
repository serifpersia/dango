import React from 'react'
import { useParams, useNavigate } from 'react-router'
import {
  FaPlay,
  FaPlus,
  FaCheck,
  FaChevronDown,
  FaChevronUp,
  FaStar,
  FaTv,
  FaLayerGroup,
} from 'react-icons/fa'
import { useState, useMemo, useEffect } from 'react'
import { useAnimeInfoData } from '../../hooks/useAnimeInfoData'
import { fixThumbnailUrl } from '../../lib/utils'
import { useTitlePreference } from '../../contexts/TitlePreferenceContext'
import GenericModal from '../common/GenericModal'
import { Button } from '../common/Button'
import { useMatureConsent } from '../../hooks/useMatureConsent'
import styles from './AnimeInfo.module.css'
import AnimeMetaDetails from './AnimeMetaDetails'
import SynopsisText from './SynopsisText'
import QueueOptionsButton from './QueueOptionsButton'

export default function AnimeInfo() {
  const { id: showId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { titlePreference } = useTitlePreference()
  const [showDetails, setShowDetails] = useState(false)

  const { showMeta, loadingMeta, toggleWatchlist, inWatchlist } = useAnimeInfoData(showId)
  const { hasConsent: hasMatureConsent, grant: grantMatureConsent } = useMatureConsent()

  useEffect(() => {
    if (showId && showMeta?.id && showMeta.id !== showId) {
      navigate(`/anime/${showMeta.id}`, { replace: true })
    }
  }, [showId, showMeta, navigate])

  const getDisplayTitle = () => {
    if (!showMeta?.name) return ''
    if (titlePreference === 'name') return showMeta.name
    if (titlePreference === 'nativeName') return showMeta.names?.native || showMeta.name
    if (titlePreference === 'englishName') return showMeta.names?.english || showMeta.name
    return showMeta.name
  }

  const handleStartWatching = () => {
    if (showId) navigate(`/watch/${showId}`)
  }

  const bannerUrl = useMemo(() => {
    if (showMeta?.bannerImage) return fixThumbnailUrl(showMeta.bannerImage)
    if (!showMeta?.thumbnail) return ''
    return fixThumbnailUrl(showMeta.thumbnail, 1200, 450)
  }, [showMeta?.bannerImage, showMeta?.thumbnail])

  if (loadingMeta || !showMeta?.name) {
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

  const matureBlocked = showMeta.isAdult === true && !hasMatureConsent

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
          <div className={styles.banner} style={{ backgroundImage: `url(${bannerUrl})` }} />
          <div className={styles.bannerOverlay} />
        </div>

        <div className={styles.heroContent}>
          <div className={styles.posterContainer}>
            <img
              src={fixThumbnailUrl(showMeta.thumbnail || '', 320, 480)}
              alt={showMeta.name}
              className={styles.poster}
            />
          </div>

          <div className={styles.infoGlass}>
            <div className={styles.topInfo}>
              <h1 className={styles.title}>{getDisplayTitle()}</h1>

              <div className={styles.quickMeta}>
                {showMeta.score && (
                  <div className={styles.metaItem}>
                    <FaStar className={styles.iconStar} />
                    <span>{showMeta.score}</span>
                  </div>
                )}
                {showMeta.status && (
                  <div className={styles.metaItem}>
                    <FaTv className={styles.iconTv} />
                    <span>{showMeta.status}</span>
                  </div>
                )}
                {showMeta.type && (
                  <div className={styles.metaItem}>
                    <FaLayerGroup className={styles.iconType} />
                    <span>{showMeta.type}</span>
                  </div>
                )}
              </div>

              {Array.isArray(showMeta.genres) && showMeta.genres.length > 0 && (
                <div className={styles.genres}>
                  {showMeta.genres
                    .filter(Boolean)
                    .slice(0, 5)
                    .map((g) => {
                      const genreName = typeof g === 'string' ? g : g?.name
                      return (
                        <span key={genreName} className={styles.genre}>
                          {genreName}
                        </span>
                      )
                    })}
                </div>
              )}
            </div>

            <div className={styles.synopsisSection}>
              <h2 className={styles.sectionTitleSmall}>Synopsis</h2>
              <SynopsisText
                text={showMeta.description ? showMeta.description.replace(/<[^>]*>?/gm, '') : ''}
                emptyText="No description available."
              />
            </div>

            <div className={styles.actions}>
              <button className={styles.watchBtn} onClick={handleStartWatching}>
                <FaPlay size={14} />
                Start Watching
              </button>
              <button
                className={`${styles.watchlistBtn} ${inWatchlist ? styles.active : ''}`}
                onClick={toggleWatchlist}
              >
                {inWatchlist ? <FaCheck size={14} /> : <FaPlus size={14} />}
                {inWatchlist ? 'In Watchlist' : 'Add to Watchlist'}
              </button>
              <QueueOptionsButton
                showId={showId}
                showName={showMeta.name || showMeta.names?.romaji}
                showThumbnail={showMeta.thumbnail}
                nativeName={showMeta.names?.native}
                englishName={showMeta.names?.english}
                showType={showMeta.type}
                className={styles.watchlistBtn}
                activeClassName={styles.active}
              />
            </div>
          </div>
        </div>
      </div>

      <div className={styles.detailsSection}>
        <button
          className={styles.detailsToggleBtn}
          onClick={() => {
            setShowDetails(!showDetails)
          }}
        >
          {showDetails ? <FaChevronUp /> : <FaChevronDown />}
          {showDetails ? 'Hide Details' : 'Show Details'}
        </button>

        {showDetails && (
          <div className={styles.expandedContent}>
            <AnimeMetaDetails showMeta={showMeta} styles={styles} />
          </div>
        )}
      </div>

      {matureBlocked && (
        <GenericModal isOpen title="Content Warning" onClose={() => navigate('/home')}>
          <div style={{ padding: '1rem', textAlign: 'center' }}>
            <p>This title contains mature content intended for adult audiences.</p>
            <p>
              By proceeding, you confirm that you are <strong>18 years of age or older</strong> (or
              the age of majority in your jurisdiction) and wish to view this content.
            </p>
            <div
              style={{
                marginTop: '1rem',
                display: 'flex',
                gap: '10px',
                justifyContent: 'center',
              }}
            >
              <Button variant="secondary" onClick={() => navigate('/home')}>
                Go Back
              </Button>
              <Button onClick={grantMatureConsent}>I'm 18+, Continue</Button>
            </div>
          </div>
        </GenericModal>
      )}
    </div>
  )
}
