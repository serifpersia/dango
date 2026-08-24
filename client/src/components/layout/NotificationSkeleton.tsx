import React from 'react'
import { Skeleton } from '../common/Skeleton'
import styles from './Notification.module.css'

interface NotificationSkeletonProps {
  count?: number
}

const NotificationSkeleton: React.FC<NotificationSkeletonProps> = ({ count = 3 }) => {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={styles.item}
          style={{ borderBottom: '1px solid var(--border-primary)', pointerEvents: 'none' }}
        >
          <div className={styles.thumbnail} style={{ overflow: 'hidden' }}>
            <Skeleton width="100%" height="100%" variant="rectangular" />
          </div>
          <div className={styles.itemInfo}>
            <Skeleton
              width="80%"
              height="1rem"
              variant="text"
              className="mb-2"
              style={{ marginBottom: '4px' }}
            />
            <Skeleton
              width="40%"
              height="0.7rem"
              variant="rectangular"
              style={{ borderRadius: 'var(--radius-sm)' }}
            />
          </div>
        </div>
      ))}
    </>
  )
}

export default NotificationSkeleton
