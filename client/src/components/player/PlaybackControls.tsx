import type { ComponentProps, ReactNode } from 'react'
import Icon from '../common/Icon'
import SeekBar from './SeekBar'
import type { SeekBarClasses } from './SeekBar'
import UnifiedVolumeControl from './UnifiedVolumeControl'
import { usePlayer } from './PlayerContext'
import { usePlayerState, usePlayerTimeline } from '../../lib/player/usePlayerCore'
import { formatTime } from '../../lib/utils'

type ButtonProps = Omit<ComponentProps<'button'>, 'onClick'>

export function PlayPauseButton({ children, ...props }: ButtonProps) {
  const player = usePlayer()
  const { isPlaying } = usePlayerState(player)
  return (
    <button
      type="button"
      aria-label={isPlaying ? 'Pause' : 'Play'}
      {...props}
      onClick={player.togglePlay}
    >
      {children ?? <Icon name={isPlaying ? 'pause' : 'play'} />}
    </button>
  )
}

export function SeekButton({ seconds, children, ...props }: ButtonProps & { seconds: number }) {
  const player = usePlayer()
  return (
    <button
      type="button"
      aria-label={`Seek ${seconds < 0 ? 'back' : 'forward'} ${Math.abs(seconds)} seconds`}
      {...props}
      onClick={() => player.seekRelative(seconds)}
    >
      {children ?? <Icon name={seconds < 0 ? 'replay-10' : 'forward-10'} />}
    </button>
  )
}

export function FullscreenButton(props: ButtonProps) {
  const player = usePlayer()
  const { isFullscreen } = usePlayerState(player)
  return (
    <button
      type="button"
      aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
      {...props}
      onClick={player.toggleFullscreen}
    >
      <Icon name={isFullscreen ? 'compress' : 'expand'} />
    </button>
  )
}

export function PlayerVolume({
  buttonClassName,
  onExpandedChange,
}: {
  buttonClassName: string
  onExpandedChange?: (expanded: boolean) => void
}) {
  const player = usePlayer()
  const { isMuted, volume } = usePlayerState(player)
  return (
    <UnifiedVolumeControl
      muted={isMuted}
      volume={volume}
      volumeIcon={
        <Icon
          name={
            isMuted || volume === 0 ? 'volume-mute' : volume < 0.5 ? 'volume-down' : 'volume-up'
          }
        />
      }
      buttonClassName={buttonClassName}
      onToggleMute={player.toggleMute}
      onVolumeChange={player.setVolume}
      onExpandedChange={onExpandedChange}
    />
  )
}

export function VolumeSlider({ className }: { className?: string }) {
  const player = usePlayer()
  const { volume, isMuted } = usePlayerState(player)
  return (
    <input
      type="range"
      min={0}
      max={1}
      step={0.01}
      value={isMuted ? 0 : volume}
      onChange={(event) => player.setVolume(Number(event.currentTarget.value))}
      className={className}
      style={{ '--volume-percent': `${(isMuted ? 0 : volume) * 100}%` }}
      aria-label="Volume"
    />
  )
}

export function PlayerTimeline({
  classes,
  timeLabelRef,
  children,
}: {
  classes: SeekBarClasses
  timeLabelRef?: { current: HTMLSpanElement | null }
  children?: ReactNode
}) {
  const player = usePlayer()
  const { duration, isScrubbing } = usePlayerState(player)
  return (
    <SeekBar
      classes={classes}
      videoRef={player.mediaRef}
      duration={duration}
      formatTime={formatTime}
      isScrubbing={isScrubbing}
      onSeek={(percent) => player.seek(percent * duration)}
      onScrubStart={player.startScrubbing}
      onScrubMove={(percent) => player.seek(percent * duration)}
      onScrubEnd={player.endScrubbing}
      timeLabelRef={timeLabelRef}
    >
      {children}
    </SeekBar>
  )
}

export function SeekSlider({ className }: { className?: string }) {
  const player = usePlayer()
  const { currentTime, bufferedEnd } = usePlayerTimeline(player)
  const { duration } = usePlayerState(player)
  const played = duration ? Math.min(100, (currentTime / duration) * 100) : 0
  const buffered = duration ? Math.min(100, Math.max(played, (bufferedEnd / duration) * 100)) : 0
  return (
    <input
      type="range"
      min={0}
      max={duration}
      step={0.1}
      value={Math.min(currentTime, duration)}
      onChange={(event) => player.seek(Number(event.currentTarget.value))}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        player.startScrubbing()
      }}
      onPointerUp={player.endScrubbing}
      onPointerCancel={player.endScrubbing}
      onLostPointerCapture={player.endScrubbing}
      className={className}
      style={{ '--played-percent': `${played}%`, '--buffered-percent': `${buffered}%` }}
      aria-label="Seek"
    />
  )
}

export function PlayerTime({
  className,
  durationOnly = false,
}: {
  className?: string
  durationOnly?: boolean
}) {
  const player = usePlayer()
  const { currentTime } = usePlayerTimeline(player)
  const { duration } = usePlayerState(player)
  return <span className={className}>{formatTime(durationOnly ? duration : currentTime)}</span>
}

export function PlayerStatus() {
  const player = usePlayer()
  const { error, playBlocked, isBuffering } = usePlayerState(player)
  if (error) return <div role="alert">{error}</div>
  if (playBlocked) return <PlayPauseButton>Tap to play</PlayPauseButton>
  if (isBuffering)
    return (
      <div role="status" aria-label="Buffering">
        Loading…
      </div>
    )
  return null
}

export function TrackSelector({
  kind,
  className,
}: {
  kind: 'audio' | 'subtitles' | 'quality'
  className?: string
}) {
  const player = usePlayer()
  const state = usePlayerState(player)
  const tracks =
    kind === 'audio'
      ? state.audioTracks
      : kind === 'subtitles'
        ? state.subtitleTracks
        : state.qualities
  const selected =
    kind === 'audio'
      ? state.activeAudioTrack
      : kind === 'subtitles'
        ? state.activeSubtitleTrack
        : state.activeQuality
  const change =
    kind === 'audio'
      ? player.setAudioTrack
      : kind === 'subtitles'
        ? player.setSubtitleTrack
        : player.setQuality
  return (
    <select
      className={className}
      aria-label={kind === 'audio' ? 'Audio track' : kind === 'subtitles' ? 'Subtitles' : 'Quality'}
      value={selected}
      disabled={!tracks.length}
      onChange={(event) => change(Number(event.currentTarget.value))}
    >
      {kind !== 'audio' && <option value={-1}>{kind === 'quality' ? 'Auto' : 'Off'}</option>}
      {tracks.map((track) => (
        <option key={track.id} value={track.id}>
          {track.label}
        </option>
      ))}
    </select>
  )
}
