import React from 'react'
import AnimeCard from './AnimeCard'
import AnimeCardSkeleton from './AnimeCardSkeleton'
import MediaSection from '../common/MediaSection'

interface Anime {
  _id: string
  id: string
  name: string
  thumbnail: string
  nativeName?: string
  englishName?: string
  type?: string
  episodeNumber?: number
  currentTime?: number
  duration?: number
  watchedCount?: number
  episodeCount?: number
  availableEpisodesDetail?: {
    sub?: string[]
    dub?: string[]
  }
}

interface AnimeSectionConfig {
  elements?: {
    poster?: {
      typeBadge?: boolean
      episodeBadge?: boolean
      removeButton?: boolean
      adultBadge?: boolean
    }
    info?: {
      title?: boolean
      mobileBadges?: boolean
      progress?: boolean
      meta?: boolean
    }
  }
}

interface AnimeSectionProps {
  title: string
  eyebrow?: string
  animeList: Anime[]
  continueWatching?: boolean
  titleLink?: string
  onRemove?: (id: string) => void
  loading?: boolean
  emptyState?: React.ReactNode
  carousel?: boolean
  cardConfig?: AnimeSectionConfig
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
      {carousel
        ? animeList.map((anime) => (
            <AnimeCard
              key={anime._id}
              anime={anime}
              continueWatching={continueWatching}
              onRemove={onRemove}
              config={cardConfig}
              layout={currentLayout}
            />
          ))
        : animeList.map((anime) => (
            <AnimeCard
              key={anime._id}
              anime={anime}
              continueWatching={continueWatching}
              onRemove={onRemove}
              config={cardConfig}
              layout={currentLayout}
            />
          ))}
    </MediaSection>
  )
}

export default React.memo(AnimeSection)
