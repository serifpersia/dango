import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router'
import toast from 'react-hot-toast'
import Icon from '../components/common/Icon'
import TvPlayerControls from '../components/tv/TvPlayerControls'
import { Modal } from '../components/common/Modal'
import { Button } from '../components/common/Button'
import { useMatureConsent } from '../hooks/useMatureConsent'
import { useProviders } from '../hooks/useProviders'
import {
  useSaveTvProgress,
  useTvLatestProgress,
  useTvProgress,
  useToggleTvBookmark,
} from '../hooks/useTvLibrary'
import { useTvLibraryCheck } from '../hooks/useTvLibrary'
import { buildTvId } from '../lib/tv'
import { loadHls, canPlayHlsNatively } from '../lib/hls'
import { bindHlsAudioTracks } from '../lib/hlsAudio'
import { pickSubtitleIndex, subtitleKey } from '../lib/subtitles'
import {
  buildOverlayCss,
  renderCueHtml,
  stripCueTags,
  type SubtitleStyleSettings,
} from '../lib/subtitleStyle'
import useDelayCanvas from '../hooks/useDelayCanvas'
import useIsMobile from '../hooks/useIsMobile'
import useVideoPlayer from '../hooks/useVideoPlayer'
import AvSyncCalibrator from '../components/player/AvSyncCalibrator'
import EpisodeList, { type EpisodeListItem } from '../components/player/EpisodeList'
import EpisodeListSkeleton from '../components/player/EpisodeListSkeleton'
import EpisodeDrawer from '../components/player/EpisodeDrawer'
import PlayerStatusArea from '../components/player/PlayerStatusArea'
import SynopsisText from '../components/anime/SynopsisText'
import type Hls from 'hls.js'
import styles from './Tv.module.css'
import layoutStyles from './PlayerPageLayout.module.css'
import playerStyles from './Player.module.css'

type MediaType = 'movie' | 'tv' | 'tvSeries' | 'tvMiniSeries'

interface TvDetails {
  id: number
  title: string
  overview: string
  vote_average?: number
  vote_count?: number
  year: string
  poster: string
  backdrop: string
  imdb_id?: string
  adult?: boolean
  status?: string
  genres?: { id: number; name: string }[]
  seasons?: { season_number: number; episode_count: number; name?: string }[]
  number_of_seasons?: number
  number_of_episodes?: number
  first_air_date?: string
  last_air_date?: string
  networks?: { name: string }[]
  created_by?: { name: string }[]
  episode_run_time?: number[]
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

const Tv: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const typeParam = searchParams.get('type') as MediaType | null

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
  const player = useVideoPlayer({ skipIntervals: [] })
  const videoRef = player.refs.videoRef
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
  const [testClipActive, setTestClipActive] = useState(false)
  const calibSnapshotRef = useRef<{ enabled: boolean; ms: number } | null>(null)
  const calibReturnRef = useRef<number | null>(null)
  const persistVideoDelay = (ms: number, enabled: boolean) => {
    try {
      localStorage.setItem('playerVideoDelayMs', String(ms))
      localStorage.setItem('playerVideoDelayEnabled', String(enabled))
    } catch {
      // ignore
    }
  }
  const handleVideoDelayChange = (ms: number) => {
    const clamped = Math.max(0, Math.min(500, Math.round(ms)))
    setVideoDelayMs(clamped)
    try {
      localStorage.setItem('playerVideoDelayMs', String(clamped))
    } catch {
      // ignore
    }
  }
  const openAvSyncCalibrator = () => {
    calibSnapshotRef.current = { enabled: videoDelayEnabled, ms: videoDelayMs }
    setVideoDelayEnabled(true)
    try {
      localStorage.setItem('playerVideoDelayEnabled', 'true')
    } catch {
      // ignore
    }
    setIsCalibrating(true)
  }
  const cancelAvSyncCalibrator = () => {
    const snap = calibSnapshotRef.current
    calibSnapshotRef.current = null
    if (snap) {
      setVideoDelayMs(snap.ms)
      setVideoDelayEnabled(snap.enabled)
      persistVideoDelay(snap.ms, snap.enabled)
    }
    setTestClipActive(false)
    setIsCalibrating(false)
  }
  const applyAvSyncCalibrator = () => {
    calibSnapshotRef.current = null
    setVideoDelayEnabled(true)
    persistVideoDelay(videoDelayMs, true)
    setTestClipActive(false)
    setIsCalibrating(false)
  }
  const toggleTestClip = () => {
    if (testClipActive) {
      setTestClipActive(false)
      return
    }
    const v = videoRef.current
    if (v && !isNaN(v.currentTime)) calibReturnRef.current = v.currentTime
    setTestClipActive(true)
  }
  const effectiveVideoDelayMs = videoDelayEnabled ? videoDelayMs : 0
  useDelayCanvas({
    videoRef,
    canvasRef: delayCanvasRef,
    delayMs: effectiveVideoDelayMs,
    enabled: videoDelayEnabled,
  })
  const delayCanvasActive = videoDelayEnabled
  const { hasConsent: hasMatureConsent, grant: grantMatureConsent } = useMatureConsent()
  const discordSessionRef = useRef<string>('')
  if (!discordSessionRef.current) {
    discordSessionRef.current = `tv-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  const isMovie = typeParam === 'movie'

  const mediaId = id ? `${typeParam || 'tv'}-${id}` : ''
  const libraryId = id ? buildTvId(typeParam || 'tv', id) : ''
  const saveProgress = useSaveTvProgress()
  const {
    toggle: toggleTvWatchlist,
    bookmarkedIds,
    pending: bookmarkPending,
  } = useToggleTvBookmark()
  const { data: libraryCheck } = useTvLibraryCheck(details ? libraryId : undefined)
  const inTvLibrary = libraryCheck
    ? !!libraryCheck.inLibrary
    : libraryId
      ? bookmarkedIds.has(libraryId)
      : false
  const handleToggleWatchlist = useCallback(() => {
    if (!details || !id) return
    toggleTvWatchlist({
      tmdbId: Number(id),
      mediaType: typeParam || 'tv',
      title: details.title,
      poster: details.poster,
      year: details.year,
      adult: details.adult,
    })
  }, [details, id, typeParam, toggleTvWatchlist])
  const { data: savedProgress } = useTvLatestProgress(mediaId || undefined, season, episode)
  const [showResumeModal, setShowResumeModal] = useState(false)
  const [resumeTime, setResumeTime] = useState(0)
  const [showCompleteModal, setShowCompleteModal] = useState(false)
  const [completeTitle, setCompleteTitle] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [isEpisodeDrawerOpen, setIsEpisodeDrawerOpen] = useState(false)
  const isMobile = useIsMobile()
  const hasResumedRef = useRef(false)
  const progressSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedTimeRef = useRef(0)
  const videoEndedRef = useRef(false)
  const showResumeModalRef = useRef(false)
  useEffect(() => {
    showResumeModalRef.current = showResumeModal
  }, [showResumeModal])

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const saveVideoProgress = useCallback(
    (currentTime: number, duration: number) => {
      if (!mediaId || !duration || duration < 30) return
      if (Math.abs(currentTime - lastSavedTimeRef.current) < 10) return
      lastSavedTimeRef.current = currentTime
      saveProgress.mutate({
        mediaId,
        season,
        episode,
        currentTime: Math.floor(currentTime),
        duration: Math.floor(duration),
        title: details?.title ?? null,
        poster: details?.poster ?? null,
        backdrop: details?.backdrop ?? null,
        year: details?.year ?? null,
        overview: details?.overview ?? null,
        tmdbId: details?.id ?? null,
        mediaType: typeParam || 'tv',
        adult: details?.adult ? 1 : 0,
      })
    },
    [mediaId, season, episode, saveProgress, details, typeParam]
  )

  const updateUrlEpisode = useCallback(
    (nextSeason: number, nextEpisode: number) => {
      setTestClipActive(false)
      setIsCalibrating(false)
      const params = new URLSearchParams(searchParams)
      params.set('type', searchParams.get('type') || 'tv')
      params.set('s', String(nextSeason))
      params.set('e', String(nextEpisode))
      navigate(`${location.pathname}?${params.toString()}`)
    },
    [searchParams, navigate]
  )

  const handleVideoTimeUpdate = useCallback(() => {
    if (testClipActive) return
    const video = videoRef.current
    if (!video || video.paused || video.ended) return
    if (progressSaveTimerRef.current) clearTimeout(progressSaveTimerRef.current)
    progressSaveTimerRef.current = setTimeout(() => {
      saveVideoProgress(video.currentTime, video.duration || 0)
    }, 5000)
  }, [saveVideoProgress, videoRef, testClipActive])

  const handleVideoEnded = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (progressSaveTimerRef.current) clearTimeout(progressSaveTimerRef.current)
    saveVideoProgress(video.currentTime, video.duration || 0)
    videoEndedRef.current = true
    if (isMovie && details) {
      setCompleteTitle(details.title)
      setShowCompleteModal(true)
    } else if (details) {
      const nextEpisode = episode + 1
      const currentEpisodes = episodes
      const hasNextEpisode = currentEpisodes.some((ep) => ep.episode_number === nextEpisode)
      if (hasNextEpisode) {
        setEpisode(nextEpisode)
        updateUrlEpisode(season, nextEpisode)
      } else {
        setCompleteTitle(`${details.title} — Season ${season}`)
        setShowCompleteModal(true)
      }
    }
  }, [isMovie, details, episode, season, episodes, saveVideoProgress, updateUrlEpisode, videoRef])

  const handleVideoPlay = useCallback(() => {
    videoEndedRef.current = false
    player.actions.onPlay()
  }, [player.actions])

  const handleVideoPause = useCallback(() => {
    player.actions.onPause()
    const video = videoRef.current
    if (video && !video.ended) {
      saveVideoProgress(video.currentTime, video.duration || 0)
    }
  }, [player.actions, saveVideoProgress, videoRef])

  const handleVideoLoadedMetadata = useCallback(() => {
    player.actions.onLoadedMetadata()
    const video = videoRef.current
    if (!video) return
    try {
      const storedVolume = parseFloat(localStorage.getItem('playerVolume') || '')
      if (!isNaN(storedVolume)) video.volume = Math.max(0, Math.min(1, storedVolume))
      video.muted = localStorage.getItem('playerMuted') === 'true'
    } catch {
      // ignore
    }
  }, [player.actions, videoRef])

  const handleResume = useCallback(() => {
    const video = videoRef.current
    if (video && resumeTime > 0) {
      video.currentTime = resumeTime
      video.play().catch(() => {})
    }
    setShowResumeModal(false)
    hasResumedRef.current = true
  }, [resumeTime, videoRef])

  const handleSkipResume = useCallback(() => {
    const video = videoRef.current
    if (video) {
      video.currentTime = 0
      video.play().catch(() => {})
    }
    setShowResumeModal(false)
    hasResumedRef.current = true
  }, [videoRef])

  useEffect(() => {
    hasResumedRef.current = false
    setShowResumeModal(false)
    setResumeTime(0)
    lastSavedTimeRef.current = 0
  }, [mediaId, season, episode])

  useEffect(() => {
    if (!savedProgress || hasResumedRef.current) return
    const c = savedProgress as { currentTime?: number; duration?: number }
    const ct = c.currentTime ?? 0
    const dur = c.duration ?? 0
    if (ct > 10 && dur > 30 && ct < dur * 0.95) {
      setResumeTime(ct)
      setShowResumeModal(true)
    }
  }, [savedProgress, mediaId, season, episode])

  useEffect(() => {
    if (showResumeModal && videoRef.current) {
      videoRef.current.pause()
    }
  }, [showResumeModal, videoRef])

  useEffect(() => {
    const video = videoRef.current
    return () => {
      if (progressSaveTimerRef.current) clearTimeout(progressSaveTimerRef.current)
      if (video && !video.ended) {
        saveVideoProgress(video.currentTime, video.duration || 0)
      }
    }
  }, [saveVideoProgress, videoRef])

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

  const { data: tvProgress } = useTvProgress(mediaId || undefined)
  const watchedEpisodeIds = useMemo(() => {
    const rows = tvProgress?.progress ?? []
    return rows
      .filter(
        (row) => row.season === season && row.duration > 0 && row.currentTime >= row.duration * 0.8
      )
      .map((row) => String(row.episode))
  }, [tvProgress, season])

  const tvEpisodeItems = useMemo<EpisodeListItem[]>(
    () =>
      episodes.map((ep) => ({
        id: String(ep.episode_number),
        label: `Episode ${ep.episode_number}`,
        sublabel: ep.name || undefined,
        thumbnail: ep.still_path ? `https://image.tmdb.org/t/p/w185${ep.still_path}` : undefined,
      })),
    [episodes]
  )

  const sortedEpisodeNumbers = useMemo(
    () => episodes.map((ep) => ep.episode_number).sort((a, b) => a - b),
    [episodes]
  )
  const episodeIndex = sortedEpisodeNumbers.indexOf(episode)
  const prevEpisodeNumber = episodeIndex > 0 ? sortedEpisodeNumbers[episodeIndex - 1] : null
  const nextEpisodeNumber =
    episodeIndex >= 0 && episodeIndex < sortedEpisodeNumbers.length - 1
      ? sortedEpisodeNumbers[episodeIndex + 1]
      : null

  const genreNames = useMemo(
    () => (details?.genres ?? []).map((g) => g.name).slice(0, 5),
    [details]
  )
  const metaRow = useMemo(
    () =>
      [
        details?.year,
        details?.status,
        details?.number_of_seasons
          ? `${details.number_of_seasons} Season${details.number_of_seasons > 1 ? 's' : ''}`
          : null,
        details?.number_of_episodes ? `${details.number_of_episodes} Episodes` : null,
      ].filter(Boolean) as string[],
    [details]
  )

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
      setDetails(null)
      setStreams([])
      setStreamError('')
      setIframeUrl('')
      return
    }

    const itemId = Number(id)
    const mediaType = typeParam || 'tv'
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

    fetch(`/api/tv/details/${mediaType}/${itemId}`)
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
        // ignore
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
        // ignore
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

    if (testClipActive) {
      const clipVideo = videoRef.current
      if (clipVideo) {
        clipVideo.pause()
        clipVideo.removeAttribute('src')
        clipVideo.load()
        clipVideo.src = '/av-sync-test.mp4'
        if (!showResumeModalRef.current) clipVideo.play().catch(() => {})
      }
      return () => {
        cancelled = true
      }
    }

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
            if (manualTrackElsRef.current.length > 0) {
              hls.subtitleTrack = -1
              return
            }
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
            if (calibReturnRef.current != null) {
              video.currentTime = calibReturnRef.current
              calibReturnRef.current = null
            }
            if (!showResumeModalRef.current) video.play().catch(() => {})
          })
          hls.on(HlsClass.Events.SUBTITLE_TRACKS_UPDATED, () => {
            applySubtitlePreference()
          })
          hls.on(HlsClass.Events.SUBTITLE_TRACK_SWITCH, (_e, data) => {
            if (manualTrackElsRef.current.length > 0) {
              if (data.id !== -1) {
                try {
                  hls.subtitleTrack = -1
                } catch {
                  // ignore
                }
              }
              return
            }
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
          if (calibReturnRef.current != null) {
            video.currentTime = calibReturnRef.current
            calibReturnRef.current = null
          }
          if (!showResumeModalRef.current) {
            video.play().catch(() => {
              setStreamError('Failed to play stream. Try another source.')
            })
          }
        }
      })()
    } else {
      video.src = proxiedUrl
      if (calibReturnRef.current != null) {
        video.currentTime = calibReturnRef.current
        calibReturnRef.current = null
      }
      if (!showResumeModalRef.current) {
        video.play().catch(() => {
          setStreamError('Failed to play stream. Try another source.')
        })
      }
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
  }, [
    streams,
    qualityIdx,
    sourceTypeFilter,
    source,
    referer,
    isEmbedProvider,
    videoRef,
    testClipActive,
  ])

  useEffect(() => {
    const hls = hlsRef.current
    if (!hls || typeof hls.audioTrack !== 'number') return
    hls.audioTrack = selectedAudioTrack
  }, [selectedAudioTrack])

  useEffect(() => {
    const hls = hlsRef.current
    if (!hls || typeof hls.subtitleTrack !== 'number') return
    if (!Array.isArray(hls.subtitleTracks) || hls.subtitleTracks.length === 0) return
    if (manualTrackElsRef.current.length > 0) return
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
    if (subtitles.length > 0) {
      try {
        const hls = hlsRef.current
        if (hls && typeof hls.subtitleTrack === 'number' && hls.subtitleTrack !== -1) {
          hls.subtitleTrack = -1
        }
      } catch {
        // ignore
      }
    }
  }, [subtitles, referer, isEmbedProvider, source, videoRef])

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
  }, [selectedSubtitle, subtitles, isEmbedProvider, source, videoRef])

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
      const subtitleStyle: SubtitleStyleSettings = {
        fontSize: player.state.subtitleFontSize,
        position: player.state.subtitlePosition,
        bgOpacity: player.state.subtitleBgOpacity,
        bgColor: player.state.subtitleBgColor,
        textColor: player.state.subtitleTextColor,
        edge: player.state.subtitleEdge,
        bold: player.state.subtitleBold,
      }
      const baseCss = buildOverlayCss(subtitleStyle)
      const baseBottom = subtitleStyle.position
      const cueArray = Array.from(cues)
      cueArray.forEach((cue, index) => {
        const raw = String((cue as { text?: unknown }).text ?? '')
        if (!stripCueTags(raw).trim()) return
        const div = document.createElement('div')
        const stackOffset = (cueArray.length - 1 - index) * 1.7
        div.style.cssText = `${baseCss}\nbottom: calc(${baseBottom}% + ${stackOffset}em);`
        div.innerHTML = renderCueHtml(raw)
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
  }, [
    delayCanvasActive,
    selectedSubtitle,
    subtitles,
    effectiveVideoDelayMs,
    videoRef,
    player.state.subtitleFontSize,
    player.state.subtitlePosition,
    player.state.subtitleBgOpacity,
    player.state.subtitleBgColor,
    player.state.subtitleTextColor,
    player.state.subtitleEdge,
    player.state.subtitleBold,
  ])

  const handleBack = () => {
    setDetails(null)
    setStreams([])
    setIframeUrl('')
    navigate(-1)
  }

  const handleSeasonSelect = useCallback(
    (next: number) => {
      setSeason(next)
      setEpisode(1)
      updateUrlEpisode(next, 1)
    },
    [updateUrlEpisode]
  )

  const handleTvEpisodeClick = useCallback(
    (epId: string) => {
      const next = parseInt(epId, 10)
      if (!isNaN(next)) {
        setEpisode(next)
        updateUrlEpisode(season, next)
      }
      setIsEpisodeDrawerOpen(false)
    },
    [season, updateUrlEpisode]
  )

  useEffect(() => {
    if (isMovie) return
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target.closest(
          'input, textarea, button, select, a, [role="button"], [contenteditable="true"]'
        )
      )
        return
      if (e.key.toLowerCase() === 'n') {
        if (nextEpisodeNumber != null) {
          handleTvEpisodeClick(String(nextEpisodeNumber))
        } else {
          toast.error('No next episode available')
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMovie, nextEpisodeNumber, handleTvEpisodeClick])

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
  }, [details, isMovie, season, episode, videoRef])

  useEffect(() => {
    if (!details) return
    sendTvPresence()
    const id = window.setInterval(() => {
      const video = videoRef.current
      if (!video || !video.paused) sendTvPresence()
    }, 15000)
    return () => window.clearInterval(id)
  }, [sendTvPresence, details, videoRef])

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
  }, [details, isEmbedProvider, streamLoading, streamError, streams, sendTvPresence, videoRef])

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

  return (
    <div className={layoutStyles.playerPageLayout}>
      <aside className={layoutStyles.episodeSidebar}>
        {details ? (
          isMovie ? (
            <div className={styles.sidebarPosterCard}>
              {details.poster && (
                <img
                  src={`https://image.tmdb.org/t/p/w342${details.poster}`}
                  alt={details.title}
                  loading="lazy"
                  decoding="async"
                />
              )}
              <div className={styles.sidebarPosterMeta}>
                <strong>{details.title}</strong>
                <span>{details.year}</span>
              </div>
            </div>
          ) : (
            <EpisodeList
              episodes={tvEpisodeItems}
              currentEpisode={String(episode)}
              watchedEpisodes={watchedEpisodeIds}
              onEpisodeClick={handleTvEpisodeClick}
              header={
                <label className={styles.sidebarSeason}>
                  <span>Season</span>
                  <select
                    value={season}
                    onChange={(e) => handleSeasonSelect(parseInt(e.target.value, 10) || 1)}
                    className={styles.select}
                  >
                    {details.seasons?.map((s) => (
                      <option key={s.season_number} value={s.season_number}>
                        Season {s.season_number} ({s.episode_count} ep)
                      </option>
                    ))}
                  </select>
                </label>
              }
            />
          )
        ) : isMovie ? (
          <div className={styles.statusMsg}>
            <Icon name="spinner" className={styles.spinner} /> Loading...
          </div>
        ) : (
          <EpisodeListSkeleton variant="sidebar" />
        )}
      </aside>

      <div className={layoutStyles.playerMain}>
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
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                    >
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
                  player={player}
                  title={details.title}
                  episodeLabel={isMovie ? undefined : `S${season} E${episode}`}
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
                  onVideoDelayChange={handleVideoDelayChange}
                  onCalibrateAvSync={openAvSyncCalibrator}
                >
                  <video
                    ref={videoRef}
                    autoPlay={!showResumeModal}
                    playsInline
                    disablePictureInPicture
                    className={`${styles.video} ${delayCanvasActive ? styles.videoHidden : ''}`}
                    onTimeUpdate={handleVideoTimeUpdate}
                    onEnded={() => {
                      if (!testClipActive) handleVideoEnded()
                    }}
                    onPlay={handleVideoPlay}
                    onPause={handleVideoPause}
                    onLoadedMetadata={handleVideoLoadedMetadata}
                    onVolumeChange={player.actions.onVolumeChange}
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
                    ms={videoDelayMs}
                    onChange={handleVideoDelayChange}
                    onApply={applyAvSyncCalibrator}
                    onClose={cancelAvSyncCalibrator}
                    testClipActive={testClipActive}
                    onTestClip={toggleTestClip}
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

        {details && <PlayerStatusArea showTheater={false} />}

        {details && (
          <div className={styles.providerSelectWrap}>
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
          <div className={layoutStyles.playerInfoContainer}>
            <div className={layoutStyles.playerInfoHeader}>
              <div className={layoutStyles.playerAnimeCard}>
                {details.poster && (
                  <img
                    src={`https://image.tmdb.org/t/p/w342${details.poster}`}
                    alt={details.title}
                    loading="lazy"
                    decoding="async"
                  />
                )}
              </div>
              <div className={layoutStyles.videoTitleSection}>
                <div className={playerStyles.titleContainer}>
                  <h1>{details.title}</h1>
                  <div className={styles.meta}>
                    <span className={styles.year}>{details.year}</span>
                    {details.vote_average != null && details.vote_average > 0 && (
                      <span className={styles.rating}>
                        <Icon name="star" size={12} />
                        {Number(details.vote_average).toFixed(1)}
                      </span>
                    )}
                    <span className={`${styles.typeBadge} ${styles[isMovie ? 'movie' : 'tv']}`}>
                      {isMovie ? 'Movie' : 'TV Show'}
                    </span>
                  </div>
                  {genreNames.length > 0 && (
                    <div className={styles.genreRow}>
                      {genreNames.map((g) => (
                        <span key={g} className={styles.genreChip}>
                          {g}
                        </span>
                      ))}
                    </div>
                  )}
                  {metaRow.length > 0 && (
                    <div className={styles.metaRow}>
                      {metaRow.map((m, i) => (
                        <span key={`${m}-${i}`}>
                          {m}
                          {i < metaRow.length - 1 ? ' · ' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className={playerStyles.controls}>
                  <button
                    className={`${playerStyles.watchlistBtn} ${inTvLibrary ? playerStyles.inList : ''}`}
                    onClick={handleToggleWatchlist}
                    disabled={bookmarkPending}
                    type="button"
                  >
                    {inTvLibrary ? <Icon name="check" size={14} /> : <Icon name="plus" size={14} />}
                    {inTvLibrary ? 'In Watchlist' : 'Add to Watchlist'}
                  </button>
                  {!isMovie && (
                    <>
                      <button
                        className={`${playerStyles.watchlistBtn}`}
                        onClick={() =>
                          prevEpisodeNumber != null &&
                          handleTvEpisodeClick(String(prevEpisodeNumber))
                        }
                        disabled={prevEpisodeNumber == null}
                        type="button"
                      >
                        <Icon name="chevron-left" size={14} />
                        Prev EP
                      </button>
                      <button
                        className={`${playerStyles.watchlistBtn}`}
                        onClick={() =>
                          nextEpisodeNumber != null &&
                          handleTvEpisodeClick(String(nextEpisodeNumber))
                        }
                        disabled={nextEpisodeNumber == null}
                        type="button"
                      >
                        Next EP
                        <Icon name="chevron-right" size={14} />
                      </button>
                      {isMobile && (
                        <button
                          className={`${playerStyles.watchlistBtn}`}
                          onClick={() => setIsEpisodeDrawerOpen(true)}
                          type="button"
                        >
                          <Icon name="list-ul" size={14} />
                          Episodes
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className={playerStyles.descriptionSection}>
              <h3>Synopsis</h3>
              <SynopsisText text={details.overview} emptyText="No description available." />
            </div>

            <button
              className={playerStyles.detailsToggleBtn}
              onClick={() => setShowDetails(!showDetails)}
              type="button"
            >
              {showDetails ? <Icon name="chevron-up" /> : <Icon name="chevron-down" />}
              {showDetails ? 'Hide Details' : 'Show Details'}
            </button>

            {showDetails && (
              <div className={styles.detailGrid}>
                {details.first_air_date && (
                  <div className={styles.detailItem}>
                    <strong>{isMovie ? 'Release Date' : 'First Air Date'}</strong>
                    <span>{details.first_air_date}</span>
                  </div>
                )}
                {details.last_air_date && (
                  <div className={styles.detailItem}>
                    <strong>Last Air Date</strong>
                    <span>{details.last_air_date}</span>
                  </div>
                )}
                {details.networks && details.networks.length > 0 && (
                  <div className={styles.detailItem}>
                    <strong>Networks</strong>
                    <span>{details.networks.map((n) => n.name).join(', ')}</span>
                  </div>
                )}
                {details.created_by && details.created_by.length > 0 && (
                  <div className={styles.detailItem}>
                    <strong>Created By</strong>
                    <span>{details.created_by.map((c) => c.name).join(', ')}</span>
                  </div>
                )}
                {details.episode_run_time && details.episode_run_time.length > 0 && (
                  <div className={styles.detailItem}>
                    <strong>Episode Runtime</strong>
                    <span>{details.episode_run_time[0]} min</span>
                  </div>
                )}
                {details.imdb_id && (
                  <div className={styles.detailItem}>
                    <strong>IMDb</strong>
                    <a
                      href={`https://www.imdb.com/title/${details.imdb_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.imdbLink}
                    >
                      View on IMDb
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!isMovie && (
          <EpisodeDrawer
            isOpen={isEpisodeDrawerOpen}
            onClose={() => setIsEpisodeDrawerOpen(false)}
            episodes={tvEpisodeItems}
            currentEpisode={String(episode)}
            watchedEpisodes={watchedEpisodeIds}
            onEpisodeClick={handleTvEpisodeClick}
          />
        )}

        {details?.adult && !hasMatureConsent && (
          <Modal isOpen title="Content Warning" onClose={handleBack}>
            <div style={{ padding: '1rem', textAlign: 'center' }}>
              <p>This title contains mature content intended for adult audiences.</p>
              <p>
                By proceeding, you confirm that you are <strong>18 years of age or older</strong>{' '}
                (or the age of majority in your jurisdiction) and wish to view this content.
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

        <Modal isOpen={showResumeModal} onClose={handleSkipResume} title="Resume Watching">
          <div style={{ padding: '1rem', textAlign: 'center' }}>
            <p>
              You were at <strong>{formatTime(resumeTime)}</strong>
            </p>
            <div
              style={{
                marginTop: '1rem',
                display: 'flex',
                gap: '10px',
                justifyContent: 'center',
              }}
            >
              <Button variant="secondary" onClick={handleSkipResume}>
                Start from Beginning
              </Button>
              <Button onClick={handleResume}>Resume</Button>
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={showCompleteModal}
          onClose={() => setShowCompleteModal(false)}
          title="Finished!"
        >
          <div style={{ padding: '1rem', textAlign: 'center' }}>
            <Icon
              name="check-circle"
              size={48}
              style={{ color: 'var(--accent-lighter)', marginBottom: '0.5rem' }}
            />
            <p style={{ fontSize: '1.1rem', fontWeight: 600 }}>{completeTitle}</p>
            <p style={{ color: 'var(--text-secondary)' }}>
              {isMovie ? 'You finished this movie!' : 'You finished this season!'}
            </p>
            <div
              style={{
                marginTop: '1rem',
                display: 'flex',
                gap: '10px',
                justifyContent: 'center',
              }}
            >
              <Button variant="secondary" onClick={() => setShowCompleteModal(false)}>
                Close
              </Button>
              <Button
                onClick={() => {
                  setShowCompleteModal(false)
                  handleBack()
                }}
              >
                Back to Details
              </Button>
            </div>
          </div>
        </Modal>

        {!details && (
          <div className={styles.statusMsg}>
            <Icon name="spinner" className={styles.spinner} /> Loading...
          </div>
        )}
      </div>
    </div>
  )
}

export default Tv
