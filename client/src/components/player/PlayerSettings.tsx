import React, { useState } from 'react'
import { FaChevronLeft, FaClosedCaptioning, FaCog, FaCheck } from 'react-icons/fa'
import styles from './PlayerSettings.module.css'
import type { VideoSource, VideoLink, SubtitleTrack } from '../../types/player'
import type { Anime4KProfile } from '../../hooks/useAnime4K'

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
  anime4kEnabled: boolean
  onAnime4kToggle: (value: boolean) => void
  anime4kSupported: boolean
  anime4kProfile: Anime4KProfile
  onAnime4kProfileChange: (profile: Anime4KProfile) => void
  anime4kInitializing: boolean
  anime4kError: string | null
  videoDelayEnabled: boolean
  onVideoDelayToggle: (value: boolean) => void
  videoDelayMs: number
  onVideoDelayChange: (ms: number) => void
  onCalibrateAvSync: () => void
}

type SettingsView = 'main' | 'quality' | 'subtitles' | 'subtitle-style' | 'upscaler' | 'av-sync'

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
    anime4kEnabled,
    onAnime4kToggle,
    anime4kSupported,
    anime4kProfile,
    onAnime4kProfileChange,
    anime4kInitializing,
    anime4kError,
    videoDelayEnabled,
    onVideoDelayToggle,
    videoDelayMs,
    onVideoDelayChange,
    onCalibrateAvSync,
  } = props
  const [view, setView] = useState<SettingsView>('main')
  const [pendingDelayMs, setPendingDelayMs] = useState<number | null>(null)
  const shownDelayMs = pendingDelayMs ?? videoDelayMs

  const commitDelay = () => {
    if (pendingDelayMs !== null) {
      onVideoDelayChange(pendingDelayMs)
      setPendingDelayMs(null)
    }
  }

  React.useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => setView('main'), 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  React.useEffect(() => {
    setPendingDelayMs(null)
  }, [videoDelayMs])

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
      {anime4kSupported && (
        <button
          className={`${styles.menuItem} ${anime4kEnabled ? styles.selected : ''}`}
          onClick={() => {
            onAnime4kToggle(!anime4kEnabled)
          }}
        >
          <span>Anime4K Upscaler</span>
          {anime4kEnabled && <FaCheck size={12} />}
        </button>
      )}
      {anime4kSupported && anime4kEnabled && (
        <button className={styles.menuItem} onClick={() => setView('upscaler')}>
          <span>Upscaler Settings</span>
        </button>
      )}
      <button className={styles.menuItem} onClick={() => setView('av-sync')}>
        <span>A/V Sync</span>
        <span className={styles.currentValue}>
          {videoDelayEnabled ? `${videoDelayMs}ms` : 'Off'}
        </span>
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

  const renderUpscaler = () => (
    <div className={styles.menuContent}>
      {anime4kInitializing && (
        <div className={styles.menuNote} role="status">
          Preparing GPU, this can take a few seconds…
        </div>
      )}
      {anime4kError && (
        <div className={styles.menuError} role="alert">
          Upscaler failed: {anime4kError}
        </div>
      )}
      <button
        className={`${styles.menuItem} ${anime4kProfile === 'low' ? styles.selected : ''}`}
        onClick={() => onAnime4kProfileChange('low')}
      >
        <div>
          <div>Low</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
            Lightest, best for weaker GPUs
          </div>
        </div>
        {anime4kProfile === 'low' && <FaCheck size={12} />}
      </button>
      <button
        className={`${styles.menuItem} ${anime4kProfile === 'balanced' ? styles.selected : ''}`}
        onClick={() => onAnime4kProfileChange('balanced')}
      >
        <div>
          <div>Balanced</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
            Source + display aware
          </div>
        </div>
        {anime4kProfile === 'balanced' && <FaCheck size={12} />}
      </button>
      <button
        className={`${styles.menuItem} ${anime4kProfile === 'high' ? styles.selected : ''}`}
        onClick={() => onAnime4kProfileChange('high')}
      >
        <div>
          <div>High</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
            Aggressive, needs strong GPU
          </div>
        </div>
        {anime4kProfile === 'high' && <FaCheck size={12} />}
      </button>
      <button
        className={`${styles.menuItem} ${anime4kProfile === 'denoise' ? styles.selected : ''}`}
        onClick={() => onAnime4kProfileChange('denoise')}
      >
        <div>
          <div>Denoise</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
            Denoise + upscale noisy, compressed sources
          </div>
        </div>
        {anime4kProfile === 'denoise' && <FaCheck size={12} />}
      </button>
    </div>
  )

  const renderAvSync = () => (
    <div className={styles.menuContent}>
      <button
        className={`${styles.menuItem} ${videoDelayEnabled ? styles.selected : ''}`}
        onClick={() => onVideoDelayToggle(!videoDelayEnabled)}
      >
        <span>Video delay</span>
        {videoDelayEnabled && <FaCheck size={12} />}
      </button>
      <div className={styles.sliderGroup}>
        <label>Video delay ({shownDelayMs}ms)</label>
        <input
          type="range"
          min="0"
          max="500"
          step="5"
          value={shownDelayMs}
          onInput={(e) => setPendingDelayMs(Number((e.target as HTMLInputElement).value))}
          onPointerUp={commitDelay}
          onTouchEnd={commitDelay}
          onKeyUp={commitDelay}
          onBlur={commitDelay}
          style={{ '--slider-percent': `${(shownDelayMs / 500) * 100}%` } as React.CSSProperties}
        />
      </div>
      <div className={styles.menuNote}>
        For Bluetooth headsets where audio arrives late. Video is held back via canvas; audio plays
        untouched.
      </div>
      <button className={styles.menuItem} onClick={onCalibrateAvSync}>
        <span>Calibrate…</span>
      </button>
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
        {view === 'upscaler' && renderUpscaler()}
        {view === 'av-sync' && renderAvSync()}
      </div>
    </div>
  )
}

export default React.forwardRef(PlayerSettings)
