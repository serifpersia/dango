import React from 'react'
import styles from './Player.module.css'
import type { VideoSource } from '../../pages/Player'

interface ProviderSelectorProps {
  selectedProvider:
    | 'animepahe'
    | '123anime'
    | 'animeya'
    | 'megaplay'
    | 'wh'
    | 'hn'
    | 'anilight'
    | 'anidb'
    | 'ht'
    | 'op'
  onProviderChange: (
    provider:
      | 'animepahe'
      | '123anime'
      | 'animeya'
      | 'megaplay'
      | 'wh'
      | 'hn'
      | 'anilight'
      | 'anidb'
      | 'ht'
      | 'op'
  ) => void
}

export const ProviderSelector: React.FC<ProviderSelectorProps> = ({
  selectedProvider,
  onProviderChange,
}) => {
  return (
    <div className={styles.providerSelectContainer}>
      <h4>Provider</h4>
      <select
        className={styles.providerSelect}
        value={selectedProvider}
        onChange={(e) =>
          onProviderChange(
            e.target.value as
              | 'animepahe'
              | '123anime'
              | 'animeya'
              | 'megaplay'
              | 'wh'
              | 'hn'
              | 'anilight'
              | 'anidb'
              | 'ht'
              | 'op'
          )
        }
      >
        <option value="anidb">AniDB</option>
        <option value="anilight">Anilight</option>
        <option value="megaplay">MegaPlay</option>
        <option value="animepahe">AnimePahe</option>
        <option value="animeya">Animeya</option>
        <option value="123anime">123Anime</option>
        <option value="wh">WH</option>
        <option value="hn">HN</option>
        <option value="ht">HT</option>
        <option value="op">OP</option>
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
