import React from 'react'
import Icon from '../common/Icon'
import {
  mangaCoverSrc,
  type MangaChapter,
  type MangaDetail as MangaDetailType,
} from '../../hooks/useManga'
import type { MangaProgressItem } from '../../hooks/useMangaLibrary'
import styles from './Manga.module.css'

interface MangaDetailProps {
  detail: MangaDetailType
  altTitle?: string
  onBack: () => void
  onOpenChapter: (chapter: MangaChapter) => void
  bookmarkButton?: React.ReactNode
  statusSelect?: React.ReactNode
  primaryAction?: React.ReactNode
  progressByChapter?: Map<string, MangaProgressItem>
}

const MangaDetail: React.FC<MangaDetailProps> = ({
  detail,
  altTitle,
  onBack,
  onOpenChapter,
  bookmarkButton,
  statusSelect,
  primaryAction,
  progressByChapter,
}) => {
  const meta = [
    detail.type,
    detail.status,
    detail.year ? String(detail.year) : '',
    detail.author ? `by ${detail.author}` : '',
  ].filter(Boolean)
  return (
    <div>
      <button className={styles.backBtn} onClick={onBack}>
        <Icon name="chevron-left" size={12} /> Back to browse
      </button>
      <div className={styles.detail}>
        {detail.cover && (
          <img
            className={styles.detailCover}
            src={mangaCoverSrc(detail.provider, detail.cover)}
            alt={detail.title}
            decoding="async"
            draggable={false}
          />
        )}
        <div className={styles.detailInfo}>
          <h2 className={styles.detailTitle}>{detail.title}</h2>
          {altTitle && <p className={styles.detailAltTitle}>Also known as: {altTitle}</p>}
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
          {(bookmarkButton || statusSelect || primaryAction) && (
            <div className={styles.detailActions}>
              {primaryAction}
              {bookmarkButton}
              {statusSelect}
            </div>
          )}
        </div>
      </div>
      <h3 className={styles.detailTitle} style={{ fontSize: '1rem' }}>
        Chapters ({detail.chapters.length})
      </h3>
      {detail.chapters.length === 0 ? (
        <p className={styles.statusMsg}>No chapters found for this title on this provider.</p>
      ) : (
        <div className={styles.chapterList}>
          {detail.chapters.map((ch) => {
            const progress = progressByChapter?.get(ch.id)
            const done = !!progress && progress.pageCount > 0 && progress.page >= progress.pageCount
            return (
              <button
                key={ch.id}
                className={`${styles.chapterRow} ${done ? styles.chapterDone : ''}`}
                onClick={() => onOpenChapter(ch)}
                title={ch.externalUrl ? 'External only — opens on source site' : undefined}
              >
                <span>
                  Ch. {ch.number}
                  {ch.title ? ` — ${ch.title}` : ''}
                </span>
                <span className={styles.chapterMeta}>
                  {[
                    progress && progress.pageCount > 0
                      ? done
                        ? 'read'
                        : `p. ${progress.page}/${progress.pageCount}`
                      : '',
                    ch.group,
                    ch.externalUrl ? 'external' : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default MangaDetail
