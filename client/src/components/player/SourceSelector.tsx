import React from 'react'
import styles from './Player.module.css'
import type { VideoSource } from '../../pages/Player'

type ProviderId =
  | 'anidb'
  | 'anilight'
  | 'megaplay'
  | 'animepahe'
  | 'animeya'
  | '123anime'
  | 'wh'
  | 'hn'
  | 'ht'
  | 'op'

const PROVIDER_OPTIONS: { value: ProviderId; label: string; mature: boolean }[] = [
  { value: 'megaplay', label: 'MegaPlay', mature: false },
  { value: 'anilight', label: 'Anilight', mature: false },
  { value: 'animepahe', label: 'AnimePahe', mature: false },
  { value: 'animeya', label: 'Animeya', mature: false },
  { value: '123anime', label: '123Anime', mature: false },
  { value: 'wh', label: 'WH', mature: true },
  { value: 'hn', label: 'HN', mature: true },
  { value: 'ht', label: 'HT', mature: true },
  { value: 'op', label: 'OP', mature: true },
  { value: 'anidb', label: 'AniDB', mature: false },
]

interface ProviderSelectorProps {
  selectedProvider: ProviderId
  onProviderChange: (provider: ProviderId) => void
  isAdult?: boolean
}

export const ProviderSelector: React.FC<ProviderSelectorProps> = ({
  selectedProvider,
  onProviderChange,
  isAdult,
}) => {
  const visibleProviders =
    isAdult === undefined
      ? PROVIDER_OPTIONS
      : PROVIDER_OPTIONS.filter((option) => option.mature === isAdult)

  return (
    <div className={styles.providerSelectContainer}>
      <h4>Provider</h4>
      <select
        className={styles.providerSelect}
        value={selectedProvider}
        onChange={(e) => onProviderChange(e.target.value as ProviderId)}
      >
        {visibleProviders.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

interface SourceSelectorProps {
  videoSources: VideoSource[]
  selectedSource: VideoSource | null
  onSourceChange: (source: VideoSource) => void
}

const SourceSelector: React.FC<SourceSelectorProps> = ({
  videoSources,
  selectedSource,
  onSourceChange,
}) => {
  const sources = Array.isArray(videoSources) ? videoSources : []

  if (sources.length === 0) return null

  return (
    <div className={styles.sourceSelectionContainer}>
      <h4>Source</h4>
      <div className={styles.sourceButtons}>
        {sources.map((source, i) => (
          <button
            key={`${source.sourceName}-${i}`}
            className={`${styles.sourceButton} ${selectedSource?.sourceName === source.sourceName ? styles.active : ''} `}
            onClick={() => onSourceChange(source)}
          >
            {source.sourceName}
          </button>
        ))}
      </div>
    </div>
  )
}

export default React.memo(SourceSelector, (prevProps, nextProps) => {
  return (
    prevProps.selectedSource?.sourceName === nextProps.selectedSource?.sourceName &&
    prevProps.videoSources === nextProps.videoSources
  )
})
