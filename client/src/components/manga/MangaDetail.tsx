import React from 'react'
import { FaChevronLeft } from 'react-icons/fa'
import {
  mangaCoverSrc,
  type MangaChapter,
  type MangaDetail as MangaDetailType,
} from '../../hooks/useManga'
import styles from './Manga.module.css'

interface MangaDetailProps {
  detail: MangaDetailType
  onBack: () => void
  onOpenChapter: (chapter: MangaChapter) => void
}

const MangaDetail: React.FC<MangaDetailProps> = ({ detail, onBack, onOpenChapter }) => {
  const meta = [
    detail.type,
    detail.status,
    detail.year ? String(detail.year) : '',
    detail.author ? `by ${detail.author}` : '',
  ].filter(Boolean)
  return (
    <div>
      <button className={styles.backBtn} onClick={onBack}>
        <FaChevronLeft size={12} /> Back to browse
      </button>
      <div className={styles.detail}>
        {detail.cover && (
          <img
            className={styles.detailCover}
            src={mangaCoverSrc(detail.provider, detail.cover)}
            alt={detail.title}
            draggable={false}
          />
        )}
        <div className={styles.detailInfo}>
          <h2 className={styles.detailTitle}>{detail.title}</h2>
          {meta.length > 0 && (
            <div className={styles.detailMeta}>
              {meta.map((m) => (
                <span key={m} className={styles.badge}>
                  {m}
                </span>
              ))}
            </div>
          )}
          {detail.genres && detail.genres.length > 0 && (
            <div className={styles.detailMeta}>
              {detail.genres.map((g) => (
                <span key={g} className={styles.badge}>
                  {g}
                </span>
              ))}
            </div>
          )}
          {detail.description && <p className={styles.detailDesc}>{detail.description}</p>}
        </div>
      </div>
      <h3 className={styles.detailTitle} style={{ fontSize: '1rem' }}>
        Chapters ({detail.chapters.length})
      </h3>
      {detail.chapters.length === 0 ? (
        <p className={styles.statusMsg}>No chapters found for this title on this provider.</p>
      ) : (
        <div className={styles.chapterList}>
          {detail.chapters.map((ch) => (
            <button
              key={ch.id}
              className={styles.chapterRow}
              onClick={() => onOpenChapter(ch)}
              title={ch.externalUrl ? 'External only — opens on source site' : undefined}
            >
              <span>
                Ch. {ch.number}
                {ch.title ? ` — ${ch.title}` : ''}
              </span>
              <span className={styles.chapterMeta}>
                {[ch.group, ch.externalUrl ? 'external' : ''].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default MangaDetail
