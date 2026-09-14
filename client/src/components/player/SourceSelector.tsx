import React from 'react'
import styles from './Player.module.css'
import type { VideoSource } from '../../pages/Player'
import { PROVIDER_OPTIONS, SUB_LABEL, TIER_LABEL, TIER_ORDER, type ProviderId } from './providers'

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
        {TIER_ORDER.map((tier) => {
          const group = visibleProviders.filter((option) => (option.tier ?? 'direct') === tier)
          if (group.length === 0) return null
          return (
            <optgroup key={tier} label={TIER_LABEL[tier]}>
              {group.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.sub ? `${option.label} (${SUB_LABEL[option.sub]})` : option.label}
                </option>
              ))}
            </optgroup>
          )
        })}
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
