import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router'
import { FaSearch, FaPlay, FaFilm, FaTv, FaArrowLeft, FaSpinner } from 'react-icons/fa'
import TvCard from '../components/tv/TvCard'
import TvPlayerControls from '../components/tv/TvPlayerControls'
import styles from './Tv.module.css'

type MediaType = 'movie' | 'tv' | 'tvSeries' | 'tvMiniSeries'

interface TvSearchResult {
  id: number
  title: string
  year: string
  type: MediaType
  image: string
  vote_average?: number
}

interface TvDetails {
  id: number
  title: string
  overview: string
  vote_average?: number
  year: string
  poster: string
  backdrop: string
  imdb_id?: string
  seasons?: { season_number: number; episode_count: number }[]
  number_of_seasons?: number
}

interface Episode {
  episode_number: number
  name: string
  vote_average?: number
  overview: string
  still_path: string
}

interface StreamSource {
  url: string
  quality: string
  type: 'hls' | 'mp4'
  width?: number
  height?: number
  bandwidth?: number
  frameRate?: number
}

interface AudioTrack {
  language: string
  label: string
}

interface SubtitleTrack {
  language: string
  label: string
  url: string
}

interface HlsJsInstance {
  audioTracks?: { length: number }
  audioTrack: number
  loadSource: (url: string) => void
  attachMedia: (media: HTMLMediaElement) => void
  on: (event: string, handler: () => void) => void
  destroy: () => void
}

interface HlsJsConstructor {
  new (options?: { enableWorker?: boolean }): HlsJsInstance
  isSupported: () => boolean
  Events: Record<string, string>
}

const WATCHSERIES_PROVIDERS = {
  embedmaster: {
    name: 'EmbedMaster',
    url: (id: number, type: string, s: number, e: number) =>
      type === 'movie'
        ? `https://embedmaster.link/movie/${id}`
        : `https://embedmaster.link/tv/${id}/${s}/${e}`,
  },
  vidfast: {
    name: 'VidFast',
    url: (id: number, type: string, s: number, e: number) =>
      type === 'movie'
        ? `https://vidfast.pro/movie/${id}`
        : `https://vidfast.pro/tv/${id}/${s}/${e}`,
  },
  videasy: {
    name: 'VidEasy',
    url: (id: number, type: string, s: number, e: number) =>
      type === 'movie'
        ? `https://player.videasy.to/movie/${id}?overlay=true`
        : `https://player.videasy.to/tv/${id}/${s}/${e}?episodeSelector=true&overlay=true`,
  },
  vidrock: {
    name: 'VidRock',
    url: (id: number, type: string, s: number, e: number) =>
      type === 'movie' ? `https://vidrock.ru/movie/${id}` : `https://vidrock.ru/tv/${id}/${s}/${e}`,
  },
}

const SUGGESTIONS = [
  'Stranger Things',
  'Breaking Bad',
  'The Boys',
  'Interstellar',
  'Dune',
  'Avengers',
  'House of the Dragon',
  'Wednesday',
]

const Tv: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const typeParam = searchParams.get('type') as MediaType | null

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TvSearchResult[]>([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedItem, setSelectedItem] = useState<TvSearchResult | null>(null)
  const [details, setDetails] = useState<TvDetails | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [season, setSeason] = useState(1)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [episode, setEpisode] = useState(1)
  const [source, setSource] = useState('movybz')
  const [streams, setStreams] = useState<StreamSource[]>([])
  const [streamLoading, setStreamLoading] = useState(false)
  const [streamError, setStreamError] = useState('')
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([])
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<number>(0)
  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([])
  const [selectedSubtitle, setSelectedSubtitle] = useState<number>(-1)
  const [sourceTypeFilter, setSourceTypeFilter] = useState('all')
  const [qualityIdx, setQualityIdx] = useState(0)
  const [referer, setReferer] = useState('')
  const [iframeUrl, setIframeUrl] = useState('')
  const fallbackAttemptedRef = useRef(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<HlsJsInstance | null>(null)
  const discordSessionRef = useRef<string>('')
  if (!discordSessionRef.current) {
    discordSessionRef.current = `tv-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  const isMovie =
    details?.seasons === undefined && details?.number_of_seasons === undefined
      ? selectedItem?.type === 'movie'
      : false

  const isEmbedProvider = ['embedmaster', 'vidfast', 'videasy', 'vidrock'].includes(source)

  useEffect(() => {
    if (!id) {
      setSelectedItem(null)
      setDetails(null)
      setStreams([])
      setStreamError('')
      setIframeUrl('')
      return
    }

    const itemId = Number(id)
    const type = typeParam || 'tv'
    setSelectedItem({ id: itemId, title: '', year: '', type: type as MediaType, image: '' })
    setDetailsLoading(true)
    setDetails(null)
    setStreams([])
    setStreamError('')
    setIframeUrl('')
    setSeason(1)
    setEpisode(1)
    setSource('movybz')
    setQualityIdx(0)

    fetch(`/api/tv/details/${type}/${itemId}`)
      .then((r) => r.json())
      .then((d: TvDetails) => {
        setDetails(d)
        setDetailsLoading(false)
        if (d.seasons && d.seasons.length > 0) {
          setSeason(d.seasons[0].season_number)
        }
        document.title = `${d.title} - dango`
      })
      .catch(() => {
        setDetailsLoading(false)
        setStatus('Failed to load details.')
      })
  }, [id, typeParam])

  useEffect(() => {
    if (!details || !id) return
    const isTV = details.seasons !== undefined || details.number_of_seasons !== undefined
    if (!isTV) {
      setEpisodes([])
      return
    }
    fetch(`/api/tv/episodes/${id}/${season}`)
      .then((r) => r.json())
      .then((d: { episodes: Episode[] }) => {
        setEpisodes(d.episodes || [])
        if (d.episodes?.length > 0) {
          setEpisode(d.episodes[0].episode_number)
        }
      })
      .catch(() => {
        setStatus('Failed to load episodes.')
      })
  }, [details, id, season])

  useEffect(() => {
    if (!details || !id || isMovie) return
    fetch(`/api/tv/episodes/${id}/${season}`)
      .then((r) => r.json())
      .then((d: { episodes: Episode[] }) => {
        const eps = d.episodes || []
        setEpisodes(eps)
        if (eps.length > 0 && !eps.find((ep) => ep.episode_number === episode)) {
          setEpisode(eps[0].episode_number)
        }
      })
      .catch(() => {})
  }, [season, details, id, isMovie, episode])

  useEffect(() => {
    if (!isEmbedProvider || !details || !id) return
    const provider = WATCHSERIES_PROVIDERS[source as keyof typeof WATCHSERIES_PROVIDERS]
    if (!provider) return

    const type = isMovie ? 'movie' : 'tv'
    const url = provider.url(details.id, type, season, episode)
    setIframeUrl(url)

    fetch(`/api/resolve?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.finalUrl) setIframeUrl(data.finalUrl)
      })
      .catch(() => {})
  }, [source, details, id, season, episode, isMovie, isEmbedProvider])

  const loadStreams = useCallback(async () => {
    if (!details || !id || isEmbedProvider) return
    setStreamLoading(true)
    setStreamError('')
    setStreams([])
    setQualityIdx(0)
    setAudioTracks([])
    setSubtitles([])

    try {
      if (source === 'movybz') {
        const type = isMovie ? 'movie' : 'tv'
        const params = new URLSearchParams({
          title: details.title || '',
          year: details.year || '',
          season: String(season),
          episode: String(episode),
          totalSeasons: String(details.number_of_seasons || 1),
          imdbId: details.imdb_id || '',
        })
        const res = await fetch(`/api/tv/movybz/${type}/${id}?${params.toString()}`)
        const data = await res.json()
        setStreamLoading(false)
        if (!data.sources || !data.sources.length) {
          const err = data.error || 'No streams available.'
          setStreamError(err)
          if (!fallbackAttemptedRef.current) {
            fallbackAttemptedRef.current = true
            setSource('vixsrc')
          }
          return
        }
        setStreams(data.sources)
        setSourceTypeFilter('all')
      } else if (source === 'vixsrc') {
        const type = isMovie ? 'movie' : 'tv'
        let url = `/api/tv/vixsrc/${type}/${id}`
        if (!isMovie) url += `?season=${season}&episode=${episode}`
        const res = await fetch(url)
        const data = await res.json()
        setStreamLoading(false)
        if (!data.sources || !data.sources.length) {
          setStreamError('No VixSrc streams available.')
          if (!fallbackAttemptedRef.current) {
            fallbackAttemptedRef.current = true
            setSource('embedmaster')
          }
          return
        }
        setStreams(data.sources)
        setReferer(data.referer || 'https://vixsrc.to/')
        const tracks = data.audioTracks || []
        setAudioTracks(tracks)
        if (tracks.length > 0) {
          const englishIdx = tracks.findIndex(
            (t: AudioTrack) => t.language === 'en' || t.label.toLowerCase().includes('english')
          )
          setSelectedAudioTrack(englishIdx >= 0 ? englishIdx : 0)
        }
        const subs = data.subtitles || []
        setSubtitles(subs)
        if (subs.length > 0) {
          const englishIdx = subs.findIndex(
            (s: SubtitleTrack) => s.language === 'en' || s.label.toLowerCase().includes('english')
          )
          setSelectedSubtitle(englishIdx >= 0 ? englishIdx : 0)
        }
      }
    } catch {
      setStreamLoading(false)
      setStreamError('Failed to load streams.')
    }
  }, [details, id, source, season, episode, isMovie, isEmbedProvider])

  useEffect(() => {
    if (source && details && !isEmbedProvider) {
      loadStreams()
    }
  }, [source, details, loadStreams, isEmbedProvider])

  useEffect(() => {
    if (!videoRef.current) return
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    if (isEmbedProvider) return

    const filtered =
      sourceTypeFilter === 'all' ? streams : streams.filter((s) => s.type === sourceTypeFilter)
    const currentUrl = filtered[qualityIdx]?.url || ''
    if (!currentUrl) return

    const video = videoRef.current
    video.pause()
    video.removeAttribute('src')
    video.load()

    const proxiedUrl = `/api/tv/stream-proxy?url=${encodeURIComponent(currentUrl)}&referer=${encodeURIComponent(source === 'movybz' ? 'https://www.movy.bz/' : referer)}`

    if (filtered[qualityIdx]?.type === 'hls') {
      const Hls = (window as unknown as { Hls?: HlsJsConstructor }).Hls
      if (Hls && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true })
        hlsRef.current = hls
        hls.loadSource(proxiedUrl)
        hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {})
        })
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = proxiedUrl
        video.play().catch(() => {})
      }
    } else {
      video.src = proxiedUrl
      video.play().catch(() => {})
    }
  }, [streams, qualityIdx, sourceTypeFilter, source, referer, isEmbedProvider])

  const doSearch = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setStatus(`Searching for "${q}"...`)
    setResults([])
    try {
      const res = await fetch(`/api/tv/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setLoading(false)
      setStatus(data.length ? '' : 'No results found.')
      setResults(data)
    } catch {
      setLoading(false)
      setStatus('Search failed.')
    }
  }

  const handleSuggestion = (tag: string) => {
    setQuery(tag)
    doSearch()
  }

  const handleSelectItem = (item: TvSearchResult) => {
    const isTV = item.type === 'tv' || item.type === 'tvSeries' || item.type === 'tvMiniSeries'
    navigate(`/tv/${item.id}?type=${isTV ? 'tv' : 'movie'}`)
  }

  const handleBack = () => {
    setSelectedItem(null)
    setDetails(null)
    setStreams([])
    setIframeUrl('')
    navigate('/tv')
  }

  const handleAudioTrackChange = (index: number) => {
    setSelectedAudioTrack(index)
    const hls = hlsRef.current
    if (hls && hls.audioTrack !== undefined) {
      hls.audioTrack = index
    }
  }

  const handleSubtitleChange = (index: number) => {
    setSelectedSubtitle(index)
    const video = videoRef.current
    const hls = hlsRef.current
    if (hls && hls.subtitleTrack !== undefined) {
      hls.subtitleTrack = index
      return
    }
    if (!video) return
    Array.from(video.textTracks).forEach((track, i) => {
      track.mode = i === index ? 'showing' : 'hidden'
    })
  }

  const sendTvPresence = useCallback(() => {
    if (!details) return
    const video = videoRef.current
    const episodeLabel = isMovie
      ? ''
      : `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
    fetch('/api/discord/tv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: details.title,
        episodeLabel,
        isPlaying: video ? !video.paused && !video.ended : true,
        thumbnail: details.poster,
        currentTime: video ? video.currentTime : 0,
        duration: video ? video.duration || 0 : 0,
        sessionId: discordSessionRef.current,
      }),
    }).catch(() => {})
    fetch('/api/discord/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: discordSessionRef.current }),
    }).catch(() => {})
  }, [details, isMovie, season, episode])

  useEffect(() => {
    if (!details) return
    sendTvPresence()
    const id = window.setInterval(() => {
      const video = videoRef.current
      if (!video || !video.paused) sendTvPresence()
    }, 15000)
    return () => window.clearInterval(id)
  }, [sendTvPresence, details])

  useEffect(() => {
    if (!details || isEmbedProvider || streamLoading || streamError || streams.length === 0) return
    const video = videoRef.current
    if (!video) return
    const send = () => sendTvPresence()
    video.addEventListener('play', send)
    video.addEventListener('pause', send)
    video.addEventListener('seeked', send)
    return () => {
      video.removeEventListener('play', send)
      video.removeEventListener('pause', send)
      video.removeEventListener('seeked', send)
    }
  }, [details, isEmbedProvider, streamLoading, streamError, streams, sendTvPresence])

  useEffect(() => {
    const sid = discordSessionRef.current
    const clearTvPresence = () => {
      const payload = JSON.stringify({ sessionId: sid })
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          '/api/discord/clear',
          new Blob([payload], { type: 'application/json' })
        )
        navigator.sendBeacon(
          '/api/discord/heartbeat',
          new Blob([JSON.stringify({ sessionId: sid, bye: true })], { type: 'application/json' })
        )
      } else {
        fetch('/api/discord/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {})
      }
    }
    const handlePageHide = () => clearTvPresence()
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('beforeunload', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('beforeunload', handlePageHide)
      clearTvPresence()
    }
  }, [])

  const filteredStreams =
    sourceTypeFilter === 'all' ? streams : streams.filter((s) => s.type === sourceTypeFilter)

  return (
    <div className={styles.page}>
      {details && (
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={handleBack}>
            <FaArrowLeft /> Back
          </button>
          <h1>{details.title}</h1>
          <div className={styles.meta}>
            <span className={styles.year}>{details.year}</span>
            {details.vote_average != null && (
              <span className={styles.rating}>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  style={{ marginRight: 4 }}
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                {Number(details.vote_average).toFixed(1)}
              </span>
            )}
            <span className={`${styles.typeBadge} ${styles[isMovie ? 'movie' : 'tv']}`}>
              {isMovie ? 'Movie' : 'TV Show'}
            </span>
          </div>
          {details.overview && <p className={styles.overview}>{details.overview}</p>}
        </div>
      )}

      {details && !isMovie && (
        <div className={styles.controls}>
          <label className={styles.controlLabel}>
            Season
            <select
              value={season}
              onChange={(e) => setSeason(parseInt(e.target.value, 10) || 1)}
              className={styles.select}
            >
              {details.seasons?.map((s) => (
                <option key={s.season_number} value={s.season_number}>
                  Season {s.season_number} ({s.episode_count} ep)
                </option>
              ))}
            </select>
          </label>
          <label className={styles.controlLabel}>
            Episode
            <select
              value={episode}
              onChange={(e) => setEpisode(parseInt(e.target.value, 10) || 1)}
              className={styles.select}
            >
              {episodes.map((ep) => (
                <option key={ep.episode_number} value={ep.episode_number}>
                  Ep {ep.episode_number} - {ep.name || ''}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.controlLabel}>
            Source
            <select
              value={source}
              onChange={(e) => {
                fallbackAttemptedRef.current = false
                setSource(e.target.value)
              }}
              className={styles.select}
            >
              <optgroup label="Direct HLS">
                <option value="movybz">Movy.bz (4K HLS)</option>
                <option value="vixsrc">VixSrc (HLS)</option>
              </optgroup>
              <optgroup label="WatchSeries Embeds">
                <option value="embedmaster">EmbedMaster</option>
                <option value="vidfast">VidFast</option>
                <option value="videasy">VidEasy</option>
              </optgroup>
              <optgroup label="Other Embeds">
                <option value="vidrock">VidRock</option>
              </optgroup>
            </select>
          </label>
        </div>
      )}

      {details && isMovie && (
        <div className={styles.controls}>
          <label className={styles.controlLabel}>
            Source
            <select
              value={source}
              onChange={(e) => {
                fallbackAttemptedRef.current = false
                setSource(e.target.value)
              }}
              className={styles.select}
            >
              <optgroup label="Direct HLS">
                <option value="movybz">Movy.bz (4K HLS)</option>
                <option value="vixsrc">VixSrc (HLS)</option>
              </optgroup>
              <optgroup label="WatchSeries Embeds">
                <option value="embedmaster">EmbedMaster</option>
                <option value="vidfast">VidFast</option>
                <option value="videasy">VidEasy</option>
              </optgroup>
              <optgroup label="Other Embeds">
                <option value="vidrock">VidRock</option>
              </optgroup>
            </select>
          </label>
        </div>
      )}

      {details && (
        <div className={styles.playerSection}>
          {streamLoading && !isEmbedProvider && (
            <div className={styles.statusMsg}>
              <FaSpinner className={styles.spinner} /> Loading stream...
            </div>
          )}
          {streamError && !isEmbedProvider && (
            <div className={`${styles.statusMsg} ${styles.error}`}>
              {streamError}
              <button
                className={styles.retryButton}
                onClick={loadStreams}
                style={{ marginLeft: 8 }}
              >
                Retry
              </button>
            </div>
          )}
          {isEmbedProvider && iframeUrl ? (
            <iframe
              src={iframeUrl}
              className={styles.videoIframe}
              allow="autoplay; fullscreen"
              allowFullScreen
            />
          ) : !isEmbedProvider && !streamLoading && !streamError && filteredStreams.length > 0 ? (
            <TvPlayerControls
              videoRef={videoRef}
              title={details.title}
              audioTracks={audioTracks}
              selectedAudioTrack={selectedAudioTrack}
              onAudioTrackChange={handleAudioTrackChange}
              subtitles={subtitles}
              selectedSubtitle={selectedSubtitle}
              onSubtitleChange={handleSubtitleChange}
              streams={filteredStreams}
              qualityIdx={qualityIdx}
              onQualityChange={setQualityIdx}
              onBack={handleBack}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                disablePictureInPicture
                className={styles.video}
              />
            </TvPlayerControls>
          ) : null}
        </div>
      )}

      {!details && (
        <>
          <header className={styles.header}>
            <h1 className={styles.pageTitle}>
              <FaTv /> TV & Movies
            </h1>
            <form className={styles.searchForm} onSubmit={(e) => doSearch(e)}>
              <input
                className={styles.searchInput}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search movies or shows..."
                aria-label="Search TV and Movies"
              />
              <button className={styles.searchBtn} type="submit" aria-label="Search">
                <FaSearch />
              </button>
            </form>
          </header>

          <div className={styles.suggestions}>
            {SUGGESTIONS.map((tag) => (
              <button
                key={tag}
                className={styles.suggestionPill}
                onClick={() => handleSuggestion(tag)}
              >
                {tag}
              </button>
            ))}
          </div>

          {status && (
            <div className={`${styles.statusMsg} ${loading ? '' : styles.textOnly}`}>{status}</div>
          )}

          {loading && results.length === 0 && (
            <div className={styles.grid} aria-hidden>
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className={styles.skeletonCard}>
                  <div className={`${styles.skeletonThumb} ${styles.shimmer}`} />
                  <div
                    className={`${styles.skeletonLine} ${styles.shimmer}`}
                    style={{ width: '88%' }}
                  />
                  <div
                    className={`${styles.skeletonLine} ${styles.shimmer}`}
                    style={{ width: '55%' }}
                  />
                </div>
              ))}
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className={styles.grid}>
              {results.map((item) => (
                <TvCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default Tv
