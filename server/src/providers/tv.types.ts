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
  type: 'hls' | 'mp4' | 'iframe'
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

export interface OpenSubtitleLanguage {
  id: string
  language: string
  label: string
  count: number
}

export interface OpenSubtitleFile {
  id: string
  language: string
  label: string
  url: string
  format?: string
  encoding?: string
  downloads?: number
  rating?: string
  fileName?: string
  hearingImpaired?: boolean
}

export interface TvSourcesResult {
  sources: TvStreamSource[]
  audioTracks?: TvAudioTrack[]
  subtitles?: TvSubtitle[]
  referer?: string
  server?: string
  servers?: string[]
  embedUrl?: string
}

export interface TvProvider {
  name: string
  servers?: string[]
  getSources?: (media: TvMediaRequest, server?: string) => Promise<TvSourcesResult | null>
  getEmbedUrl?: (media: TvMediaRequest) => Promise<string | null>
  getSubtitleLanguages?: (media: TvMediaRequest) => Promise<OpenSubtitleLanguage[] | null>
  getSubtitleFiles?: (media: TvMediaRequest, lang: string) => Promise<OpenSubtitleFile[] | null>
  rewritePlaylist?: (body: string, playlistUrl: string) => string
}
