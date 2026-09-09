import type { DetailedShowMeta } from '../../types/player'
import { getAnimeMetaDetails } from '../../lib/animeMeta'
import ownStyles from './AnimeMetaDetails.module.css'

interface AnimeMetaDetailsProps {
  showMeta: Partial<DetailedShowMeta> | undefined
  styles?: {
    detailsGridContainer: string
    detailItem: string
  }
}

export default function AnimeMetaDetails({ showMeta, styles }: AnimeMetaDetailsProps) {
  const resolved = styles ?? ownStyles
  const metaDetails = getAnimeMetaDetails(showMeta)

  return (
    <div className={resolved.detailsGridContainer}>
      {metaDetails.map((detail) => (
        <div className={resolved.detailItem} key={detail.label}>
          <strong>{detail.label}</strong>
          <span>{detail.value}</span>
        </div>
      ))}
    </div>
  )
}
