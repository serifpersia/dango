import React, { memo } from 'react'
import Icon from '../common/Icon'
import MediaCard from '../common/MediaCard'
import TvPopup from './TvPopup'
import { isTvAdult, tvDetailPath } from '../../lib/tv'

interface TvItem {
  id: number
  title: string
  year: string
  type: string
  image: string
  vote_average?: number
  adult?: boolean
  overview?: string
  genre_ids?: number[]
}

interface TvCardProps {
  item: TvItem
}

const TvCard: React.FC<TvCardProps> = memo(({ item }) => {
  const isTV = item.type === 'tv' || item.type === 'tvSeries' || item.type === 'tvMiniSeries'
  const path = tvDetailPath(item.type, item.id)

  return (
    <MediaCard
      item={{
        id: String(item.id),
        title: item.title,
        thumbnail: item.image,
        typeBadge: isTV ? 'TV' : 'Movie',
        isAdult: isTvAdult(item),
      }}
      linkTo={path}
      hoverIcon="info"
      showInfoButton
      metaRow={
        <>
          {item.year && <span style={{ opacity: 0.75 }}>{item.year}</span>}
          {item.vote_average != null && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Icon name="star" size={10} />
              {Number(item.vote_average).toFixed(1)}
            </span>
          )}
        </>
      }
      renderPopup={(anchorRect, helpers) => (
        <TvPopup
          item={item}
          anchorRect={anchorRect}
          onMouseEnter={helpers.onMouseEnter}
          onMouseLeave={helpers.onMouseLeave}
          onRequestClose={helpers.close}
        />
      )}
    />
  )
})

export default TvCard
