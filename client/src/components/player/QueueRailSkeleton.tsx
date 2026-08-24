import React from 'react'
import { Skeleton } from '../common/Skeleton'
import styles from './QueueRail.module.css'
import { FaChevronDown } from 'react-icons/fa'

interface QueueRailSkeletonProps {
  count?: number
}

const QueueRailSkeleton: React.FC<QueueRailSkeletonProps> = ({ count = 3 }) => {
  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <button className={styles.headerToggle} disabled>
          <span className={styles.title}>
            <Skeleton width="60px" height="1.2rem" variant="text" />
          </span>
          <FaChevronDown style={{ opacity: 0.3 }} />
        </button>
      </div>
      <div className={styles.list}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={styles.item} style={{ pointerEvents: 'none' }}>
            <div className={styles.dragHandle} style={{ opacity: 0.2 }}>
              <Skeleton width="16px" height="16px" variant="rectangular" />
            </div>
            <div
              className={styles.thumbnail}
              style={{ overflow: 'hidden', background: 'transparent' }}
            >
              <Skeleton width="100%" height="100%" variant="rectangular" />
            </div>
            <div className={styles.meta}>
              <Skeleton width="80%" height="1.2rem" variant="text" className="mb-2" />
              <Skeleton
                width="40%"
                height="0.8rem"
                variant="rectangular"
                style={{ borderRadius: 'var(--radius-sm)' }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default QueueRailSkeleton
