import React, { useState } from 'react'
import { FaChevronLeft, FaClosedCaptioning, FaCog, FaCheck } from 'react-icons/fa'
import styles from './PlayerSettings.module.css'
import type { VideoSource, VideoLink, SubtitleTrack } from '../../types/player'

interface PlayerSettingsProps {
  isOpen: boolean
  onClose: () => void
  videoSources: VideoSource[]
  currentSource: VideoSource | null
  currentLink: VideoLink | null
  onSourceChange: (source: VideoSource, link: VideoLink) => void
  subtitles: SubtitleTrack[]
  activeSubtitleTrack: string | null
  onSubtitleChange: (trackLabel: string | null) => void
  subtitleSettings: {
    fontSize: number
    position: number
  }
  onSubtitleSettingsChange: (key: 'fontSize' | 'position', value: number) => void
  useNativeControls: boolean
  onNativeControlsToggle: (value: boolean) => void
}

type SettingsView = 'main' | 'quality' | 'subtitles' | 'subtitle-style'

const PlayerSettings = (props: PlayerSettingsProps, ref: React.ForwardedRef<HTMLDivElement>) => {
  const {
    isOpen,
    onClose,
    videoSources,
    currentSource,
    currentLink,
    onSourceChange,
    subtitles,
    activeSubtitleTrack,
    onSubtitleChange,
    subtitleSettings,
    onSubtitleSettingsChange,
    useNativeControls,
    onNativeControlsToggle,
  } = props
  const [view, setView] = useState<SettingsView>('main')

  React.useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => setView('main'), 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const renderMain = () => (
    <div className={styles.menuContent}>
      <button className={styles.menuItem} onClick={() => setView('quality')}>
        <span>Quality</span>
        <span className={styles.currentValue}>{currentLink?.resolutionStr || 'Auto'}</span>
      </button>
      <button className={styles.menuItem} onClick={() => setView('subtitles')}>
        <span>Subtitles</span>
        <span className={styles.currentValue}>{activeSubtitleTrack || 'Off'}</span>
      </button>
      <button className={styles.menuItem} onClick={() => setView('subtitle-style')}>
        <span>Subtitle Style</span>
      </button>
      <button
        className={`${styles.menuItem} ${useNativeControls ? styles.selected : ''}`}
        onClick={() => {
          const newValue = !useNativeControls
          onNativeControlsToggle(newValue)
          localStorage.setItem('playerUseNativeControls', newValue.toString())
        }}
      >
        <span>Native Controls</span>
        {useNativeControls && <FaCheck size={12} />}
      </button>
    </div>
  )

  const renderQuality = () => {
    const links =
      currentSource?.links.sort(
        (a, b) => (parseInt(b.resolutionStr) || 0) - (parseInt(a.resolutionStr) || 0)
      ) || []
    return (
      <div className={styles.menuContent}>
        {links.map((link) => (
          <button
            key={link.resolutionStr}
            className={`${styles.menuItem} ${currentLink?.resolutionStr === link.resolutionStr ? styles.selected : ''} `}
            onClick={() => onSourceChange(currentSource!, link)}
          >
            <span>{link.resolutionStr}</span>
            {currentLink?.resolutionStr === link.resolutionStr && <FaCheck size={12} />}
          </button>
        ))}
      </div>
    )
  }

  const renderSubtitles = () => (
    <div className={styles.menuContent}>
      <button
        className={`${styles.menuItem} ${activeSubtitleTrack === 'off' ? styles.selected : ''} `}
        onClick={() => onSubtitleChange('off')}
      >
        <span>Off</span>
        {activeSubtitleTrack === 'off' && <FaCheck size={12} />}
      </button>
      {subtitles.map((sub) => (
        <button
          key={sub.label}
          className={`${styles.menuItem} ${activeSubtitleTrack === (sub.label || sub.lang) ? styles.selected : ''} `}
          onClick={() => onSubtitleChange(sub.label || sub.lang)}
        >
          <span>{sub.label}</span>
          {activeSubtitleTrack === (sub.label || sub.lang) && <FaCheck size={12} />}
        </button>
      ))}
    </div>
  )

  const renderSubtitleStyle = () => (
    <div className={styles.menuContent}>
      <div className={styles.sliderGroup}>
        <label>Font Size ({subtitleSettings.fontSize.toFixed(1)})</label>
        <input
          type="range"
          min="0.5"
          max="10"
          step="0.5"
          value={subtitleSettings.fontSize}
          onInput={(e) =>
            onSubtitleSettingsChange('fontSize', parseFloat((e.target as HTMLInputElement).value))
          }
          style={
            {
              '--slider-percent': `${((subtitleSettings.fontSize - 0.5) / 9.5) * 100}%`,
            } as React.CSSProperties
          }
        />
      </div>
      <div className={styles.sliderGroup}>
        <label>Vertical Position (Lift)</label>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={subtitleSettings.position}
          onInput={(e) =>
            onSubtitleSettingsChange('position', parseInt((e.target as HTMLInputElement).value))
          }
          style={{ '--slider-percent': `${subtitleSettings.position}%` } as React.CSSProperties}
        />
      </div>
    </div>
  )

  if (!isOpen) return null

  return (
    <div ref={ref} className={styles.settingsPanel} onClick={(e) => e.stopPropagation()}>
      <div className={styles.header}>
        {view !== 'main' && (
          <button className={styles.backBtn} onClick={() => setView('main')}>
            <FaChevronLeft />
          </button>
        )}
        <h3>
          {view === 'main'
            ? 'Settings'
            : view.charAt(0).toUpperCase() + view.slice(1).replace('-', ' ')}
        </h3>
      </div>

      <div className={styles.contentWrapper}>
        {view === 'main' && renderMain()}
        {view === 'quality' && renderQuality()}
        {view === 'subtitles' && renderSubtitles()}
        {view === 'subtitle-style' && renderSubtitleStyle()}
      </div>
    </div>
  )
}

export default React.forwardRef(PlayerSettings)
