import React, { useMemo, useState } from 'react'
import Icon from '../common/Icon'
import styles from './PlayerSettings.module.css'
import type { VideoSource, VideoLink, SubtitleTrack } from '../../types/player'
import type { Anime4KProfile } from '../../hooks/useAnime4K'
import { type SubtitleEdge } from '../../lib/subtitleStyle'
import SettingsShell from './SettingsShell'
import SubtitleStyleMenu from './SubtitleStyleMenu'
import AvSyncMenu from './AvSyncMenu'
import OptionListMenu from './OptionListMenu'
import type { FallbackChoice } from '../../lib/fallbackChoice'

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
    bgOpacity: number
    bgColor: string
    textColor: string
    edge: SubtitleEdge
    bold: boolean
  }
  onSubtitleSettingsChange: (
    key: 'fontSize' | 'position' | 'bgOpacity' | 'bgColor' | 'textColor' | 'edge' | 'bold',
    value: number | string | boolean
  ) => void
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
  isAutoSkipEnabled: boolean
  onAutoSkipChange: (value: boolean) => void
  isAutoplayEnabled: boolean
  onAutoplayChange: (value: boolean) => void
  fallbackChoice: FallbackChoice
  onFallbackChoiceChange: (value: FallbackChoice) => void
}

type SettingsView =
  'main' | 'quality' | 'subtitles' | 'subtitle-style' | 'upscaler' | 'av-sync' | 'playback'

const PlayerSettings = (props: PlayerSettingsProps, ref: React.ForwardedRef<HTMLDivElement>) => {
  const {
    isOpen,
    onClose: _onClose,
    videoSources: _videoSources,
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
    isAutoSkipEnabled,
    onAutoSkipChange,
    isAutoplayEnabled,
    onAutoplayChange,
    fallbackChoice,
    onFallbackChoiceChange,
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
        {useNativeControls && <Icon name="check" size={12} />}
      </button>
      {anime4kSupported && (
        <button
          className={`${styles.menuItem} ${anime4kEnabled ? styles.selected : ''}`}
          onClick={() => {
            onAnime4kToggle(!anime4kEnabled)
          }}
        >
          <span>Anime4K Upscaler</span>
          {anime4kEnabled && <Icon name="check" size={12} />}
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
      <button className={styles.menuItem} onClick={() => setView('playback')}>
        <span>Playback</span>
        <span className={styles.currentValue}>
          {[isAutoSkipEnabled ? 'Auto-skip On' : null, isAutoplayEnabled ? 'Autoplay On' : null]
            .filter(Boolean)
            .join(' • ') || 'Off'}
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
        <OptionListMenu
          classes={{ item: styles.menuItem, active: styles.selected }}
          options={links.map((link) => ({
            key: link.resolutionStr,
            label: link.resolutionStr,
            selected: currentLink?.resolutionStr === link.resolutionStr,
          }))}
          onSelect={(key) => {
            const link = links.find((l) => l.resolutionStr === key)
            if (link) onSourceChange(currentSource!, link)
          }}
        />
      </div>
    )
  }

  const renderSubtitles = () => (
    <div className={styles.menuContent}>
      <OptionListMenu
        classes={{ item: styles.menuItem, active: styles.selected }}
        options={[
          { key: 'off', label: 'Off', selected: activeSubtitleTrack === 'off' },
          ...subtitles.map((sub) => ({
            key: sub.label || sub.lang,
            label: sub.label,
            selected: activeSubtitleTrack === (sub.label || sub.lang),
          })),
        ]}
        onSelect={(key) => onSubtitleChange(key)}
      />
    </div>
  )

  const renderSubtitleStyle = () => (
    <div className={styles.menuContent}>
      <SubtitleStyleMenu
        classes={{ item: styles.menuItem, active: styles.selected }}
        values={subtitleSettings}
        onChange={onSubtitleSettingsChange}
      />
    </div>
  )

  const isChromiumBased = useMemo(() => {
    try {
      const nav = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }
      const brands = nav.userAgentData?.brands?.map((b) => b.brand.toLowerCase()) ?? []
      if (brands.length > 0) {
        return brands.some(
          (b) =>
            b.includes('chromium') ||
            b.includes('chrome') ||
            b.includes('edge') ||
            b.includes('opera') ||
            b.includes('brave') ||
            b.includes('vivaldi')
        )
      }
      const ua = navigator.userAgent.toLowerCase()
      return ua.includes('chrome') || ua.includes('chromium') || ua.includes('edg')
    } catch {
      return true
    }
  }, [])

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
      {!isChromiumBased && (
        <div className={styles.menuNote}>
          Upscaling performs best in Chrome-based browsers.
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
        {anime4kProfile === 'low' && <Icon name="check" size={12} />}
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
        {anime4kProfile === 'balanced' && <Icon name="check" size={12} />}
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
        {anime4kProfile === 'high' && <Icon name="check" size={12} />}
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
        {anime4kProfile === 'denoise' && <Icon name="check" size={12} />}
      </button>
    </div>
  )

  const renderPlayback = () => (
    <div className={styles.menuContent}>
      <button
        type="button"
        className={`${styles.menuItem} ${isAutoSkipEnabled ? styles.selected : ''}`}
        onClick={() => onAutoSkipChange(!isAutoSkipEnabled)}
        aria-pressed={isAutoSkipEnabled}
      >
        <span>Auto-skip openings and endings</span>
        <span className={styles.currentValue}>{isAutoSkipEnabled ? 'On' : 'Off'}</span>
      </button>
      <div className={styles.menuNote}>
        Automatically jump past opening, ending and recap segments when detected.
      </div>
      <button
        type="button"
        className={`${styles.menuItem} ${isAutoplayEnabled ? styles.selected : ''}`}
        onClick={() => onAutoplayChange(!isAutoplayEnabled)}
        aria-pressed={isAutoplayEnabled}
      >
        <span>Autoplay next episode</span>
        <span className={styles.currentValue}>{isAutoplayEnabled ? 'On' : 'Off'}</span>
      </button>
      <div className={styles.menuNote}>
        Automatically start the next episode when this one ends.
      </div>
      <button
        type="button"
        className={styles.menuItem}
        onClick={() =>
          onFallbackChoiceChange(
            fallbackChoice === 'ask' ? 'iframe' : fallbackChoice === 'iframe' ? 'retry' : 'ask'
          )
        }
      >
        <span>Failed direct stream</span>
        <span className={styles.currentValue}>
          {fallbackChoice === 'iframe'
            ? 'Use iframe'
            : fallbackChoice === 'retry'
              ? 'Try provider'
              : 'Ask me'}
        </span>
      </button>
      <div className={styles.menuNote}>
        When a direct stream fails: ask each time, go straight to the embedded player (may show
        ads), or automatically try another provider.
      </div>
    </div>
  )

  const renderAvSync = () => (
    <div className={styles.menuContent}>
      <AvSyncMenu
        classes={{ item: styles.menuItem, active: styles.selected, note: styles.menuNote }}
        enabled={videoDelayEnabled}
        delayMs={videoDelayMs}
        onToggle={onVideoDelayToggle}
        onDelayChange={onVideoDelayChange}
        onCalibrate={onCalibrateAvSync}
      />
    </div>
  )

  if (!isOpen) return null

  return (
    <SettingsShell
      classes={{
        panel: styles.settingsPanel,
        header: styles.header,
        backBtn: styles.backBtn,
        title: '',
        content: styles.contentWrapper,
      }}
      title={
        view === 'main'
          ? 'Settings'
          : view.charAt(0).toUpperCase() + view.slice(1).replace('-', ' ')
      }
      titleTag="h3"
      showBack={view !== 'main'}
      onBack={() => setView('main')}
      panelRef={ref}
      onPanelClick={(e) => e.stopPropagation()}
    >
      {view === 'main' && renderMain()}
      {view === 'quality' && renderQuality()}
      {view === 'subtitles' && renderSubtitles()}
      {view === 'subtitle-style' && renderSubtitleStyle()}
      {view === 'upscaler' && renderUpscaler()}
      {view === 'av-sync' && renderAvSync()}
      {view === 'playback' && renderPlayback()}
    </SettingsShell>
  )
}

export default React.forwardRef(PlayerSettings)
