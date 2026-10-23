import type Hls from 'hls.js'
import type { HlsConfig } from 'hls.js'

export interface PlayerTrack {
  id: number
  label: string
  language?: string
}

export interface PlayerState {
  isPlaying: boolean
  isBuffering: boolean
  isMuted: boolean
  volume: number
  duration: number
  playbackRate: number
  isScrubbing: boolean
  isFullscreen: boolean
  showControls: boolean
  isSpeedBoostActive: boolean
  audioTracks: PlayerTrack[]
  subtitleTracks: PlayerTrack[]
  qualities: PlayerTrack[]
  activeAudioTrack: number
  activeSubtitleTrack: number
  activeQuality: number
  error: string | null
  playBlocked: boolean
}

export interface PlayerTimeline {
  currentTime: number
  bufferedEnd: number
}

export interface PlayerSource {
  url: string
  hls?: boolean
}

export interface PlayerSourceOptions {
  autoPlay?: boolean
  initialTime?: number
  hlsConfig?: Partial<HlsConfig>
  onHls?: (hls: Hls, constructor: typeof Hls) => void
  onReady?: () => void
  onError?: (error: Error) => void
}

export interface PlayerPreferences {
  volumeKey?: string
  mutedKey?: string
}
