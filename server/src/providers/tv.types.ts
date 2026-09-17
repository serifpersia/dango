export interface TvMediaRequest {
  tmdbId: number
  type: 'movie' | 'tv'
  season: number
  episode: number
  title: string
  year: string
  imdbId: string
  totalSeasons: number
}

export interface TvStreamSource {
  url: string
  quality: string
  type: 'hls' | 'mp4'
}

export interface TvAudioTrack {
  language: string
  label: string
}

export interface TvSubtitle {
  language: string
  label: string
  url: string
}

export interface TvSourcesResult {
  sources: TvStreamSource[]
  audioTracks?: TvAudioTrack[]
  subtitles?: TvSubtitle[]
  referer?: string
  server?: string
}

export interface TvProvider {
  name: string
  servers?: string[]
  getSources?: (media: TvMediaRequest, server?: string) => Promise<TvSourcesResult | null>
  getEmbedUrl?: (media: TvMediaRequest) => Promise<string | null>
}
