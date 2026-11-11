import React from 'react'
import styles from './SourceSelector.module.css'
import type { VideoLink, VideoSource } from '../../types/player'
import { SUB_LABEL, TIER_LABEL, TIER_ORDER, type ProviderOption } from '../../types/providers'

interface ProviderSelectorProps {
  selectedProvider: string
  onProviderChange: (provider: string) => void
  isAdult?: boolean
  options?: ProviderOption[]
}

export const ProviderSelector: React.FC<ProviderSelectorProps> = ({
  selectedProvider,
  onProviderChange,
  isAdult,
  options,
}) => {
  const list = options && options.length > 0 ? options : []
  const isMatureProvider = (option: ProviderOption) =>
    option.mature || option.kind === 'hentai' || option.kind === 'adult'
  const visibleProviders = list.filter((option) => isMatureProvider(option) === (isAdult === true))

  return (
    <div className={styles.providerSelectContainer}>
      <h4>Provider</h4>
      <select
        className={styles.providerSelect}
        value={selectedProvider}
        onChange={(e) => onProviderChange(e.currentTarget.value)}
      >
        {TIER_ORDER.map((tier) => {
          const group = visibleProviders.filter((option) => (option.tier ?? 'direct') === tier)
          if (group.length === 0) return null
          return (
            <optgroup key={tier} label={TIER_LABEL[tier]}>
              {group.map((option) => (
                <option key={option.id} value={option.id}>
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
  selectedLink: VideoLink | null
  onSourceChange: (source: VideoSource) => void
  onLinkChange: (link: VideoLink) => void
}

const SourceSelector: React.FC<SourceSelectorProps> = ({
  videoSources,
  selectedSource,
  selectedLink,
  onSourceChange,
  onLinkChange,
}) => {
  const sources = Array.isArray(videoSources) ? videoSources : []

  if (sources.length === 0) return null

  const showVariantPicker =
    selectedSource?.type === 'iframe' && (selectedSource.links?.length ?? 0) > 1

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
      {showVariantPicker && (
        <select
          className={styles.sourceSelect}
          aria-label="Fallback embed quality"
          value={selectedLink?.link ?? selectedSource.links[0]?.link ?? ''}
          onChange={(e) => {
            const link = selectedSource.links.find((l) => l.link === e.currentTarget.value)
            if (link) onLinkChange(link)
          }}
        >
          {selectedSource.links.map((link) => (
            <option key={link.link} value={link.link}>
              {link.resolutionStr}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

export default React.memo(SourceSelector, (prevProps, nextProps) => {
  return (
    prevProps.selectedSource?.sourceName === nextProps.selectedSource?.sourceName &&
    prevProps.selectedLink?.link === nextProps.selectedLink?.link &&
    prevProps.videoSources === nextProps.videoSources
  )
})
