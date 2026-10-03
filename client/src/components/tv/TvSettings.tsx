import React from 'react'
import Icon from '../common/Icon'
import styles from './TvPlayerControls.module.css'
import SettingsShell from '../player/SettingsShell'
import SubtitleStyleMenu, { type SubtitleStyleKey } from '../player/SubtitleStyleMenu'
import SubtitleDelayMenu from '../player/SubtitleDelayMenu'
import AvSyncMenu from '../player/AvSyncMenu'
import AmbientLightMenu from '../player/AmbientLightMenu'
import OptionListMenu from '../player/OptionListMenu'
import { formatSubtitleDelay } from '../../lib/subtitleStyle'
import type { AmbientLightSettings } from '../../hooks/useAmbientLight'
import type useVideoPlayer from '../../hooks/useVideoPlayer'

export type TvSettingsView =
  | 'main'
  | 'quality'
  | 'subtitles'
  | 'subtitle-style'
  | 'subtitle-timing'
  | 'audio'
  | 'server'
  | 'av-sync'
  | 'ambient'
  | null

interface TvSettingsProps {
  view: Exclude<TvSettingsView, null>
  onSelectView: (view: TvSettingsView) => void
  onClose: () => void
  player: ReturnType<typeof useVideoPlayer>
  onSubtitleStyleChange: (key: SubtitleStyleKey, value: number | string | boolean) => void
  streams: { quality: string; type: string }[]
  qualityIdx: number
  onQualityChange: (idx: number) => void
  isMovySource: boolean
  movyServers: readonly string[]
  selectedMovyServer: string
  onMovyServerSelect?: (city: string) => void
  hasSubtitles: boolean
  subtitles: { language: string; label: string; url: string }[]
  selectedSubtitle: number
  isSubtitleActive: boolean
  onSubtitleChange: (index: number) => void
  audioTracks: { language: string; label: string }[]
  selectedAudioTrack: number
  onAudioTrackChange: (index: number) => void
  videoDelayEnabled: boolean
  onVideoDelayToggle?: (value: boolean) => void
  videoDelayMs: number
  onVideoDelayChange?: (ms: number) => void
  onCalibrate: () => void
  subtitleDelayMs: number
  onSubtitleDelayChange?: (ms: number) => void
  ambientSettings?: AmbientLightSettings
  onAmbientChange?: (patch: Partial<AmbientLightSettings>) => void
}

const TvSettings: React.FC<TvSettingsProps> = ({
  view,
  onSelectView,
  onClose,
  player,
  onSubtitleStyleChange,
  streams,
  qualityIdx,
  onQualityChange,
  isMovySource,
  movyServers,
  selectedMovyServer,
  onMovyServerSelect,
  hasSubtitles,
  subtitles,
  selectedSubtitle,
  isSubtitleActive,
  onSubtitleChange,
  audioTracks,
  selectedAudioTrack,
  onAudioTrackChange,
  videoDelayEnabled,
  onVideoDelayToggle,
  videoDelayMs,
  onVideoDelayChange,
  onCalibrate,
  subtitleDelayMs,
  onSubtitleDelayChange,
  ambientSettings,
  onAmbientChange,
}) => {
  const { state } = player

  const renderMainSettings = () => (
    <>
      {streams.length > 1 && (
        <button className={styles.menuItem} onClick={() => onSelectView('quality')}>
          <span>Quality</span>
          <span className={styles.currentValue}>{streams[qualityIdx]?.quality || 'Auto'}</span>
        </button>
      )}
      {isMovySource && movyServers.length > 0 && (
        <button className={styles.menuItem} onClick={() => onSelectView('server')}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="server" size={12} /> Movy Server
          </span>
          <span className={styles.currentValue} style={{ textTransform: 'capitalize' }}>
            {selectedMovyServer}
          </span>
        </button>
      )}
      {hasSubtitles && (
        <button className={styles.menuItem} onClick={() => onSelectView('subtitles')}>
          <span>Subtitles</span>
          <span className={styles.currentValue}>
            {isSubtitleActive
              ? subtitles[selectedSubtitle]?.label || subtitles[selectedSubtitle]?.language
              : 'Off'}
          </span>
        </button>
      )}
      {hasSubtitles && (
        <button className={styles.menuItem} onClick={() => onSelectView('subtitle-style')}>
          <span>Subtitle Style</span>
          <span className={styles.currentValue}>
            {state.subtitleFontSize.toFixed(1)}x · {state.subtitlePosition}
          </span>
        </button>
      )}
      {hasSubtitles && (
        <button className={styles.menuItem} onClick={() => onSelectView('subtitle-timing')}>
          <span>Subtitle Timing</span>
          <span className={styles.currentValue}>{formatSubtitleDelay(subtitleDelayMs)}</span>
        </button>
      )}
      {audioTracks.length > 0 && (
        <button className={styles.menuItem} onClick={() => onSelectView('audio')}>
          <span>Audio Track</span>
          <span className={styles.currentValue}>
            {audioTracks[selectedAudioTrack]?.label || audioTracks[selectedAudioTrack]?.language}
          </span>
        </button>
      )}
      <button className={styles.menuItem} onClick={() => onSelectView('av-sync')}>
        <span>A/V Sync</span>
        <span className={styles.currentValue}>
          {videoDelayEnabled ? `${videoDelayMs}ms` : 'Off'}
        </span>
      </button>
      {ambientSettings && onAmbientChange && (
        <button className={styles.menuItem} onClick={() => onSelectView('ambient')}>
          <span>Ambient Light</span>
          <span className={styles.currentValue}>{ambientSettings.enabled ? 'On' : 'Off'}</span>
        </button>
      )}
    </>
  )

  const renderQualitySettings = () => (
    <OptionListMenu
      classes={{ item: styles.menuItem, active: styles.active }}
      options={streams.map((s, i) => ({
        key: String(i),
        label: s.quality,
        selected: i === qualityIdx,
      }))}
      onSelect={(key) => onQualityChange(Number(key))}
    />
  )

  const renderSubtitleSettings = () => (
    <OptionListMenu
      classes={{ item: styles.menuItem, active: styles.active }}
      options={[
        { key: 'off', label: 'Off', selected: !isSubtitleActive },
        ...subtitles.map((track, i) => ({
          key: String(i),
          label: track.label || track.language,
          selected: i === selectedSubtitle,
        })),
      ]}
      onSelect={(key) => onSubtitleChange(key === 'off' ? -1 : Number(key))}
    />
  )

  const renderSubtitleStyleSettings = () => (
    <SubtitleStyleMenu
      classes={{ item: styles.menuItem, active: styles.active }}
      values={{
        fontSize: state.subtitleFontSize,
        position: state.subtitlePosition,
        bgOpacity: state.subtitleBgOpacity,
        bgColor: state.subtitleBgColor,
        textColor: state.subtitleTextColor,
        edge: state.subtitleEdge,
        bold: state.subtitleBold,
      }}
      onChange={onSubtitleStyleChange}
    />
  )

  const renderSubtitleTimingSettings = () => (
    <SubtitleDelayMenu
      classes={{ item: styles.menuItem, active: styles.active, note: styles.menuNote }}
      delayMs={subtitleDelayMs}
      onDelayChange={(ms) => onSubtitleDelayChange?.(ms)}
    />
  )

  const renderAudioSettings = () => (
    <OptionListMenu
      classes={{ item: styles.menuItem, active: styles.active }}
      options={audioTracks.map((track, i) => ({
        key: String(i),
        label: track.label || track.language,
        selected: i === selectedAudioTrack,
      }))}
      onSelect={(key) => onAudioTrackChange(Number(key))}
    />
  )

  const renderServerSettings = () => (
    <OptionListMenu
      classes={{ item: styles.menuItem, active: styles.active }}
      options={movyServers.map((city) => ({
        key: city,
        label: <span style={{ textTransform: 'capitalize' }}>{city}</span>,
        selected: selectedMovyServer === city,
      }))}
      onSelect={(city) => onMovyServerSelect?.(city)}
    />
  )

  const renderAvSyncSettings = () => (
    <AvSyncMenu
      classes={{ item: styles.menuItem, active: styles.active, note: styles.menuNote }}
      enabled={videoDelayEnabled}
      delayMs={videoDelayMs}
      onToggle={(v) => onVideoDelayToggle?.(v)}
      onDelayChange={(ms) => onVideoDelayChange?.(ms)}
      onCalibrate={onCalibrate}
    />
  )

  const renderAmbientSettings = () =>
    ambientSettings && onAmbientChange ? (
      <AmbientLightMenu
        classes={{ item: styles.menuItem, active: styles.active, note: styles.menuNote }}
        values={ambientSettings}
        onChange={onAmbientChange}
      />
    ) : null

  return (
    <div data-speed-boost-ignore="true" onClick={(e) => e.stopPropagation()}>
      <SettingsShell
        classes={{
          panel: styles.settingsPanel,
          header: styles.settingsHeader,
          backBtn: styles.settingsBackBtn,
          title: styles.settingsTitle,
          content: styles.settingsContent,
        }}
        title={
          view === 'main'
            ? 'Settings'
            : view === 'subtitle-style'
              ? 'Subtitle Style'
              : view === 'subtitle-timing'
                ? 'Subtitle Timing'
                : view === 'audio'
                  ? 'Audio Track'
                  : view === 'server'
                    ? 'Movy Server'
                    : view === 'av-sync'
                      ? 'A/V Sync'
                      : view === 'ambient'
                        ? 'Ambient Light'
                        : view.charAt(0).toUpperCase() + view.slice(1)
        }
        onBack={() => (view === 'main' ? onClose() : onSelectView('main'))}
      >
        {view === 'main' && renderMainSettings()}
        {view === 'quality' && renderQualitySettings()}
        {view === 'subtitles' && renderSubtitleSettings()}
        {view === 'subtitle-style' && renderSubtitleStyleSettings()}
        {view === 'subtitle-timing' && renderSubtitleTimingSettings()}
        {view === 'audio' && renderAudioSettings()}
        {view === 'server' && renderServerSettings()}
        {view === 'av-sync' && renderAvSyncSettings()}
        {view === 'ambient' && renderAmbientSettings()}
      </SettingsShell>
    </div>
  )
}

export default TvSettings
