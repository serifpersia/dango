import React from 'react'
import { Skeleton } from '../common/Skeleton'
import styles from './EpisodeList.module.css'

interface EpisodeListSkeletonProps {
  variant?: 'sidebar' | 'drawer'
  count?: number
}

const EpisodeListSkeleton = ({ variant = 'sidebar', count = 12 }: EpisodeListSkeletonProps) => {
  return (
    <div
      className={`${styles.episodeListContainer} ${variant === 'drawer' ? styles.drawerContainer : ''}`}
    >
      <div
        className={`${styles.episodeListHeader} ${variant === 'drawer' ? styles.drawerHeader : ''}`}
      >
        <h3 className={styles.episodeListTitle}>Episodes</h3>
        <div className={styles.rangeSelector}>
          <Skeleton width="60px" height="28px" variant="rectangular" />
          <Skeleton width="60px" height="28px" variant="rectangular" />
          <Skeleton width="60px" height="28px" variant="rectangular" />
        </div>
      </div>
      <div className={`${styles.episodeList} ${variant === 'drawer' ? styles.drawerList : ''}`}>
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className={styles.episodeItem}
            style={{ border: 'none', background: 'transparent' }}
          >
            <Skeleton width="120px" height="1.2rem" variant="text" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default EpisodeListSkeleton
