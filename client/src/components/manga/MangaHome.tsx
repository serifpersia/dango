import React, { useState } from 'react'
import { useNavigate } from 'react-router'
import Icon from '../common/Icon'
import { Button } from '../common/Button'
import MediaSection from '../common/MediaSection'
import MediaCard from '../common/MediaCard'
import MangaPopup from './MangaPopup'
import MangaResetProgressModal from './MangaResetProgressModal'
import MangaDiscover from './MangaDiscover'
import { mangaCoverSrc } from '../../hooks/useManga'
import { isMangaAdult, mangaNameVariants } from '../../lib/manga'
import {
  useMangaContinueReading,
  useToggleMangaBookmark,
  mangaLibraryId,
} from '../../hooks/useMangaLibrary'
import { useMangaPopup, type MangaPopupData } from '../../hooks/useMangaPopup'
import styles from '../../pages/Home.module.css'

const MangaHome: React.FC = () => {
  const navigate = useNavigate()
  const { data, isLoading } = useMangaContinueReading(24)
  const { toggle, bookmarkedIds } = useToggleMangaBookmark()
  const { popup, openPopup, scheduleClose, cancelClose, closePopup } = useMangaPopup()
  const [resetTarget, setResetTarget] = useState<{
    libId: string
    title: string
  } | null>(null)

  const items = data?.data ?? []

  const toPopupData = (libId: string): MangaPopupData | null => {
    const item = items.find((d) => d.id === libId)
    if (!item) return null
    return {
      provider: item.provider,
      mangaId: item.mangaId,
      title: item.title,
      altTitle: item.altTitle,
      cover: item.cover || '',
      contentRating: item.contentRating || undefined,
      readTarget: item.chapterId
        ? `/manga/${item.provider}/${encodeURIComponent(item.mangaId)}/read?chapter=${encodeURIComponent(item.chapterId)}`
        : `/manga/${item.provider}/${encodeURIComponent(item.mangaId)}`,
      progressLabel:
        item.chapterNumber && Number(item.pageCount) > 0
          ? `Ch. ${item.chapterNumber} · p. ${item.page ?? 0}/${item.pageCount}`
          : undefined,
    }
  }

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <MediaSection
        title="Continue Reading"
        eyebrow="Pick up where you left off"
        titleLink="/reading-list/Continue Reading"
        loading={isLoading}
        carousel
        collapsible
        defaultExpanded={items.length > 0}
        highlight
        itemCount={items.length}
        loadingSkeleton={<div className="skeleton" style={{ aspectRatio: '3 / 4' }} />}
        skeletonCount={7}
        emptyState={
          <div className={styles.emptyState}>
            <Icon name="book" size={48} className={styles.emptyStateIcon} />
            <div>
              <h3 className={styles.emptyStateTitle}>Nothing is here...</h3>
              <p className={styles.emptyStateText}>
                You haven&apos;t read anything yet. Browse manga and open a chapter to start
                tracking.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate('/manga')}
              style={{ marginTop: '1rem' }}
            >
              Browse Manga
            </Button>
          </div>
        }
      >
        {items.map((item) => {
          const page = item.page ?? 0
          const pageCount = item.pageCount ?? 0
          const readTarget = item.chapterId
            ? `/manga/${item.provider}/${encodeURIComponent(item.mangaId)}/read?chapter=${encodeURIComponent(item.chapterId)}`
            : `/manga/${item.provider}/${encodeURIComponent(item.mangaId)}`
          return (
            <MediaCard
              key={item.id}
              item={{
                id: item.id,
                title: item.title,
                ...mangaNameVariants({ title: item.title, altTitle: item.altTitle }),
                thumbnail: mangaCoverSrc(item.provider, item.cover || ''),
                chapterBadge: item.chapterNumber ? `Ch. ${item.chapterNumber}` : null,
                isAdult: isMangaAdult(item),
              }}
              linkTo={readTarget}
              hoverIcon="book"
              progress={
                pageCount > 0
                  ? {
                      percent: (page / pageCount) * 100,
                      label: `Ch. ${item.chapterNumber} · p. ${page}/${pageCount}`,
                    }
                  : undefined
              }
              showProgress
              display={{
                elements: {
                  poster: { typeBadge: false, chapterBadge: true, adultBadge: true },
                  info: { title: true, mobileBadges: true, progress: true, meta: false },
                },
              }}
              onRemove={() => setResetTarget({ libId: item.id, title: item.title })}
              onOpenDetails={(rect) => {
                const popupData = toPopupData(item.id)
                if (popupData) openPopup(rect, popupData)
              }}
              onPopupHoverIntent={(inside) => (inside ? cancelClose() : scheduleClose())}
              rawThumbnail
            />
          )
        })}
      </MediaSection>
      {popup && (
        <MangaPopup
          data={popup.data}
          anchorRect={popup.rect}
          bookmarked={bookmarkedIds.has(mangaLibraryId(popup.data.provider, popup.data.mangaId))}
          onToggleBookmark={() =>
            toggle({
              id: popup.data.mangaId,
              provider: popup.data.provider,
              title: popup.data.title,
              cover: popup.data.cover,
              altTitle: popup.data.altTitle ?? undefined,
              contentRating: popup.data.contentRating,
            })
          }
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onRequestClose={closePopup}
        />
      )}
      <MangaResetProgressModal
        mangaId={resetTarget ? resetTarget.libId : null}
        title={resetTarget?.title}
        onClose={() => setResetTarget(null)}
      />
      <MangaDiscover />
    </div>
  )
}

export default MangaHome
