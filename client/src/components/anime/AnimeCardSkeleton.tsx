import React from 'react'
import styles from './AnimeCardSkeleton.module.css'
import { useLowEndMode } from '../../contexts/LowEndModeContext'

interface AnimeCardSkeletonProps {
  layout?: 'vertical' | 'horizontal'
}

const AnimeCardSkeleton: React.FC<AnimeCardSkeletonProps> = ({ layout = 'vertical' }) => {
  const { lowEndMode } = useLowEndMode()

  return (
    <div className={`${styles.skeletonCard} ${styles[layout]} ${lowEndMode ? styles.lowEnd : ''}`}>
      <div className={styles.poster}></div>
      <div className={styles.info}>
        <div className={styles.line}></div>
        <div className={`${styles.line} ${styles.short}`}></div>
      </div>
    </div>
  )
}

export default AnimeCardSkeleton
