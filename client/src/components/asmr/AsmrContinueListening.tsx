import React, { useState } from 'react'
import { useNavigate } from 'react-router'
import HomeEmptyState from '../common/HomeEmptyState'
import MediaSection from '../common/MediaSection'
import MediaCard from '../common/MediaCard'
import AsmrResetProgressModal from './AsmrResetProgressModal'
import { formatTime } from '../../lib/utils'
import { useAsmrContinueListening, type ContinueListeningItem } from '../../hooks/useAsmrLibrary'

function progressLabel(item: ContinueListeningItem): string | undefined {
  const current = item.currentTime ?? 0
  const total = item.duration ?? 0
  const trackNo = (item.trackIndex ?? 0) + 1
  if (total > 0) return `Track ${trackNo} · ${formatTime(current)} / ${formatTime(total)}`
  if (item.trackLabel) return `Track ${trackNo} · ${item.trackLabel}`
  return `Track ${trackNo}`
}

const AsmrContinueListening: React.FC<{
  title?: string
  limit?: number
  titleLink?: string
  showEmptyState?: boolean
}> = ({ title = 'Continue Listening', limit = 24, titleLink, showEmptyState = true }) => {
  const navigate = useNavigate()
  const { data, isLoading } = useAsmrContinueListening(limit)
  const [resetTarget, setResetTarget] = useState<{
    workId: string
    title: string
  } | null>(null)

  const items = data?.data ?? []

  return (
    <>
      <MediaSection
        title={title}
        eyebrow="Pick up where you left off"
        titleLink={titleLink ?? '/listening-list/Continue Listening'}
        loading={isLoading}
        carousel
        collapsible
        defaultExpanded={items.length > 0}
        highlight
        itemCount={items.length}
        loadingSkeleton={<div className="skeleton" style={{ aspectRatio: '16 / 9' }} />}
        skeletonCount={7}
        emptyState={
          showEmptyState ? (
            <HomeEmptyState
              icon="headphones"
              text="You haven't listened to anything yet. Browse ASMR and play a track to start tracking."
              actionLabel="Browse ASMR"
              onAction={() => navigate('/asmr')}
            />
          ) : undefined
        }
      >
        {items.map((item) => {
          const current = item.currentTime ?? 0
          const total = item.duration ?? 0
          const rj = item.rjCode || item.id
          return (
            <MediaCard
              key={item.id}
              item={{
                id: item.id,
                title: item.title,
                thumbnail: item.thumbnail || '',
                chapterBadge: `Track ${(item.trackIndex ?? 0) + 1}`,
                isAdult: !!item.isAdult,
              }}
              linkTo={`/asmr/${encodeURIComponent(rj)}`}
              hoverIcon="play"
              layout="horizontal"
              progress={
                total > 0
                  ? {
                      percent: Math.min(100, (current / total) * 100),
                      label: progressLabel(item) ?? '',
                    }
                  : undefined
              }
              showProgress
              display={{
                elements: {
                  poster: {
                    typeBadge: false,
                    chapterBadge: true,
                    adultBadge: true,
                    removeButton: true,
                  },
                  info: { title: true, mobileBadges: true, progress: true, meta: false },
                },
              }}
              onRemove={() => setResetTarget({ workId: item.id, title: item.title })}
              rawThumbnail
            />
          )
        })}
      </MediaSection>
      <AsmrResetProgressModal
        workId={resetTarget ? resetTarget.workId : null}
        title={resetTarget?.title}
        onClose={() => setResetTarget(null)}
      />
    </>
  )
}

export default AsmrContinueListening
