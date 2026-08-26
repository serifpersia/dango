import React from 'react'
import type { AsmrWork } from '../../hooks/useAsmr'
import styles from './Asmr.module.css'

interface AsmrCardProps {
  work: AsmrWork
  onSelect: (work: AsmrWork) => void
}

const AsmrCard: React.FC<AsmrCardProps> = ({ work, onSelect }) => {
  return (
    <button className={styles.card} onClick={() => onSelect(work)} title={work.name}>
      <div className={styles.thumbWrap}>
        {work.thumbnail ? (
          <img
            className={styles.thumb}
            src={work.thumbnail}
            alt={work.name}
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className={`${styles.thumb} ${styles.thumbPlaceholder}`}>
            <span>No Image</span>
          </div>
        )}
        {work.isAdult && <span className={styles.adultBadge}>18+</span>}
      </div>
      <p className={styles.cardTitle}>{work.name}</p>
      <p className={styles.cardMeta}>{work.id}</p>
    </button>
  )
}

export default AsmrCard
