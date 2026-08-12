export interface Show {
  _id: string
  id?: string
  session?: string
  anilistId?: number
  name: string
  names?: {
    romaji?: string
    english?: string
    native?: string
    synonyms?: string[]
  }
  nativeName?: string
  englishName?: string
  thumbnail?: string
  thumbnails?: string[]
  bannerImage?: string
  description?: string
  type?: string
  episodeNumber?: number
  availableEpisodesDetail?: {
    sub?: string[]
    dub?: string[]
    raw?: string[]
  }
  availableEpisodes?: {
    sub?: number
    dub?: number
    raw?: number
  }
  episodeCount?: string | number | null
  episodeDuration?: string | number | null
  averageScore?: number | null
  score?: number | null
  year?: number | null
  isAdult?: boolean
  rating?: string
  genres?: { name: string }[]
  tags?: { name: string }[]
  studios?: { name: string }[]
  status?: string
  airedStart?: Record<string, unknown> | null
  airedEnd?: Record<string, unknown> | null
  country?: string | null
  season?: Record<string, unknown> | null
  nextAiring?: {
    episode: number
    timeUntilAiring: number
  }
  nextEpisodeAirDate?: string
  airTime?: string
  aired?: boolean
}

export interface VideoLink {
  resolutionStr: string
  link: string
  hls: boolean
  headers?: Record<string, string>
}

export interface SubtitleTrack {
  language: string
  label: string
  url: string
}

export interface VideoSource {
  sourceName: string
  links: VideoLink[]
  subtitles?: SubtitleTrack[]
  type?: 'player' | 'iframe'
  actualEpisodeNumber?: string
}

export interface EpisodeDetail {
  number: string
  title?: string
}

export interface EpisodeDetails {
  episodes: string[]
  description: string
  availableEpisodesDetail?: EpisodeDetail[]
}

export interface SearchOptions {
  query?: string
}

export interface Provider {
  name: string
  search(options: SearchOptions): Promise<Show[]>
  getEpisodes(
    showId: string,
    mode?: 'sub' | 'dub',
    ua?: string,
    cookie?: string
  ): Promise<EpisodeDetails | null>
  getStreamUrls(
    showId: string,
    episodeNumber: string,
    mode?: 'sub' | 'dub'
  ): Promise<VideoSource[] | null>
  resolveShowId?(title: string, romaji?: string, mode?: 'sub' | 'dub'): Promise<string | null>
}
