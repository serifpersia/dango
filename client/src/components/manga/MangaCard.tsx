import React from 'react'
import { mangaCoverSrc, type MangaCard as MangaCardType } from '../../hooks/useManga'
import styles from './Manga.module.css'

interface MangaCardProps {
  item: MangaCardType
  onSelect: (item: MangaCardType) => void
}

const MangaCard: React.FC<MangaCardProps> = ({ item, onSelect }) => {
  const meta = [item.type, item.status, item.year ? String(item.year) : '']
    .filter(Boolean)
    .join(' · ')
  const isAdult =
    item.contentRating === 'erotica' ||
    item.contentRating === 'pornographic' ||
    item.type === 'doujinshi'
  return (
    <button className={styles.card} onClick={() => onSelect(item)} title={item.title}>
      <div className={styles.thumbWrap}>
        {item.cover ? (
          <img
            className={styles.thumb}
            src={mangaCoverSrc(item.provider, item.cover)}
            alt={item.title}
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className={`${styles.thumb} ${styles.thumbPlaceholder}`}>
            <span>No Image</span>
          </div>
        )}
        {isAdult && <span className={styles.adultBadge}>18+</span>}
      </div>
      <p className={styles.cardTitle}>{item.title}</p>
      {meta && <p className={styles.cardMeta}>{meta}</p>}
    </button>
  )
}

export default MangaCard
