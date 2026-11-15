import React from 'react'
import styles from './DangoLoader.module.css'

interface DangoLoaderProps {
  className?: string
}

const DangoLoader: React.FC<DangoLoaderProps> = ({ className }) => (
  <span className={className ? `${styles.loader} ${className}` : styles.loader} aria-hidden="true">
    <span className={styles.ball} />
    <span className={styles.ball} />
    <span className={styles.ball} />
  </span>
)

export default DangoLoader
