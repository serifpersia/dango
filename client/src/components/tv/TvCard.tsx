import React, { useState } from 'react'
import { Link } from 'react-router'
import styles from './TvCard.module.css'

interface TvItem {
  id: number
  title: string
  year: string
  type: string
  image: string
  vote_average?: number
}

interface TvCardProps {
  item: TvItem
}

const TvCard: React.FC<TvCardProps> = ({ item }) => {
  const [imgLoaded, setImgLoaded] = useState(false)
  const isTV = item.type === 'tv' || item.type === 'tvSeries' || item.type === 'tvMiniSeries'
  const path = `/tv/${item.id}?type=${isTV ? 'tv' : 'movie'}`

  return (
    <Link to={path} className={styles.cardWrapper}>
      <div className={styles.card}>
        <div className={styles.posterContainer}>
          {item.image ? (
            <img
              src={item.image}
              alt={item.title}
              className={`${styles.poster} ${imgLoaded ? styles.loaded : ''}`}
              loading="lazy"
              decoding="async"
              onLoad={() => setImgLoaded(true)}
            />
          ) : (
            <div className={styles.posterPlaceholder}>
              <span>No Image</span>
            </div>
          )}
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
  )
}

export default TvCard
