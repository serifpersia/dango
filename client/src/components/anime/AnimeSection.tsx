import React from 'react'
import AnimeCard from './AnimeCard'
import AnimeCardSkeleton from '../common/AnimeCardSkeleton'
import MediaSection from '../common/MediaSection'
import type { MediaCardDisplay } from '../common/MediaCard'
import type { AnimeShow as Anime } from '../../types/player'

interface AnimeSectionProps {
  title: string
  eyebrow?: string
  animeList: Anime[]
  continueWatching?: boolean
  episodeBadge?: boolean
  titleLink?: string
  onRemove?: (id: string) => void
  loading?: boolean
  emptyState?: React.ReactNode
  carousel?: boolean
  cardConfig?: MediaCardDisplay
  layout?: 'vertical' | 'horizontal'
  onReachThreshold?: () => void
  scrollThreshold?: number
  isFetchingNextPage?: boolean
  collapsible?: boolean
  defaultExpanded?: boolean
}

const AnimeSection: React.FC<AnimeSectionProps> = ({
  title,
  eyebrow,
  animeList,
  continueWatching,
  episodeBadge,
  titleLink,
  onRemove,
  loading,
  emptyState,
  carousel,
  cardConfig,
  layout,
  onReachThreshold,
  scrollThreshold,
  isFetchingNextPage,
  collapsible,
  defaultExpanded = true,
}) => {
  const currentLayout = layout || 'vertical'

  return (
    <MediaSection
      title={title}
      eyebrow={eyebrow}
      titleLink={titleLink}
      loading={loading}
      emptyState={emptyState}
      carousel={carousel}
      layout={currentLayout}
      collapsible={collapsible}
      defaultExpanded={defaultExpanded}
      onReachThreshold={onReachThreshold}
      scrollThreshold={scrollThreshold}
      isFetchingNextPage={isFetchingNextPage}
      resetScrollOnShrink={continueWatching}
      highlight={continueWatching}
      itemCount={animeList.length}
      loadingSkeleton={<AnimeCardSkeleton layout={currentLayout} />}
      skeletonCount={7}
    >
      {animeList.map((anime) => (
        <AnimeCard
          key={anime._id}
          anime={anime}
          continueWatching={continueWatching}
          episodeBadge={episodeBadge}
          onRemove={onRemove}
          config={cardConfig}
          layout={currentLayout}
        />
      ))}
    </MediaSection>
  )
}

export default React.memo(AnimeSection)
