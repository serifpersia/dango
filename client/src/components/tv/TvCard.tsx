import React, { useState } from 'react'
import { Link } from 'react-router'
import GenericModal from '../common/GenericModal'
import { Button } from '../common/Button'
import { useMatureConsent } from '../../hooks/useMatureConsent'
import styles from './TvCard.module.css'

interface TvItem {
  id: number
  title: string
  year: string
  type: string
  image: string
  vote_average?: number
  adult?: boolean
}

interface TvCardProps {
  item: TvItem
}

const TvCard: React.FC<TvCardProps> = ({ item }) => {
  const [imgLoaded, setImgLoaded] = useState(false)
  const [showMatureModal, setShowMatureModal] = useState(false)
  const { hasConsent: hasMatureConsent, grant: grantMatureConsent } = useMatureConsent()
  const isTV = item.type === 'tv' || item.type === 'tvSeries' || item.type === 'tvMiniSeries'
  const matureBlocked = item.adult === true && !hasMatureConsent
  const path = `/tv/${item.id}?type=${isTV ? 'tv' : 'movie'}`

  const handleCardClick = (e: React.MouseEvent) => {
    if (!matureBlocked) return
    e.preventDefault()
    e.stopPropagation()
    setShowMatureModal(true)
  }

  return (
    <>
      <Link to={path} className={styles.cardWrapper} onClick={handleCardClick}>
        <div className={styles.card}>
          <div className={styles.posterContainer}>
            {item.image ? (
              <img
                src={item.image}
                alt={item.title}
                className={`${styles.poster} ${imgLoaded ? styles.loaded : ''} ${
                  matureBlocked ? styles.gated : ''
                }`}
                loading="lazy"
                decoding="async"
                onLoad={() => setImgLoaded(true)}
              />
            ) : (
              <div className={styles.posterPlaceholder}>
                <span>No Image</span>
              </div>
            )}
            {matureBlocked && <span className={styles.adultBadge}>18+</span>}
            <div className={styles.badges}>
              <span className={`${styles.typeBadge} ${styles[item.type]}`}>
                {isTV ? 'TV' : 'Movie'}
              </span>
              {item.vote_average != null && (
                <span className={styles.ratingBadge}>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    style={{ marginRight: 3 }}
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  {Number(item.vote_average).toFixed(1)}
                </span>
              )}
            </div>
          </div>
          <div className={styles.info}>
            <h3 className={styles.title}>{item.title}</h3>
            <p className={styles.year}>{item.year || 'N/A'}</p>
          </div>
        </div>
      </Link>

      {showMatureModal && (
        <GenericModal
          isOpen={showMatureModal}
          title="Content Warning"
          onClose={() => setShowMatureModal(false)}
        >
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
              <Button variant="secondary" onClick={() => setShowMatureModal(false)}>
                Go Back
              </Button>
              <Button
                onClick={() => {
                  grantMatureConsent()
                  setShowMatureModal(false)
                }}
              >
                I'm 18+, Continue
              </Button>
            </div>
          </div>
        </GenericModal>
      )}
    </>
  )
}

export default TvCard
