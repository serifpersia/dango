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

export interface DetailedShowMeta {
  id: string
  route: string
  title: string
  genres: { name: string; route: string }[]
  studios: { name: string; route: string }[]
  sources: { name: string; route: string }[]
  mediaTypes: { name: string; route: string }[]
  episodes: number
  lengthMin: number
  status: string
  imageVersionRoute: string
  stats: {
    averageScore: number
    ratingCount: number
    trackedCount: number
    trackedRating: number
    colorLightMode: string
    colorDarkMode: string
  }
  names: {
    romaji: string
    english: string
    native: string
  }
  nextEpisodeAirDate?: string
  bannerImage?: string | null
  availableEpisodes?: {
    sub?: number
    dub?: number
    raw?: number
  }
  availableEpisodesDetail?: {
    sub?: string[]
    dub?: string[]
    raw?: string[]
  }
  episodeCount?: string | number | null
  episodeDuration?: string | number | null
  averageScore?: number | null
  airedStart?: {
    year?: number
    month?: number
    date?: number
  } | null
  airedEnd?: {
    year?: number
    month?: number
    date?: number
  } | null
  country?: string | null
  rating?: string | null
  season?: {
    quarter?: string
    season?: string
    title?: string
    year?: number
  } | null
}

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
  watchedEpisodes: string[]
  watchlistStatus: string | null
  showCombinedDetails: boolean
  currentMode: 'sub' | 'dub'
  inWatchlist: boolean
  videoSources: VideoSource[]
  selectedSource: VideoSource | null
  selectedLink: null | VideoLink
  forceNativePlayer: boolean
  isAutoplayEnabled: boolean
  showResumeModal: boolean
  resumeTime: number
  resumeDuration: number
  skipIntervals: SkipInterval[]
  selectedProvider:
    | 'animepahe'
    | '123anime'
    | 'animeya'
    | 'megaplay'
    | 'wh'
    | 'hn'
    | 'anilight'
    | 'anidb'
    | 'ht'
    | 'op'
  loadingShowData: boolean
  loadingVideo: boolean
  loadingDetails: boolean
  error: string | null
  detailsError: string | null
  fetchedEpisodeNumber?: string
  showCookieModal?: boolean
  cookieProvider?: 'animepahe' | null
  initialEpisode?: string
}
