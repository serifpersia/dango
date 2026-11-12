import React from 'react'
import styles from './TvPlayerControls.module.css'
import SettingsShell from '../player/SettingsShell'
import SubtitleStyleMenu, { type SubtitleStyleKey } from '../player/SubtitleStyleMenu'
import SubtitleFontMenu from '../player/SubtitleFontMenu'
import SubtitleDelayMenu from '../player/SubtitleDelayMenu'
import AvSyncMenu from '../player/AvSyncMenu'
import AmbientLightMenu from '../player/AmbientLightMenu'
import OptionListMenu from '../player/OptionListMenu'
import { formatSubtitleDelay } from '../../lib/subtitleStyle'
import type { AmbientLightSettings } from '../../hooks/useAmbientLight'
import type useVideoPlayer from '../../hooks/useVideoPlayer'

export type TvSettingsView =
  | 'main'
  | 'resolution'
  | 'subtitles'
  | 'subtitle-style'
  | 'subtitle-font'
  | 'subtitle-timing'
  | 'audio'
  | 'av-sync'
  | 'ambient'
  | 'opensub-langs'
  | 'opensub-files'
  | null

interface TvSettingsProps {
  view: Exclude<TvSettingsView, null>
  onSelectView: (view: TvSettingsView) => void
  onClose: () => void
  player: ReturnType<typeof useVideoPlayer>
  onSubtitleStyleChange: (key: SubtitleStyleKey, value: number | string | boolean) => void
  streams: { quality: string; type: string }[]
  resolutionIdx: number
  onResolutionChange: (idx: number) => void
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
  onOpenSubtitles?: () => void
  openSubLanguages?: { id: string; language?: string; label?: string; count?: number }[]
  openSubFiles?: { id: string; language?: string; label: string; url: string }[]
  openSubLoading?: boolean
  openSubError?: string | null
  onOpenSubLangSelect?: (langId: string) => void
  onOpenSubFileSelect?: (file: { id: string; language: string; label: string; url: string }) => void
}

const TvSettings: React.FC<TvSettingsProps> = ({
  view,
  onSelectView,
  onClose,
  player,
  onSubtitleStyleChange,
  streams,
  resolutionIdx,
  onResolutionChange,
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
  onOpenSubtitles,
  openSubLanguages,
  openSubFiles,
  openSubLoading,
  openSubError,
  onOpenSubLangSelect,
  onOpenSubFileSelect,
}) => {
  const { state } = player

  const renderMainSettings = () => (
    <>
      {streams.length > 1 && (
        <button className={styles.menuItem} onClick={() => onSelectView('resolution')}>
          <span>Resolution</span>
          <span className={styles.currentValue}>{streams[resolutionIdx]?.quality || 'Auto'}</span>
        </button>
      )}
      {(hasSubtitles || onOpenSubtitles) && (
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

  const renderResolutionSettings = () => (
    <OptionListMenu
      classes={{ item: styles.menuItem, active: styles.active }}
      options={streams.map((s, i) => ({
        key: String(i),
        label: s.quality,
        selected: i === resolutionIdx,
      }))}
      onSelect={(key) => onResolutionChange(Number(key))}
    />
  )

  const renderSubtitleSettings = () => (
    <>
      <button
        type="button"
        className={`${styles.menuItem} ${!isSubtitleActive ? styles.active : ''}`}
        onClick={() => onSubtitleChange(-1)}
      >
        <span>Off</span>
      </button>
      {onOpenSubtitles && (
        <button type="button" className={styles.menuItem} onClick={onOpenSubtitles}>
          <span>Open Subtitles...</span>
        </button>
      )}
      {subtitles.map((track, i) => (
        <button
          key={i}
          type="button"
          className={`${styles.menuItem} ${i === selectedSubtitle ? styles.active : ''}`}
          onClick={() => onSubtitleChange(i)}
        >
          <span>{track.label || track.language}</span>
        </button>
      ))}
    </>
  )

  const renderOpenSubLangs = () => (
    <>
      {openSubLoading && <div className={styles.menuNote}>Loading languages...</div>}
      {!openSubLoading && openSubError && <div className={styles.menuNote}>{openSubError}</div>}
      {!openSubLoading && !openSubError && (openSubLanguages?.length ?? 0) === 0 && (
        <div className={styles.menuNote}>No languages found</div>
      )}
      {!openSubLoading && (openSubLanguages?.length ?? 0) > 0 && (
        <OptionListMenu
          classes={{ item: styles.menuItem, active: styles.active }}
          options={(openSubLanguages || []).map((l, i) => ({
            key: String(l.id || l.language || i),
            label: `${l.label || l.language || l.id}${l.count ? ` (${l.count})` : ''}`,
            selected: false,
          }))}
          onSelect={(key) => onOpenSubLangSelect?.(key)}
        />
      )}
    </>
  )

  const renderOpenSubFiles = () => (
    <>
      {openSubLoading && <div className={styles.menuNote}>Loading files...</div>}
      {!openSubLoading && openSubError && <div className={styles.menuNote}>{openSubError}</div>}
      {!openSubLoading && !openSubError && (openSubFiles?.length ?? 0) === 0 && (
        <div className={styles.menuNote}>No files found</div>
      )}
      {!openSubLoading && (openSubFiles?.length ?? 0) > 0 && (
        <OptionListMenu
          classes={{ item: styles.menuItem, active: styles.active }}
          options={(openSubFiles || []).map((f) => ({
            key: f.id,
            label: f.label,
            selected: false,
          }))}
          onSelect={(key) => {
            const f = (openSubFiles || []).find((x) => String(x.id) === key)
            if (f) onOpenSubFileSelect?.({ ...f, language: f.language || 'en' })
          }}
        />
      )}
    </>
  )

  const renderSubtitleStyleSettings = () => (
    <SubtitleStyleMenu
      classes={{ item: styles.menuItem, active: styles.active }}
      values={{
        font: state.subtitleFont,
        fontSize: state.subtitleFontSize,
        position: state.subtitlePosition,
        bgOpacity: state.subtitleBgOpacity,
        bgColor: state.subtitleBgColor,
        textColor: state.subtitleTextColor,
        edge: state.subtitleEdge,
        outlineWidth: state.subtitleOutlineWidth,
        outlineColor: state.subtitleOutlineColor,
        bold: state.subtitleBold,
      }}
      onChange={onSubtitleStyleChange}
      onFontMenu={() => onSelectView('subtitle-font')}
    />
  )

  const renderSubtitleFontSettings = () => (
    <SubtitleFontMenu
      classes={{ item: styles.menuItem, active: styles.active }}
      value={state.subtitleFont}
      onChange={(font) => onSubtitleStyleChange('font', font)}
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
            : view === 'subtitle-font'
              ? 'Subtitle Font'
              : view === 'subtitle-style'
                ? 'Subtitle Style'
                : view === 'subtitle-timing'
                  ? 'Subtitle Timing'
                  : view === 'audio'
                    ? 'Audio Track'
                    : view === 'resolution'
                      ? 'Resolution'
                      : view === 'av-sync'
                        ? 'A/V Sync'
                        : view === 'ambient'
                          ? 'Ambient Light'
                          : view === 'opensub-langs'
                            ? 'Open Subtitles'
                            : view === 'opensub-files'
                              ? 'Select File'
                              : view.charAt(0).toUpperCase() + view.slice(1)
        }
        onBack={() => {
          if (view === 'main') return onClose()
          if (view === 'subtitle-font') return onSelectView('subtitle-style')
          if (view === 'opensub-files') return onSelectView('opensub-langs')
          onSelectView('main')
        }}
      >
        {view === 'main' && renderMainSettings()}
        {view === 'resolution' && renderResolutionSettings()}
        {view === 'subtitles' && renderSubtitleSettings()}
        {view === 'subtitle-style' && renderSubtitleStyleSettings()}
        {view === 'subtitle-font' && renderSubtitleFontSettings()}
        {view === 'subtitle-timing' && renderSubtitleTimingSettings()}
        {view === 'audio' && renderAudioSettings()}
        {view === 'av-sync' && renderAvSyncSettings()}
        {view === 'ambient' && renderAmbientSettings()}
        {view === 'opensub-langs' && renderOpenSubLangs()}
        {view === 'opensub-files' && renderOpenSubFiles()}
      </SettingsShell>
    </div>
  )
}

export default TvSettings
