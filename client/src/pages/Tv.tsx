import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router'
import Icon from '../components/common/Icon'
import TvCard from '../components/tv/TvCard'
import TvPlayerControls from '../components/tv/TvPlayerControls'
import { Modal } from '../components/common/Modal'
import { Button } from '../components/common/Button'
import { useMatureConsent } from '../hooks/useMatureConsent'
import { useProviders } from '../hooks/useProviders'
import { loadHls, canPlayHlsNatively } from '../lib/hls'
import { bindHlsAudioTracks } from '../lib/hlsAudio'
import { pickSubtitleIndex, subtitleKey } from '../lib/subtitles'
import useDelayCanvas from '../hooks/useDelayCanvas'
import AvSyncCalibrator from '../components/player/AvSyncCalibrator'
import type Hls from 'hls.js'
import styles from './Tv.module.css'

type MediaType = 'movie' | 'tv' | 'tvSeries' | 'tvMiniSeries'

interface TvSearchResult {
  id: number
  title: string
  year: string
  type: MediaType
  image: string
  vote_average?: number
  adult?: boolean
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
  adult?: boolean
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

interface TvProviderOption {
  id: string
  label: string
  tier: 'direct' | 'embed'
  servers?: string[]
}

const NO_TV_PROVIDERS: TvProviderOption[] = []

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
  const [_detailsLoading, setDetailsLoading] = useState(false)
  const [season, setSeason] = useState(() => parseInt(searchParams.get('s') || '1', 10) || 1)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [episode, setEpisode] = useState(() => parseInt(searchParams.get('e') || '1', 10) || 1)
  const [source, setSource] = useState(() => {
    try {
      return localStorage.getItem('tvProvider') || ''
    } catch {
      return ''
    }
  })
  const [streams, setStreams] = useState<StreamSource[]>([])
  const {
    options: providerOptions,
    isFallback: providersFallback,
    isLoading: providersLoading,
  } = useProviders()
  const serverTvProviders: TvProviderOption[] = useMemo(
    () =>
      providerOptions
        .filter((o) => (o.kind ?? 'tv') === 'tv')
        .map((o) => ({
          id: o.value,
          label: o.label,
          tier: o.tier === 'embed' ? 'embed' : 'direct',
          servers: o.servers,
        })),
    [providerOptions]
  )
  const tvProviders =
    providersFallback || serverTvProviders.length === 0 ? NO_TV_PROVIDERS : serverTvProviders
  const directProviders = tvProviders.filter((p) => p.tier === 'direct')
  const embedProviders = tvProviders.filter((p) => p.tier === 'embed')
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
  const [selectedMovyServer, setSelectedMovyServer] = useState<string>(() => {
    try {
      return localStorage.getItem('movyServer') || ''
    } catch {
      return ''
    }
  })
  const streamsRef = useRef<StreamSource[]>([])
  useEffect(() => {
    streamsRef.current = streams
  }, [streams])
  const selectedAudioTrackRef = useRef(selectedAudioTrack)
  useEffect(() => {
    selectedAudioTrackRef.current = selectedAudioTrack
  }, [selectedAudioTrack])
  const selectedSubtitleRef = useRef(selectedSubtitle)
  useEffect(() => {
    selectedSubtitleRef.current = selectedSubtitle
  }, [selectedSubtitle])
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const manualTrackElsRef = useRef<HTMLTrackElement[]>([])
  const delayCanvasRef = useRef<HTMLCanvasElement>(null)
  const subtitleOverlayRef = useRef<HTMLDivElement>(null)
  const [videoDelayMs, setVideoDelayMs] = useState<number>(() => {
    try {
      const stored = Number(localStorage.getItem('playerVideoDelayMs'))
      if (Number.isFinite(stored) && stored >= 0 && stored <= 500) return Math.round(stored)
    } catch {
      // ignore
    }
    return 180
  })
  const [videoDelayEnabled, setVideoDelayEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('playerVideoDelayEnabled') === 'true'
    } catch {
      return false
    }
  })
  const [isCalibrating, setIsCalibrating] = useState(false)
  const wasPlayingBeforeCalibRef = useRef(false)
  const effectiveVideoDelayMs = videoDelayEnabled ? videoDelayMs : 0
  useDelayCanvas({
    videoRef,
    canvasRef: delayCanvasRef,
    delayMs: effectiveVideoDelayMs,
    enabled: videoDelayEnabled,
  })
  const delayCanvasActive = videoDelayEnabled
  const resumeAfterCalib = () => {
    if (wasPlayingBeforeCalibRef.current) {
      wasPlayingBeforeCalibRef.current = false
      videoRef.current?.play().catch(() => {})
    }
  }
  const { hasConsent: hasMatureConsent, grant: grantMatureConsent } = useMatureConsent()
  const discordSessionRef = useRef<string>('')
  if (!discordSessionRef.current) {
    discordSessionRef.current = `tv-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  const isMovie =
    details?.seasons === undefined && details?.number_of_seasons === undefined
      ? selectedItem?.type === 'movie'
      : false

  const pickDefaultSubtitle = useCallback((subs: SubtitleTrack[]): number => {
    let lastKey: string | null = null
    let enabled = true
    try {
      lastKey = localStorage.getItem('tvLastSubtitle')
      enabled = localStorage.getItem('tvSubtitlesEnabled') !== 'false'
    } catch {
      // ignore
    }
    return pickSubtitleIndex(subs, { lastKey, enabled })
  }, [])

  const persistSubtitlePick = useCallback((pick: number) => {
    if (pick < 0) return
    try {
      localStorage.setItem('tvSubtitlesEnabled', 'true')
      localStorage.setItem('tvSelectedSubtitle', String(pick))
    } catch {
      // ignore
    }
  }, [])

  const pickDefaultAudio = useCallback((tracks: AudioTrack[]): number => {
    if (tracks.length === 0) return 0
    let lastKey: string | null = null
    try {
      lastKey = localStorage.getItem('tvLastAudio')
    } catch {
      // ignore
    }
    if (lastKey) {
      const exact = tracks.findIndex((t) => subtitleKey(t) === lastKey)
      if (exact >= 0) return exact
      const sep = lastKey.indexOf('|||')
      const lastLang = sep >= 0 ? lastKey.slice(0, sep) : lastKey
      const lastLabel = sep >= 0 ? lastKey.slice(sep + 3) : lastKey
      const fuzzy = tracks.findIndex((t) => t.language === lastLang || t.label === lastLabel)
      if (fuzzy >= 0) return fuzzy
    }
    return pickSubtitleIndex(tracks, { lastKey: null, enabled: true })
  }, [])

  const activeProvider = useMemo(
    () => tvProviders.find((p) => p.id === source),
    [tvProviders, source]
  )
  const isEmbedProvider = activeProvider?.tier === 'embed'
  const activeServers = useMemo(() => activeProvider?.servers ?? [], [activeProvider])

  useEffect(() => {
    if (tvProviders.length === 0) return
    if (!tvProviders.some((p) => p.id === source)) {
      const next = tvProviders.find((p) => p.tier === 'direct')?.id ?? tvProviders[0].id
      setSource(next)
      try {
        localStorage.setItem('tvProvider', next)
      } catch {
        // ignore
      }
    }
  }, [tvProviders, source])

  useEffect(() => {
    if (activeServers.length === 0) return
    if (!activeServers.includes(selectedMovyServer)) {
      setSelectedMovyServer(activeServers[0])
      try {
        localStorage.setItem('movyServer', activeServers[0])
      } catch {
        // ignore
      }
    }
  }, [activeServers, selectedMovyServer])

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
    const sParam = parseInt(searchParams.get('s') || '', 10)
    const eParam = parseInt(searchParams.get('e') || '', 10)
    setSeason(isNaN(sParam) ? 1 : sParam)
    setEpisode(isNaN(eParam) ? 1 : eParam)
    setQualityIdx(0)

    fetch(`/api/tv/details/${type}/${itemId}`)
      .then((r) => r.json())
      .then((d: TvDetails) => {
        setDetails(d)
        setDetailsLoading(false)
        if (d.seasons && d.seasons.length > 0 && isNaN(sParam)) {
          setSeason(d.seasons[0].season_number)
        }
      })
      .catch(() => {
        setDetailsLoading(false)
        setStatus('Failed to load details.')
      })
  }, [id, typeParam, searchParams])

  useEffect(() => {
    if (!details || !id) return
    const isTV = details.seasons !== undefined || details.number_of_seasons !== undefined
    if (!isTV) {
      setEpisodes([])
      return
    }
    const eParam = parseInt(searchParams.get('e') || '', 10)
    fetch(`/api/tv/episodes/${id}/${season}`)
      .then((r) => r.json())
      .then((d: { episodes: Episode[] }) => {
        setEpisodes(d.episodes || [])
        if (d.episodes?.length > 0) {
          const wanted =
            !isNaN(eParam) && d.episodes.find((ep) => ep.episode_number === eParam)
              ? eParam
              : d.episodes[0].episode_number
          setEpisode(wanted)
        }
      })
      .catch(() => {
        setStatus('Failed to load episodes.')
      })
  }, [details, id, season, searchParams])

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
    const type = isMovie ? 'movie' : 'tv'
    fetch(`/api/tv/embed/${source}/${type}/${id}?season=${season}&episode=${episode}`)
      .then((r) => r.json())
      .then((data: { url?: string }) => {
        if (!data.url) return
        setIframeUrl(data.url)
        return fetch(`/api/resolve?url=${encodeURIComponent(data.url)}`)
          .then((r) => r.json())
          .then((resolved) => {
            if (resolved.finalUrl) setIframeUrl(resolved.finalUrl)
          })
      })
      .catch(() => {})
  }, [source, details, id, season, episode, isMovie, isEmbedProvider])

  const loadStreams = useCallback(async () => {
    if (!details || !id || !source || isEmbedProvider) return
    if (details.adult && !hasMatureConsent) return
    const hasExisting = streamsRef.current.length > 0
    if (hasExisting) {
      setStreamError('')
    } else {
      setStreamLoading(true)
      setStreamError('')
      setStreams([])
      setQualityIdx(0)
      setAudioTracks([])
      setSubtitles([])
    }

    try {
      const type = isMovie ? 'movie' : 'tv'
      const params = new URLSearchParams({
        title: details.title || '',
        year: details.year || '',
        season: String(season),
        episode: String(episode),
        totalSeasons: String(details.number_of_seasons || 1),
        imdbId: details.imdb_id || '',
      })
      if (activeServers.length > 0 && selectedMovyServer) {
        params.set('server', selectedMovyServer)
      }
      const res = await fetch(`/api/tv/sources/${source}/${type}/${id}?${params.toString()}`)
      const data = await res.json()
      setStreamLoading(false)
      if (!data.valid || !data.sources?.length) {
        setStreamError(
          data.error
            ? `${data.error}`
            : activeServers.length > 0
              ? `No streams from ${selectedMovyServer}. Try another server.`
              : 'No streams available.'
        )
        return
      }
      setStreams(data.sources)
      setSourceTypeFilter('all')
      setQualityIdx(0)
      if (data.referer) setReferer(data.referer)
      const tracks = data.audioTracks || []
      setAudioTracks(tracks)
      setSelectedAudioTrack(tracks.length > 0 ? pickDefaultAudio(tracks) : 0)
      const subs = data.subtitles || []
      setSubtitles(subs)
      if (subs.length > 0) {
        const pick = pickDefaultSubtitle(subs)
        setSelectedSubtitle(pick)
        persistSubtitlePick(pick)
      } else {
        setSelectedSubtitle(-1)
      }
      const subId = id
      fetch(`/api/tv/subtitles/${type}/${subId}?season=${season}&episode=${episode}`)
        .then((r) => r.json())
        .then((sd: { subtitles?: SubtitleTrack[] }) => {
          const osSubs = Array.isArray(sd.subtitles) ? sd.subtitles : []
          if (osSubs.length === 0) return
          setSubtitles((prev) => {
            const merged = [...prev, ...osSubs.filter((s) => !prev.some((p) => p.url === s.url))]
            if (prev.length === 0) {
              const pick = pickDefaultSubtitle(merged)
              setSelectedSubtitle(pick)
              persistSubtitlePick(pick)
            }
            return merged
          })
        })
        .catch(() => {})
      setStreamError('')
    } catch {
      setStreamLoading(false)
      setStreamError('Failed to load streams.')
    }
  }, [
    details,
    id,
    source,
    season,
    episode,
    isMovie,
    isEmbedProvider,
    hasMatureConsent,
    activeServers,
    selectedMovyServer,
    pickDefaultSubtitle,
    persistSubtitlePick,
    pickDefaultAudio,
  ])

  const handleMovyServerSelect = useCallback((city: string) => {
    const normalized = city.toLowerCase()
    setSelectedMovyServer(normalized)
    try {
      localStorage.setItem('movyServer', normalized)
    } catch {
      // ignore
    }
    setStreamError('')
  }, [])

  const handleSourceSelect = useCallback((newSource: string) => {
    setSource(newSource)
    try {
      localStorage.setItem('tvProvider', newSource)
    } catch {
      // ignore
    }
  }, [])

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

    let cancelled = false

    const filtered =
      sourceTypeFilter === 'all' ? streams : streams.filter((s) => s.type === sourceTypeFilter)
    const currentUrl = filtered[qualityIdx]?.url || ''
    if (!currentUrl) return

    const video = videoRef.current
    video.pause()
    video.removeAttribute('src')
    video.load()

    const proxiedUrl = `/api/tv/stream-proxy?url=${encodeURIComponent(currentUrl)}&referer=${encodeURIComponent(referer)}`

    if (filtered[qualityIdx]?.type === 'hls') {
      void (async () => {
        const HlsClass = await loadHls()
        if (cancelled) return
        if (HlsClass && HlsClass.isSupported()) {
          const hls = new HlsClass({ enableWorker: true })
          hlsRef.current = hls
          hls.on(HlsClass.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              setStreamError(`Stream failed (${data.details}). Try another source or reload.`)
              setStreamLoading(false)
              hls.destroy()
              hlsRef.current = null
            }
          })
          hls.loadSource(proxiedUrl)
          hls.attachMedia(video)
          const readSubtitlePreference = (): { enabled: boolean; index: number } => {
            let enabled = false
            let index = 0
            try {
              enabled = localStorage.getItem('tvSubtitlesEnabled') === 'true'
              const stored = parseInt(localStorage.getItem('tvSelectedSubtitle') || '0', 10)
              if (!isNaN(stored) && stored >= 0) index = stored
            } catch {
              // ignore
            }
            return { enabled, index }
          }
          const applySubtitlePreference = () => {
            if (typeof hls.subtitleTrack !== 'number') return
            const tracks = Array.isArray(hls.subtitleTracks) ? hls.subtitleTracks : []
            if (tracks.length === 0) {
              hls.subtitleTrack = -1
              return
            }
            const pref = readSubtitlePreference()
            if (pref.enabled) {
              const target = pref.index < tracks.length ? pref.index : 0
              hls.subtitleTrack = target
              setSelectedSubtitle(target)
            } else {
              hls.subtitleTrack = -1
            }
          }
          bindHlsAudioTracks(hls, HlsClass.Events, {
            getWant: () => selectedAudioTrackRef.current,
            onResolve: (id) => setSelectedAudioTrack(id),
          })
          hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
            applySubtitlePreference()
            video.play().catch(() => {})
          })
          hls.on(HlsClass.Events.SUBTITLE_TRACKS_UPDATED, () => {
            applySubtitlePreference()
          })
          hls.on(HlsClass.Events.SUBTITLE_TRACK_SWITCH, (_e, data) => {
            const tracks = Array.isArray(hls.subtitleTracks) ? hls.subtitleTracks : []
            if (tracks.length === 0) return
            if (data.id === -1) {
              const pref = readSubtitlePreference()
              if (pref.enabled) {
                const target = pref.index < tracks.length ? pref.index : 0
                hls.subtitleTrack = target
                return
              }
            }
            setSelectedSubtitle(data.id)
          })
        } else if (canPlayHlsNatively(video)) {
          video.src = proxiedUrl
          video.play().catch(() => {
            setStreamError('Failed to play stream. Try another source.')
          })
        }
      })()
    } else {
      video.src = proxiedUrl
      video.play().catch(() => {
        setStreamError('Failed to play stream. Try another source.')
      })
    }

    const handleVideoError = () => {
      const err = video.error
      const code = err?.code
      const msg =
        code === 4 ? 'Video source not supported or not found' : 'Failed to load video stream'
      setStreamError(
        `${msg}. The source may be invalid or expired. Try switching source or reloading.`
      )
      setStreamLoading(false)
    }
    video.addEventListener('error', handleVideoError)
    return () => {
      cancelled = true
      video.removeEventListener('error', handleVideoError)
    }
  }, [streams, qualityIdx, sourceTypeFilter, source, referer, isEmbedProvider])

  useEffect(() => {
    const hls = hlsRef.current
    if (!hls || typeof hls.audioTrack !== 'number') return
    hls.audioTrack = selectedAudioTrack
  }, [selectedAudioTrack])

  useEffect(() => {
    const hls = hlsRef.current
    if (!hls || typeof hls.subtitleTrack !== 'number') return
    if (!Array.isArray(hls.subtitleTracks) || hls.subtitleTracks.length === 0) return
    if (selectedSubtitle >= 0) hls.subtitleTrack = selectedSubtitle
    else hls.subtitleTrack = -1
  }, [selectedSubtitle])

  useEffect(() => {
    const video = videoRef.current
    if (!video || isEmbedProvider) return
    video.querySelectorAll('track').forEach((el) => el.remove())
    manualTrackElsRef.current = []
    if (subtitles.length === 0) return
    subtitles.forEach((sub) => {
      const track = document.createElement('track')
      track.kind = 'subtitles'
      track.label = sub.label || sub.language || 'Unknown'
      track.srclang = sub.language || sub.label || 'en'
      const subUrl = `/api/subtitle-proxy?url=${encodeURIComponent(sub.url)}&referer=${encodeURIComponent(referer)}`
      track.src = subUrl
      track.addEventListener('load', () => {
        const idx = manualTrackElsRef.current.indexOf(track)
        const t = track.track as unknown as { mode?: string } | null
        if (t && idx >= 0) t.mode = idx === selectedSubtitleRef.current ? 'showing' : 'hidden'
      })
      video.appendChild(track)
      manualTrackElsRef.current.push(track)
    })
  }, [subtitles, referer, isEmbedProvider, source])

  useEffect(() => {
    const video = videoRef.current
    if (!video || isEmbedProvider) return
    const hls = hlsRef.current
    if (
      hls &&
      typeof hls.subtitleTrack === 'number' &&
      Array.isArray(hls.subtitleTracks) &&
      hls.subtitleTracks.length > 0
    ) {
      hls.subtitleTrack = -1
    }
    const sync = () => {
      const els = manualTrackElsRef.current
      if (els.length > 0) {
        els.forEach((el, idx) => {
          const t = el.track as unknown as { mode?: string } | null
          if (t) t.mode = idx === selectedSubtitle ? 'showing' : 'hidden'
        })
        return
      }
      const tracks = Array.from(video.textTracks)
      if (tracks.length === 0) return
      tracks.forEach((track, idx) => {
        track.mode = idx === selectedSubtitle ? 'showing' : 'hidden'
      })
    }
    sync()
    const handleAddTrack = () => sync()
    video.textTracks.addEventListener('addtrack', handleAddTrack)
    video.addEventListener('loadedmetadata', sync, { once: true } as AddEventListenerOptions)
    const timeout = window.setTimeout(sync, 600)
    return () => {
      video.textTracks.removeEventListener('addtrack', handleAddTrack)
      video.removeEventListener('loadedmetadata', sync)
      window.clearTimeout(timeout)
    }
  }, [selectedSubtitle, subtitles, isEmbedProvider, source])

  useEffect(() => {
    if (!delayCanvasActive) return
    const video = videoRef.current
    const overlay = subtitleOverlayRef.current
    if (!video || !overlay) return

    const renderCues = () => {
      overlay.innerHTML = ''
      if (selectedSubtitleRef.current < 0) return
      const showing = manualTrackElsRef.current
        .map((el) => el.track as unknown as TextTrack | null)
        .find((t) => t && t.mode === 'showing')
      if (!showing) return
      const delaySec = effectiveVideoDelayMs / 1000
      let cues: ArrayLike<TextTrackCue> | TextTrackCue[]
      if (delaySec > 0 && showing.cues) {
        const t = video.currentTime - delaySec
        cues = Array.from(showing.cues).filter((c) => c.startTime <= t && t <= c.endTime)
      } else {
        cues = Array.from(showing.activeCues ?? [])
      }
      if (cues.length === 0) return
      let fontSize = 1.8
      let bottom = 10
      try {
        const fs = parseFloat(localStorage.getItem('subtitleFontSize') || '1.8')
        if (!isNaN(fs)) fontSize = fs
        const pos = parseInt(localStorage.getItem('subtitlePosition') || '10')
        if (!isNaN(pos)) bottom = Math.max(0, Math.min(100, pos))
      } catch {
        // ignore
      }
      cues.forEach((cue) => {
        const text = String((cue as { text?: unknown }).text ?? '').replace(/<[^>]*>/g, '')
        if (!text) return
        const div = document.createElement('div')
        div.style.cssText = `
          font-size: ${fontSize}rem;
          color: white;
          background-color: rgba(0, 0, 0, 0.5);
          text-shadow: 0 0 4px black;
          padding: 0.2em 0.5em;
          text-align: center;
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          bottom: ${bottom}%;
          white-space: pre-wrap;
          line-height: 1.4;
        `
        div.textContent = text
        overlay.appendChild(div)
      })
    }

    const handleCueChange = () => renderCues()
    const manualTracks = manualTrackElsRef.current
      .map((el) => el.track)
      .filter((t): t is TextTrack => Boolean(t))
    manualTracks.forEach((t) => t.addEventListener('cuechange', handleCueChange))
    video.addEventListener('timeupdate', handleCueChange)
    renderCues()
    return () => {
      manualTracks.forEach((t) => t.removeEventListener('cuechange', handleCueChange))
      video.removeEventListener('timeupdate', handleCueChange)
      overlay.innerHTML = ''
    }
  }, [delayCanvasActive, selectedSubtitle, subtitles, effectiveVideoDelayMs])

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

  const _handleSelectItem = (item: TvSearchResult) => {
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
    try {
      const chosen = audioTracks[index]
      if (chosen) localStorage.setItem('tvLastAudio', subtitleKey(chosen))
    } catch {
      // ignore
    }
    const hls = hlsRef.current
    if (hls && hls.audioTrack !== undefined) {
      hls.audioTrack = index
    }
  }

  const handleSubtitleChange = (index: number) => {
    setSelectedSubtitle(index)
    try {
      if (index === -1) {
        localStorage.setItem('tvSubtitlesEnabled', 'false')
      } else {
        localStorage.setItem('tvSubtitlesEnabled', 'true')
        localStorage.setItem('tvSelectedSubtitle', String(index))
        const chosen = subtitles[index]
        if (chosen) localStorage.setItem('tvLastSubtitle', subtitleKey(chosen))
      }
    } catch {
      // ignore
    }
    const video = videoRef.current
    const hls = hlsRef.current
    if (
      hls &&
      typeof hls.subtitleTrack === 'number' &&
      Array.isArray(hls.subtitleTracks) &&
      hls.subtitleTracks.length > 0
    ) {
      hls.subtitleTrack = -1
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
        isAdult: details.adult === true,
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

  useEffect(() => {
    if (!details) {
      document.title = 'TV & Movies - dango'
      return
    }
    document.title = isMovie
      ? `${details.title} - dango`
      : `${details.title} - Season ${season} Episode ${episode} - dango`
  }, [details, isMovie, season, episode])

  useEffect(() => {
    if (!details || isMovie) return
    const params = new URLSearchParams(searchParams)
    const sInUrl = params.get('s')
    const eInUrl = params.get('e')
    const expectedS = String(season)
    const expectedE = String(episode)
    if (sInUrl === expectedS && eInUrl === expectedE) return
    params.set('type', searchParams.get('type') || 'tv')
    params.set('s', expectedS)
    params.set('e', expectedE)
    navigate(`${location.pathname}?${params.toString()}`, { replace: true })
  }, [details, isMovie, season, episode, searchParams, navigate])

  const updateUrlEpisode = (nextSeason: number, nextEpisode: number) => {
    const params = new URLSearchParams(searchParams)
    params.set('type', searchParams.get('type') || 'tv')
    params.set('s', String(nextSeason))
    params.set('e', String(nextEpisode))
    navigate(`${location.pathname}?${params.toString()}`)
  }

  return (
    <div className={styles.page}>
      {details && (
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={handleBack}>
            <Icon name="arrow-left" /> Back
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
              onChange={(e) => {
                const next = parseInt(e.target.value, 10) || 1
                setSeason(next)
                setEpisode(1)
                updateUrlEpisode(next, 1)
              }}
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
              onChange={(e) => {
                const next = parseInt(e.target.value, 10) || 1
                setEpisode(next)
                updateUrlEpisode(season, next)
              }}
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
              onChange={(e) => handleSourceSelect(e.target.value)}
              className={styles.select}
              disabled={tvProviders.length === 0}
            >
              {providersLoading ? (
                <option value="">Loading…</option>
              ) : tvProviders.length === 0 ? (
                <option value="">No providers available</option>
              ) : (
                <>
                  {directProviders.length > 0 && (
                    <optgroup label="Direct HLS">
                      {directProviders.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {embedProviders.length > 0 && (
                    <optgroup label="Embeds">
                      {embedProviders.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </>
              )}
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
              onChange={(e) => handleSourceSelect(e.target.value)}
              className={styles.select}
              disabled={tvProviders.length === 0}
            >
              {providersLoading ? (
                <option value="">Loading…</option>
              ) : tvProviders.length === 0 ? (
                <option value="">No providers available</option>
              ) : (
                <>
                  {directProviders.length > 0 && (
                    <optgroup label="Direct HLS">
                      {directProviders.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {embedProviders.length > 0 && (
                    <optgroup label="Embeds">
                      {embedProviders.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </>
              )}
            </select>
          </label>
        </div>
      )}

      {details && (
        <div
          className={styles.playerSection}
          style={
            details.adult && !hasMatureConsent
              ? { filter: 'blur(14px)', pointerEvents: 'none', userSelect: 'none' }
              : undefined
          }
        >
          {streamLoading && !isEmbedProvider && (
            <div className={styles.statusMsg}>
              <Icon name="spinner" className={styles.spinner} /> Loading stream...
            </div>
          )}
          {isEmbedProvider && iframeUrl ? (
            <iframe
              src={iframeUrl}
              className={styles.videoIframe}
              allow="autoplay; fullscreen"
              allowFullScreen
            />
          ) : !isEmbedProvider && !streamLoading && filteredStreams.length > 0 ? (
            <>
              {streamError && (
                <div
                  className={`${styles.statusMsg} ${styles.error}`}
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ flex: 1 }}>{streamError}</span>
                    <button className={styles.retryButton} onClick={loadStreams}>
                      Retry
                    </button>
                  </div>
                  {activeServers.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 6,
                        alignItems: 'center',
                        marginTop: 4,
                      }}
                    >
                      <span style={{ fontSize: '0.8rem', opacity: 0.9, fontWeight: 600 }}>
                        Servers:
                      </span>
                      {activeServers.map((city) => (
                        <button
                          key={city}
                          onClick={() => handleMovyServerSelect(city)}
                          className={styles.retryButton}
                          style={{
                            padding: '4px 8px',
                            fontSize: '0.75rem',
                            textTransform: 'capitalize',
                            background: selectedMovyServer === city ? 'var(--accent)' : undefined,
                            color: selectedMovyServer === city ? 'white' : undefined,
                          }}
                        >
                          {city}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
                movyServers={activeServers}
                selectedMovyServer={selectedMovyServer}
                onMovyServerSelect={handleMovyServerSelect}
                isMovySource={activeServers.length > 0}
                videoDelayEnabled={videoDelayEnabled}
                onVideoDelayToggle={(v) => {
                  setVideoDelayEnabled(v)
                  try {
                    localStorage.setItem('playerVideoDelayEnabled', String(v))
                  } catch {
                    // ignore
                  }
                }}
                videoDelayMs={videoDelayMs}
                onVideoDelayChange={(ms) => {
                  const clamped = Math.max(0, Math.min(500, Math.round(ms)))
                  setVideoDelayMs(clamped)
                  try {
                    localStorage.setItem('playerVideoDelayMs', String(clamped))
                  } catch {
                    // ignore
                  }
                }}
                onCalibrateAvSync={() => {
                  const v = videoRef.current
                  wasPlayingBeforeCalibRef.current = !!v && !v.paused && !v.ended
                  v?.pause()
                  setIsCalibrating(true)
                }}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  disablePictureInPicture
                  className={`${styles.video} ${delayCanvasActive ? styles.videoHidden : ''}`}
                  onError={() => {
                    setStreamError('Video failed to load. Try another server or reload.')
                    setStreamLoading(false)
                  }}
                />
                <canvas
                  ref={delayCanvasRef}
                  className={`${styles.delayCanvas} ${delayCanvasActive ? styles.delayCanvasActive : ''}`}
                />
                {delayCanvasActive && (
                  <div ref={subtitleOverlayRef} className={styles.subtitleOverlay} />
                )}
                <AvSyncCalibrator
                  isOpen={isCalibrating}
                  initialMs={videoDelayMs}
                  onClose={() => {
                    setIsCalibrating(false)
                    resumeAfterCalib()
                  }}
                  onApply={(ms) => {
                    const clamped = Math.max(0, Math.min(500, Math.round(ms)))
                    setVideoDelayMs(clamped)
                    setVideoDelayEnabled(true)
                    try {
                      localStorage.setItem('playerVideoDelayMs', String(clamped))
                      localStorage.setItem('playerVideoDelayEnabled', 'true')
                    } catch {
                      // ignore
                    }
                    setIsCalibrating(false)
                    resumeAfterCalib()
                  }}
                />
              </TvPlayerControls>
            </>
          ) : streamError && !isEmbedProvider ? (
            <div
              className={`${styles.statusMsg} ${styles.error}`}
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ flex: 1 }}>{streamError}</span>
                <button className={styles.retryButton} onClick={loadStreams}>
                  Retry
                </button>
              </div>
              {activeServers.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    alignItems: 'center',
                    marginTop: 4,
                  }}
                >
                  <span style={{ fontSize: '0.8rem', opacity: 0.9, fontWeight: 600 }}>
                    Servers:
                  </span>
                  {activeServers.map((city) => (
                    <button
                      key={city}
                      onClick={() => handleMovyServerSelect(city)}
                      className={styles.retryButton}
                      style={{
                        padding: '4px 8px',
                        fontSize: '0.75rem',
                        textTransform: 'capitalize',
                        background: selectedMovyServer === city ? 'var(--accent)' : undefined,
                        color: selectedMovyServer === city ? 'white' : undefined,
                      }}
                    >
                      {city}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {details?.adult && !hasMatureConsent && (
        <Modal isOpen title="Content Warning" onClose={handleBack}>
          <div style={{ padding: '1rem', textAlign: 'center' }}>
            <p>This title contains mature content intended for adult audiences.</p>
            <p>
              By proceeding, you confirm that you are <strong>18 years of age or older</strong> (or
              the age of majority in your jurisdiction) and wish to view this content.
            </p>
            <div
              style={{
                marginTop: '1rem',
                display: 'flex',
                gap: '10px',
                justifyContent: 'center',
              }}
            >
              <Button variant="secondary" onClick={handleBack}>
                Go Back
              </Button>
              <Button onClick={grantMatureConsent}>I'm 18+, Continue</Button>
            </div>
          </div>
        </Modal>
      )}

      {!details && (
        <>
          <header className={styles.header}>
            <h1 className={styles.pageTitle}>
              <Icon name="tv" /> TV & Movies
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
                <Icon name="search" />
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
