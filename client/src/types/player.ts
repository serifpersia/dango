import type { Show } from '../../../server/src/providers/provider.interface.js'

export type AnimeShow = Show & {
  watchedCount?: number
  currentTime?: number
  duration?: number
  showId?: string
}

export interface SimpleShowMeta {
  name: string
  thumbnail: string
  description?: string
  names?: {
    romaji: string
    english: string
    native: string
  }
  score?: number
}

export type DetailedShowMeta = Show

export interface VideoLink {
  resolutionStr: string
  link: string
  hls: boolean
  headers?: { Referer?: string }
}

export interface SubtitleTrack {
  src?: string
  url?: string
  lang: string
  label: string
  mode?: 'showing' | 'hidden' | 'disabled'
}

export interface VideoSource {
  sourceName: string
  links: VideoLink[]
  subtitles?: SubtitleTrack[]
  type?: 'player' | 'iframe'
  sandbox?: string
  actualEpisodeNumber?: string
}

export interface SkipInterval {
  start_time: number
  end_time: number
  skip_type: 'op' | 'ed' | 'recap' | 'mixed_op' | 'mixed_ed' | 'mixed_recap'
  skip_id: string
}

export interface PlayerState {
  showMeta: Partial<SimpleShowMeta & DetailedShowMeta>
  episodes: string[]
  currentEpisode?: string | null
  watchedEpisodes: string[]
  watchlistStatus: string | null
  showCombinedDetails: boolean
  currentMode: 'sub' | 'dub'
  inWatchlist: boolean
  videoSources: VideoSource[]
  selectedSource: VideoSource | null
  selectedLink: null | VideoLink
  isAutoplayEnabled: boolean
  showResumeModal: boolean
  resumeTime: number
  resumeDuration: number
  skipIntervals: SkipInterval[]
  selectedProvider: string
  loadingShowData: boolean
  loadingVideo: boolean
  resumeProgressPending: boolean
  error: string | null
  fetchedEpisodeNumber?: string
  showCookieModal?: boolean
  cookieProvider?: 'animepahe' | 'mkissa' | null
  initialEpisode?: string
}
