import React from 'react'
import Icon from '../common/Icon'
import { Link } from 'react-router'
import { useMangaDetail } from '../../hooks/useManga'
import { resolveMangaTitle } from '../../lib/manga'
import { useTitlePreference } from '../../contexts/TitlePreferenceContext'
import type { MangaPopupData } from '../../hooks/useMangaPopup'
import MediaPopupShell from '../common/MediaPopupShell'
import popupStyles from '../common/MediaPopup.module.css'

interface MangaPopupProps {
  data: MangaPopupData
  anchorRect: DOMRect
  bookmarked: boolean
  onToggleBookmark: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  onRequestClose?: () => void
}

const MangaPopup: React.FC<MangaPopupProps> = ({
  data,
  anchorRect,
  bookmarked,
  onToggleBookmark,
  onMouseEnter,
  onMouseLeave,
  onRequestClose,
}) => {
  const { data: detail, isLoading } = useMangaDetail(
    data.provider,
    data.mangaId,
    data.rating || 'safe',
    data.mature || false
  )
  const { titlePreference } = useTitlePreference()

  const chapterCount = detail?.chapters.length ?? 0
  const meta = [detail?.status, detail?.type].filter(Boolean).join(' · ')
  const displayTitle = resolveMangaTitle(
    { title: data.title, altTitle: detail?.altTitle ?? data.altTitle },
    titlePreference
  )

  const content = (
    <MediaPopupShell
      anchorRect={anchorRect}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onRequestClose={onRequestClose}
    >
      {isLoading ? (
        <div className={popupStyles.loading}>
          <div className={popupStyles.spinner} />
          <span>Fetching details...</span>
        </div>
      ) : (
        <>
          <div className={popupStyles.header}>
            <div className={popupStyles.title}>{displayTitle}</div>
            {detail?.altTitle && detail.altTitle !== displayTitle && (
              <div className={popupStyles.synopsis}>Also known as: {detail.altTitle}</div>
            )}
          </div>

          <div className={popupStyles.body}>
            <div className={popupStyles.metaRow}>
              {meta && (
                <div className={popupStyles.metaItem}>
                  <Icon name="book" size={14} />
                  <span>{meta}</span>
                </div>
              )}
              {chapterCount > 0 && (
                <div className={popupStyles.metaItem}>
                  <span>
                    {chapterCount} chapter{chapterCount === 1 ? '' : 's'}
                  </span>
                </div>
              )}
              {data.progressLabel && (
                <div className={popupStyles.metaItem}>
                  <Icon name="bookmark" size={12} />
                  <span>{data.progressLabel}</span>
                </div>
              )}
            </div>

            <div className={popupStyles.synopsis}>
              {detail?.description ? detail.description : 'No synopsis available.'}
            </div>

            {Array.isArray(detail?.genres) && (detail?.genres?.length ?? 0) > 0 && (
              <div className={popupStyles.details}>
                <div className={popupStyles.genres}>
                  {detail.genres
                    .filter(Boolean)
                    .slice(0, 4)
                    .map((g) => (
                      <span key={g} className={popupStyles.genre}>
                        {g}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>

          <div className={popupStyles.footer}>
            <div className={popupStyles.primaryAction}>
              <Link to={data.readTarget} className={popupStyles.watchBtn}>
                <Icon name="book" size={14} />
                Read now
              </Link>
            </div>
            <div className={popupStyles.secondaryActions}>
              <button
                className={`${popupStyles.watchlistBtn} ${bookmarked ? popupStyles.active : ''}`}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onToggleBookmark()
                }}
              >
                {bookmarked ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
                <span>{bookmarked ? 'Remove' : 'Bookmark'}</span>
              </button>
              <Link
                to={`/manga/${data.provider}/${encodeURIComponent(data.mangaId)}`}
                className={popupStyles.detailsBtn}
              >
                Read more
              </Link>
            </div>
          </div>
        </>
      )}
    </MediaPopupShell>
  )

  return content
}

export default MangaPopup
