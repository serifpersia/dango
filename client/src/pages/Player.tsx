import React, { useRef, useEffect, useMemo, useCallback, useState, useLayoutEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import styles from './Player.module.css'
import layoutStyles from './PlayerPageLayout.module.css'
import shellStyles from '../components/player/UnifiedPlayer.module.css'
import Icon from '../components/common/Icon'
import { fixThumbnailUrl } from '../lib/utils'
import { isProgressCompleted, storeAutoplayEnabled } from '../lib/playbackCompletion'
import { loadHls } from '../lib/hls'
import { fetchApi } from '../lib/fetchApi'
import { pickSubtitleIndex } from '../lib/subtitles'
import {
  buildCueCss,
  buildOverlayCss,
  fitSubtitleSize,
  renderCueHtml,
  stripCueTags,
  subtitleBottomPx,
  type SubtitleStyleSettings,
} from '../lib/subtitleStyle'
import type Hls from 'hls.js'
import { Modal } from '../components/common/Modal'
import { Button } from '../components/common/Button'
import { useMatureConsent } from '../hooks/useMatureConsent'
import useIsMobile from '../hooks/useIsMobile'
import { useTitlePreference } from '../contexts/TitlePreferenceContext'
import PlayerControls from '../components/player/PlayerControls'
import PlayerStatusArea from '../components/player/PlayerStatusArea'
import QueueRail from '../components/player/QueueRail'
import QueueRailSkeleton from '../components/player/QueueRailSkeleton'
import EpisodeList from '../components/player/EpisodeList'
import EpisodeListSkeleton from '../components/player/EpisodeListSkeleton'
import EpisodeDrawer from '../components/player/EpisodeDrawer'
import SourceSelector from '../components/player/SourceSelector'
import { ProviderSelector } from '../components/player/SourceSelector'
import useVideoPlayer from '../hooks/useVideoPlayer'
import useAutoRotateFullscreen from '../hooks/useAutoRotateFullscreen'
import useAnime4K, { type Anime4KProfile } from '../hooks/useAnime4K'
import useDelayCanvas from '../hooks/useDelayCanvas'
import AvSyncCalibrator from '../components/player/AvSyncCalibrator'
import { usePlayerData } from '../hooks/usePlayerData'
import { useQueue, useRemoveFromQueue, useClearQueue, useReorderQueue } from '../hooks/useAnimeData'
import type { QueueItem } from '../hooks/useAnimeData'
import type { VideoLink, SubtitleTrack, VideoSource } from '../types/player'
import AnimeMetaDetails from '../components/anime/AnimeMetaDetails'
import SynopsisText from '../components/anime/SynopsisText'
import AnimePaheCookieModal from '../components/anime/AnimePaheCookieModal'
import QueueOptionsButton from '../components/anime/QueueOptionsButton'
import {
  getStoredFallbackAction,
  storeFallbackAction,
  type FallbackChoice,
} from '../lib/fallbackChoice'

import { useProviders } from '../hooks/useProviders'

const Player: React.FC = () => {
  const { id: showId, episodeNumber } = useParams<{ id: string; episodeNumber?: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const location = useLocation()
  const { hasConsent: hasMatureConsent, grant: grantMatureConsent } = useMatureConsent()
  const { options: providerOptions } = useProviders()
  const animeOptions = useMemo(
    () => providerOptions.filter((option) => (option.kind ?? 'anime') === 'anime'),
    [providerOptions]
  )
  const DIRECT_PROVIDER_ORDER: string[] = useMemo(
    () => animeOptions.map((option) => option.value),
    [animeOptions]
  )
  const MATURE_PROVIDERS = useMemo(
    () => new Set(animeOptions.filter((option) => option.mature).map((option) => option.value)),
    [animeOptions]
  )

  const {
    state,
    dispatch,
    toggleWatchlist,
    moveToCompleted,
    setPreferredSource,
    handleToggleDetails,
    markEpisodeWatched,
    prefetchEpisodeSources,
    isMarkingWatched,
    isUpdatingWatchlistStatus,
  } = usePlayerData(showId, episodeNumber, (location.state as Record<string, unknown>) || null, {
    hasMatureConsent,
  })

  useEffect(() => {
    if (showId && state.showMeta?.id && state.showMeta.id !== showId) {
      const url = episodeNumber
        ? `/watch/${state.showMeta.id}/${episodeNumber}${window.location.search}`
        : `/watch/${state.showMeta.id}${window.location.search}`
      navigate(url, { replace: true })
    }
  }, [showId, state.showMeta?.id, episodeNumber, navigate])

  const memoizedShowMeta = useMemo(() => {
    if (!state.showMeta.name) return undefined
    return {
      name: state.showMeta.name,
      thumbnail: state.showMeta.thumbnail,
      names: state.showMeta.names,
      genres: state.showMeta.genres,
      score: state.showMeta.score,
      isAdult: state.showMeta.isAdult,
    }
  }, [
    state.showMeta.name,
    state.showMeta.thumbnail,
    state.showMeta.names,
    state.showMeta.genres,
    state.showMeta.score,
    state.showMeta.isAdult,
  ])

  const player = useVideoPlayer({
    skipIntervals: state.skipIntervals,
    showId,
    episodeNumber: state.currentEpisode?.toString(),
    episodeCount: state.episodes.length || undefined,
    sourceType: state.selectedSource?.type,
    showMeta: memoizedShowMeta,
  })
  const { refs, actions } = player

  const hlsInstance = useRef<Hls | null>(null)
  const isMobile = useIsMobile()
  const episodeSidebarRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const subtitleOverlayRef = useRef<HTMLDivElement>(null)
  const seekToTimeRef = useRef<number>(0)
  const resumeTimeRef = useRef(state.resumeTime)
  const showResumeModalRef = useRef(state.showResumeModal)

  const [anime4kProfile, setAnime4kProfile] = useState<Anime4KProfile>(() => {
    try {
      const stored = localStorage.getItem('anime4kProfile')
      return (['low', 'balanced', 'high', 'denoise'] as const).includes(stored as Anime4KProfile)
        ? (stored as Anime4KProfile)
        : 'balanced'
    } catch {
      return 'balanced'
    }
  })

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
    actions.setShowSettings(false)
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
    const v = refs.videoRef.current
    if (v && !isNaN(v.currentTime)) calibReturnRef.current = v.currentTime
    setTestClipActive(true)
  }
  const effectiveVideoDelayMs = videoDelayEnabled ? videoDelayMs : 0
  const delayCanvasRef = useRef<HTMLCanvasElement>(null)

  const upscaler = useAnime4K({
    videoRef: refs.videoRef,
    canvasRef,
    profile: anime4kProfile,
    delayMs: effectiveVideoDelayMs,
  })

  const upscalerActive = upscaler.isEnabled && upscaler.isWebGPUSupported
  useDelayCanvas({
    videoRef: refs.videoRef,
    canvasRef: delayCanvasRef,
    delayMs: effectiveVideoDelayMs,
    enabled: videoDelayEnabled && !upscalerActive,
  })
  const delayCanvasActive = videoDelayEnabled && !upscalerActive
  const canvasPresentationActive = upscalerActive || delayCanvasActive

  useEffect(() => {
    resumeTimeRef.current = state.resumeTime
    showResumeModalRef.current = state.showResumeModal
  }, [state.resumeTime, state.showResumeModal])

  const [skipIndicator, _setSkipIndicator] = useState<{
    side: 'left' | 'right'
    visible: boolean
  } | null>(null)
  const [showNextEpisodePrompt, setShowNextEpisodePrompt] = useState(false)
  const [hasReachedEpisodeEnd, setHasReachedEpisodeEnd] = useState(false)
  const [isEpisodeDrawerOpen, setIsEpisodeDrawerOpen] = useState(false)
  const hasDismissedShowCompletedRef = useRef(false)
  const [queueCountdown, setQueueCountdown] = useState<number | null>(null)
  const hasAutoFallbackRef = useRef(false)
  const triedProvidersRef = useRef<string[]>([])
  const fallbackDismissedRef = useRef(false)
  const [fallbackPrompt, setFallbackPrompt] = useState<{ retryFailed: boolean } | null>(null)
  const [isRetryingProvider, setIsRetryingProvider] = useState(false)
  const [rememberFallbackChoice, setRememberFallbackChoice] = useState(false)
  const [fallbackChoice, setFallbackChoiceState] = useState<FallbackChoice>(
    () => getStoredFallbackAction() ?? 'ask'
  )
  const updateFallbackChoice = useCallback((value: FallbackChoice) => {
    setFallbackChoiceState(value)
    storeFallbackAction(value === 'ask' ? null : value)
  }, [])
  const fallbackChoiceRef = useRef(fallbackChoice)
  fallbackChoiceRef.current = fallbackChoice
  const videoSourcesRef = useRef(state.videoSources)
  videoSourcesRef.current = state.videoSources
  const handleVideoSourceErrorRef = useRef<() => void>(() => {})
  const [pendingQueueTransition, setPendingQueueTransition] = useState<{
    nextItem: QueueItem | null
    playedItem: QueueItem | null
  } | null>(null)
  const episodeParamRef = useRef(episodeNumber)

  useEffect(() => {
    if (episodeParamRef.current !== episodeNumber) {
      episodeParamRef.current = episodeNumber
      setPendingQueueTransition(null)
      setQueueCountdown(null)
      hasDismissedShowCompletedRef.current = false
      setTestClipActive(false)
      setIsCalibrating(false)
    }
  }, [episodeNumber])

  useEffect(() => {
    hasAutoFallbackRef.current = false
    triedProvidersRef.current = []
    fallbackDismissedRef.current = false
    setFallbackPrompt(null)
    setIsRetryingProvider(false)
  }, [showId, state.currentEpisode])

  useEffect(() => {
    if (!hasReachedEpisodeEnd) {
      hasDismissedShowCompletedRef.current = false
    }
  }, [hasReachedEpisodeEnd])
  const { data: queue = [], isLoading: isQueueLoading } = useQueue()
  const removeQueue = useRemoveFromQueue()
  const removeQueueRef = useRef(removeQueue)
  removeQueueRef.current = removeQueue
  const clearQueue = useClearQueue()
  const reorderQueue = useReorderQueue()
  const [isTheaterMode, setIsTheaterMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('playerTheaterMode') === 'true'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      if (isTheaterMode) {
        document.body.classList.add('theater-mode')
      } else {
        document.body.classList.remove('theater-mode')
      }
    } catch (e) {
      console.error(e)
    }
    return () => {
      try {
        document.body.classList.remove('theater-mode')
      } catch (e) {
        console.error(e)
      }
    }
  }, [isTheaterMode])

  useLayoutEffect(() => {
    if (player.state.isFullscreen || isTheaterMode) return

    const videoWrapper = refs.playerContainerRef.current
    const sidebar = episodeSidebarRef.current
    if (!videoWrapper || !sidebar) return

    const updateHeight = () => {
      const height = videoWrapper.getBoundingClientRect().height
      sidebar.style.height = `${height}px`
    }

    updateHeight()

    const observer = new ResizeObserver(updateHeight)
    observer.observe(videoWrapper)

    return () => observer.disconnect()
  }, [player.state.isFullscreen, isTheaterMode, refs.playerContainerRef])

  const currentEpisodeIndex = useMemo(
    () => state.episodes.findIndex((ep) => ep === state.currentEpisode),
    [state.episodes, state.currentEpisode]
  )
  const previousEpisode = currentEpisodeIndex > 0 ? state.episodes[currentEpisodeIndex - 1] : null
  const nextEpisode =
    currentEpisodeIndex >= 0 && currentEpisodeIndex < state.episodes.length - 1
      ? state.episodes[currentEpisodeIndex + 1]
      : null
  const hasNextEpisode = currentEpisodeIndex > -1 && currentEpisodeIndex < state.episodes.length - 1
  const isLastEpisode =
    state.episodes.length > 0 &&
    !!state.currentEpisode &&
    state.episodes[state.episodes.length - 1] === state.currentEpisode
  const normalizedShowStatus = String(state.showMeta.status || '')
    .trim()
    .toLowerCase()
  const isFinishedShow = ['finished', 'completed', 'complete', 'ended'].some((status) =>
    normalizedShowStatus.includes(status)
  )
  const isCompleted = isProgressCompleted(state.resumeTime, state.resumeDuration)
  const effectiveIsCompleted = isCompleted || hasReachedEpisodeEnd
  const isShowCompleted = isLastEpisode && isFinishedShow && effectiveIsCompleted
  const shouldShowModal = state.showResumeModal && (isShowCompleted || !effectiveIsCompleted)
  const isEpisodeCompleted = effectiveIsCompleted && !isShowCompleted
  const shouldShowNextEpisodeModal =
    isEpisodeCompleted &&
    queue.length === 0 &&
    !pendingQueueTransition &&
    (state.showResumeModal || hasReachedEpisodeEnd)
  const shouldPauseForModal = shouldShowModal || shouldShowNextEpisodeModal

  useAutoRotateFullscreen(player, !!state.selectedLink && !isTheaterMode && !shouldPauseForModal)

  useEffect(() => {
    const videoElement = refs.videoRef.current
    if (!videoElement) return

    let cancelled = false
    if (hlsInstance.current) {
      hlsInstance.current.destroy()
      hlsInstance.current = null
    }

    if (state.loadingVideo || state.selectedSource) {
      videoElement.pause()
      videoElement.removeAttribute('src')
      videoElement.load()
    }

    while (videoElement.firstChild) {
      videoElement.removeChild(videoElement.firstChild)
    }

    if (testClipActive) {
      videoElement.src = '/av-sync-test.mp4'
      videoElement.play().catch(() => {
        actions.setShowControls(true)
      })
      return () => {
        cancelled = true
      }
    }

    if (!state.selectedSource || !state.selectedLink) return

    if (state.selectedSource.type === 'iframe') {
      seekToTimeRef.current = 0
      return
    }

    if (calibReturnRef.current != null) {
      seekToTimeRef.current = calibReturnRef.current
      calibReturnRef.current = null
    } else if (resumeTimeRef.current > 5 && !showResumeModalRef.current) {
      seekToTimeRef.current = resumeTimeRef.current
    } else if (showResumeModalRef.current) {
      seekToTimeRef.current = 0
    }

    let proxiedUrl = state.selectedLink.link
    if (!proxiedUrl.startsWith('/api/proxy')) {
      proxiedUrl = `/api/proxy?url=${encodeURIComponent(proxiedUrl)}`
      if (state.selectedLink.headers?.Referer) {
        proxiedUrl += `&referer=${encodeURIComponent(state.selectedLink.headers.Referer)}`
      }
    }

    if (state.selectedSource.subtitles) {
      const subtitlesEnabled = localStorage.getItem('playerSubtitlesEnabled') !== 'false'
      let lastKey: string | null = null
      try {
        lastKey = localStorage.getItem('playerLastSubtitle')
      } catch {
        // ignore
      }
      const pickedIdx = pickSubtitleIndex(state.selectedSource.subtitles, {
        lastKey,
        enabled: subtitlesEnabled,
      })
      const pickedTrack = pickedIdx >= 0 ? state.selectedSource.subtitles[pickedIdx] : null
      state.selectedSource.subtitles.forEach((sub) => {
        const track = document.createElement('track')
        track.kind = 'subtitles'
        track.label = sub.label
        track.srclang = sub.lang

        const subSrc = sub.src ?? sub.url
        if (subSrc) {
          let subUrl = `/api/subtitle-proxy?url=${encodeURIComponent(subSrc)}`
          const linkReferer = state.selectedLink?.headers?.Referer
          const inferredReferer = subSrc.includes('anilight.live') ? 'https://anilight.live/' : ''
          const subReferer = linkReferer || inferredReferer
          if (subReferer) {
            subUrl += `&referer=${encodeURIComponent(subReferer)}`
          }
          track.src = subUrl
        }

        if (pickedTrack && sub.label === pickedTrack.label && sub.lang === pickedTrack.lang) {
          track.default = true
        }
        videoElement.appendChild(track)
      })
      if (!subtitlesEnabled) {
        actions.setActiveSubtitleTrack('off')
      }
      actions.setAvailableSubtitles(state.selectedSource.subtitles)
    }

    const targetTime = seekToTimeRef.current
    seekToTimeRef.current = 0

    const handleLoaded = () => {
      if (targetTime > 0) {
        videoElement.currentTime = targetTime
      }
    }
    videoElement.addEventListener('loadedmetadata', handleLoaded, { once: true })

    const shouldAutoPlay = !(showResumeModalRef.current && resumeTimeRef.current > 5)
    const playWhenReady = () => {
      if (shouldAutoPlay) {
        videoElement.play().catch(() => {
          actions.setShowControls(true)
        })
      }
    }

    if (state.selectedLink.hls) {
      void (async () => {
        const HlsClass = await loadHls()
        if (cancelled) return
        if (!HlsClass || !HlsClass.isSupported()) {
          videoElement.src = proxiedUrl
          playWhenReady()
          return
        }
        const isLowEnd = document.body.classList.contains('low-end')
        const hls = new HlsClass({
          maxBufferLength: isLowEnd ? 15 : 30,
          maxMaxBufferLength: isLowEnd ? 30 : 60,
          maxBufferSize: isLowEnd ? 25 * 1000 * 1000 : 60 * 1000 * 1000,
          startLevel: -1,
          enableWorker: true,
        })
        hlsInstance.current = hls
        hls.on(HlsClass.Events.ERROR, (_event, data) => {
          if (data.fatal && !hasAutoFallbackRef.current) {
            handleVideoSourceErrorRef.current()
          }
        })
        const hasManualSubs = (state.selectedSource?.subtitles?.length ?? 0) > 0
        const disableEmbeddedSubs = () => {
          try {
            if (
              hasManualSubs &&
              typeof hls.subtitleTrack === 'number' &&
              hls.subtitleTrack !== -1
            ) {
              hls.subtitleTrack = -1
            }
          } catch {
            // ignore
          }
        }
        hls.on(HlsClass.Events.SUBTITLE_TRACK_SWITCH, (_event, data) => {
          if (data?.id !== -1) disableEmbeddedSubs()
        })
        disableEmbeddedSubs()
        hls.loadSource(proxiedUrl)
        hls.attachMedia(videoElement)
        hls.once(HlsClass.Events.MANIFEST_PARSED, () => {
          if (!cancelled) playWhenReady()
        })
      })()
    } else {
      videoElement.src = proxiedUrl
      playWhenReady()
    }

    const savedVolume = localStorage.getItem('playerVolume')
    const savedMuted = localStorage.getItem('playerMuted')

    if (savedVolume !== null) {
      videoElement.volume = parseFloat(savedVolume)
    }
    if (savedMuted !== null) {
      videoElement.muted = savedMuted === 'true'
    }

    return () => {
      cancelled = true
      videoElement.removeEventListener('loadedmetadata', handleLoaded)
      if (hlsInstance.current) {
        hlsInstance.current.destroy()
        hlsInstance.current = null
      }
    }
  }, [
    state.selectedSource,
    state.selectedLink,
    refs.videoRef,
    actions,
    state.loadingVideo,
    testClipActive,
  ])

  const switchToIframeFallback = useCallback(
    (fallbackSource: VideoSource) => {
      if (hasAutoFallbackRef.current) return
      hasAutoFallbackRef.current = true
      const bestLink = fallbackSource.links[0]
      setPreferredSource(fallbackSource.sourceName)
      dispatch({
        type: 'SET_STATE',
        payload: { selectedSource: fallbackSource, selectedLink: bestLink },
      })
      setFallbackPrompt(null)
    },
    [dispatch, setPreferredSource]
  )

  const findIframeFallback = useCallback((): VideoSource | null => {
    const sources = videoSourcesRef.current
    const fallbackSource = sources.find((s) => s.type === 'iframe')
    return fallbackSource?.links?.length ? fallbackSource : null
  }, [])

  const runProviderRetry = useCallback(async () => {
    const isAdult = state.showMeta?.isAdult
    const ordered = DIRECT_PROVIDER_ORDER.filter((provider) => {
      if (triedProvidersRef.current.includes(provider)) return false
      const mature = MATURE_PROVIDERS.has(provider)
      if (isAdult === undefined) return true
      return mature === isAdult
    })
    setIsRetryingProvider(true)
    try {
      for (const provider of ordered) {
        triedProvidersRef.current.push(provider)
        let sources: VideoSource[] | null = null
        try {
          sources = (await fetchApi(
            `/api/video?showId=${showId}&episodeNumber=${state.currentEpisode}&mode=${state.currentMode}&provider=${provider}`
          )) as VideoSource[] | null
        } catch {
          continue
        }
        const pool = (sources ?? []).filter((s) => {
          const name = s.sourceName.toLowerCase()
          if (state.currentMode === 'dub') {
            return name.includes('eng') || name.includes('dub')
          }
          return (
            name.includes('jpn') ||
            name.includes('sub') ||
            (!name.includes('eng') && !name.includes('dub'))
          )
        })
        const withDirect = pool.length > 0 ? pool : (sources ?? [])
        const direct = withDirect.find((s) => s.type !== 'iframe' && s.links?.length)
        if (direct) {
          triedProvidersRef.current = [state.selectedProvider]
          fallbackDismissedRef.current = false
          dispatch({
            type: 'SET_STATE',
            payload: {
              selectedProvider: provider,
              videoSources: [],
              selectedSource: null,
              selectedLink: null,
              loadingVideo: true,
            },
          })
          localStorage.setItem('preferredProvider', provider)
          setFallbackPrompt(null)
          toast.success(`Switched to ${provider} (direct stream)`)
          return
        }
      }
      setFallbackPrompt({ retryFailed: true })
      toast.error('No working direct stream found on other providers')
    } finally {
      setIsRetryingProvider(false)
    }
  }, [
    showId,
    state.currentEpisode,
    state.currentMode,
    state.showMeta?.isAdult,
    state.selectedProvider,
    dispatch,
    DIRECT_PROVIDER_ORDER,
    MATURE_PROVIDERS,
  ])

  const handleVideoSourceError = useCallback(() => {
    if (hasAutoFallbackRef.current || fallbackDismissedRef.current) return
    if (state.selectedSource?.type !== 'player') return
    const fallbackSource = findIframeFallback()
    if (!fallbackSource) return

    if (!triedProvidersRef.current.includes(state.selectedProvider)) {
      triedProvidersRef.current.push(state.selectedProvider)
    }
    const choice = fallbackChoiceRef.current
    if (choice === 'iframe') {
      switchToIframeFallback(fallbackSource)
      return
    }
    if (choice === 'retry') {
      void runProviderRetry()
      return
    }
    actions.setShowControls(true)
    setFallbackPrompt({ retryFailed: false })
  }, [
    state.selectedSource,
    state.selectedProvider,
    findIframeFallback,
    switchToIframeFallback,
    runProviderRetry,
    actions,
  ])
  handleVideoSourceErrorRef.current = handleVideoSourceError

  const dismissFallbackPrompt = useCallback(() => {
    fallbackDismissedRef.current = true
    setFallbackPrompt(null)
    setRememberFallbackChoice(false)
  }, [])

  const chooseIframeFallback = useCallback(() => {
    if (rememberFallbackChoice) updateFallbackChoice('iframe')
    const fallbackSource = findIframeFallback()
    if (fallbackSource) switchToIframeFallback(fallbackSource)
    else setFallbackPrompt(null)
  }, [rememberFallbackChoice, updateFallbackChoice, findIframeFallback, switchToIframeFallback])

  const chooseProviderRetry = useCallback(() => {
    if (rememberFallbackChoice) updateFallbackChoice('retry')
    void runProviderRetry()
  }, [rememberFallbackChoice, updateFallbackChoice, runProviderRetry])

  const matchesQueueItem = (item: QueueItem, id: string | undefined, metaId: string | undefined) =>
    item.showId === id || (!!metaId && item.showId === metaId)

  const handlePlaybackFinished = useCallback(() => {
    actions.onEnded()

    const itemToRemove = queue.find(
      (item) =>
        matchesQueueItem(item, showId, state.showMeta?.id) &&
        item.episodeNumber === state.currentEpisode
    )

    if (queue.length > 0) {
      const activeQueueIndex = queue.findIndex(
        (item) =>
          matchesQueueItem(item, showId, state.showMeta?.id) &&
          item.episodeNumber === state.currentEpisode
      )

      const nextItem = activeQueueIndex >= 0 ? queue[activeQueueIndex + 1] || null : queue[0]

      setPendingQueueTransition({ nextItem, playedItem: itemToRemove || null })
      setQueueCountdown(2)
    } else if (itemToRemove) {
      removeQueueRef.current.mutate({
        showId: itemToRemove.showId,
        episodeNumber: itemToRemove.episodeNumber,
      })
    }

    let didAutoplayNavigate = false
    if (state.isAutoplayEnabled && queue.length === 0) {
      const currentIndex = state.episodes.findIndex((ep) => ep === state.currentEpisode)
      if (currentIndex > -1 && currentIndex < state.episodes.length - 1) {
        const nextEpisode = state.episodes[currentIndex + 1]
        queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
        navigate(`/watch/${showId}/${nextEpisode}`)
        didAutoplayNavigate = true
      }
    }

    if (
      !didAutoplayNavigate &&
      queue.length === 0 &&
      !pendingQueueTransition &&
      !hasDismissedShowCompletedRef.current
    ) {
      const isLast =
        state.episodes.length > 0 &&
        !!state.currentEpisode &&
        state.episodes[state.episodes.length - 1] === state.currentEpisode
      const normalized = String(state.showMeta.status || '')
        .trim()
        .toLowerCase()
      const finishedShow = ['finished', 'completed', 'complete', 'ended'].some((s) =>
        normalized.includes(s)
      )
      if (isLast && finishedShow) {
        dispatch({ type: 'SET_STATE', payload: { showResumeModal: true } })
      }
    }
  }, [
    actions,
    navigate,
    queue,
    showId,
    state.showMeta?.id,
    state.showMeta?.status,
    state.currentEpisode,
    state.episodes,
    state.isAutoplayEnabled,
    pendingQueueTransition,
    dispatch,
    queryClient,
  ])

  const handleQueueTransition = useCallback(() => {
    if (queue.length === 0) return

    actions.onEnded()

    const itemToRemove = queue.find(
      (item) =>
        matchesQueueItem(item, showId, state.showMeta?.id) &&
        item.episodeNumber === state.currentEpisode
    )
    const activeQueueIndex = queue.findIndex(
      (item) =>
        matchesQueueItem(item, showId, state.showMeta?.id) &&
        item.episodeNumber === state.currentEpisode
    )
    const nextItem = activeQueueIndex >= 0 ? queue[activeQueueIndex + 1] || null : queue[0]

    if (itemToRemove) {
      removeQueue.mutate({
        showId: itemToRemove.showId,
        episodeNumber: itemToRemove.episodeNumber,
      })
    }

    if (nextItem) {
      navigate(`/watch/${nextItem.showId}/${nextItem.episodeNumber}`)
    } else if (itemToRemove) {
      dispatch({ type: 'SET_STATE', payload: { showResumeModal: true } })
    }
  }, [
    actions,
    navigate,
    queue,
    removeQueue,
    showId,
    state.showMeta?.id,
    state.currentEpisode,
    dispatch,
  ])

  const handleNextEpisode = useCallback(() => {
    if (nextEpisode) {
      queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
      setHasReachedEpisodeEnd(false)
      navigate(`/watch/${showId}/${nextEpisode}`)
    }
    dispatch({ type: 'SET_STATE', payload: { showResumeModal: false } })
  }, [nextEpisode, navigate, showId, dispatch, queryClient])

  const handleNShortcut = useCallback(() => {
    if (queue.length > 0) {
      handleQueueTransition()
    } else if (nextEpisode) {
      handleNextEpisode()
    } else {
      toast.error('No next episode available')
    }
  }, [queue.length, handleQueueTransition, handleNextEpisode, nextEpisode])

  const handlePreviousEpisode = () => {
    if (previousEpisode) {
      navigate(`/watch/${showId}/${previousEpisode}`)
    }
  }

  useEffect(() => {
    const videoElement = refs.videoRef.current
    if (!videoElement) return
    const handleVideoEnd = () => {
      if (testClipActive) return
      handlePlaybackFinished()
    }
    videoElement.addEventListener('ended', handleVideoEnd)
    return () => {
      if (videoElement) {
        videoElement.removeEventListener('ended', handleVideoEnd)
      }
    }
  }, [handlePlaybackFinished, refs.videoRef, testClipActive])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (state.selectedSource?.type !== 'iframe') return
      if (event.data?.type !== 'ANI_WEB_MEDIA_ENDED') return

      handlePlaybackFinished()
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handlePlaybackFinished, state.selectedSource?.type])

  useEffect(() => {
    if (!pendingQueueTransition || queueCountdown === null) return

    if (queueCountdown <= 0) {
      const { nextItem, playedItem } = pendingQueueTransition
      setPendingQueueTransition(null)
      setQueueCountdown(null)

      if (playedItem) {
        removeQueueRef.current.mutate({
          showId: playedItem.showId,
          episodeNumber: playedItem.episodeNumber,
        })
      }

      if (nextItem) {
        navigate(`/watch/${nextItem.showId}/${nextItem.episodeNumber}`)
      } else if (playedItem) {
        dispatch({ type: 'SET_STATE', payload: { showResumeModal: true } })
      }
      return
    }

    const timer = window.setTimeout(() => {
      setQueueCountdown((value) => (value === null ? null : value - 1))
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [pendingQueueTransition, queueCountdown, navigate, dispatch])

  useEffect(() => {
    if (shouldPauseForModal && player.state.isFullscreen) {
      player.actions.toggleFullscreen()
    }
  }, [shouldPauseForModal, player.state.isFullscreen, player.actions])

  useEffect(() => {
    if (shouldPauseForModal && refs.videoRef.current) {
      refs.videoRef.current.pause()
    }
  }, [shouldPauseForModal, refs.videoRef])

  const { titlePreference } = useTitlePreference()
  const displayTitle = useMemo(() => {
    if (!state.showMeta || state.loadingShowData) return 'Loading...'
    const { name, names } = state.showMeta
    if (titlePreference === 'name') return name || 'Loading...'
    if (titlePreference === 'nativeName') return names?.native || name || 'Loading...'
    if (titlePreference === 'englishName') return names?.english || name || 'Loading...'
    return name || 'Loading...'
  }, [state.showMeta, titlePreference, state.loadingShowData])

  useEffect(() => {
    if (displayTitle && displayTitle !== 'Loading...' && state.currentEpisode) {
      document.title = `► ${displayTitle} Episode ${state.currentEpisode} - dango`
    }
  }, [displayTitle, state.currentEpisode])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target.closest(
          'input, textarea, button, select, a, [role="button"], [contenteditable="true"]'
        )
      )
        return

      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
        actions.setShowControls(true)
        if (player.actions.inactivityTimer.current) {
          clearTimeout(player.actions.inactivityTimer.current)
        }
        player.actions.inactivityTimer.current = window.setTimeout(() => {
          actions.setShowControls(false)
        }, 1000)
      }

      if (e.key.toLowerCase() === 'n') {
        handleNShortcut()
      }

      if (e.key.toLowerCase() === 't') {
        const newMode = !isTheaterMode
        setIsTheaterMode(newMode)
        localStorage.setItem('playerTheaterMode', newMode.toString())
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [actions, player.actions.inactivityTimer, handleNShortcut, isTheaterMode])

  const { setAvailableSubtitles, setActiveSubtitleTrack } = actions

  useEffect(() => {
    const videoElement = refs.videoRef.current
    if (!videoElement) return
    const handleTracksChange = () => {
      const tracks: SubtitleTrack[] = Array.from(videoElement.textTracks).map((t) => ({
        label: t.label,
        lang: t.language,
        src: undefined,
        mode: t.mode as 'showing' | 'hidden' | 'disabled',
      }))
      setAvailableSubtitles(tracks)
    }
    videoElement.textTracks.addEventListener('addtrack', handleTracksChange)
    videoElement.textTracks.addEventListener('removetrack', handleTracksChange)
    handleTracksChange()
    return () => {
      if (videoElement) {
        videoElement.textTracks.removeEventListener('addtrack', handleTracksChange)
        videoElement.textTracks.removeEventListener('removetrack', handleTracksChange)
      }
    }
  }, [refs.videoRef, setAvailableSubtitles])

  useEffect(() => {
    if (
      player.state.activeSubtitleTrack === null &&
      player.state.availableSubtitles.length > 0 &&
      localStorage.getItem('playerSubtitlesEnabled') !== 'false'
    ) {
      let lastKey: string | null = null
      try {
        lastKey = localStorage.getItem('playerLastSubtitle')
      } catch {
        // ignore
      }
      const idx = pickSubtitleIndex(player.state.availableSubtitles, {
        lastKey,
        enabled: true,
      })
      if (idx < 0) {
        setActiveSubtitleTrack('off')
        return
      }
      const trackToActivate = player.state.availableSubtitles[idx]
      setActiveSubtitleTrack(trackToActivate.lang || trackToActivate.label)
    }
  }, [player.state.activeSubtitleTrack, player.state.availableSubtitles, setActiveSubtitleTrack])

  useEffect(() => {
    const video = refs.videoRef.current
    if (!video || player.state.availableSubtitles.length === 0) return
    const active = player.state.activeSubtitleTrack
    const enabled = localStorage.getItem('playerSubtitlesEnabled') !== 'false'
    if (!enabled || active === 'off' || active === null) {
      Array.from(video.textTracks).forEach((t) => {
        t.mode = 'hidden'
      })
      return
    }
    let matched = false
    Array.from(video.textTracks).forEach((t) => {
      const isMatch = t.language === active || t.label === active
      const shouldShow = isMatch && !matched
      t.mode = shouldShow ? 'showing' : 'hidden'
      if (shouldShow) matched = true
    })
    if (!matched && video.textTracks.length > 0) {
      const fallback =
        Array.from(video.textTracks).find((t) => t.language === 'en' || t.label === 'English') ||
        video.textTracks[0]
      if (fallback) fallback.mode = 'showing'
    }
  }, [player.state.activeSubtitleTrack, player.state.availableSubtitles, refs.videoRef])

  const [videoBoxH, setVideoBoxH] = useState(0)

  useEffect(() => {
    const video = refs.videoRef.current
    if (!video) return
    const update = () => setVideoBoxH(video.clientHeight || 0)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(video)
    return () => observer.disconnect()
  }, [refs.videoRef, state.selectedSource, state.selectedLink])

  useEffect(() => {
    const styleId = 'dynamic-subtitle-styles'
    let styleTag = document.getElementById(styleId)
    if (!styleTag) {
      styleTag = document.createElement('style')
      styleTag.id = styleId
      document.head.appendChild(styleTag)
    }

    const subtitleStyle: SubtitleStyleSettings = {
      fontSize: player.state.subtitleFontSize,
      position: player.state.subtitlePosition,
      bgOpacity: player.state.subtitleBgOpacity,
      bgColor: player.state.subtitleBgColor,
      textColor: player.state.subtitleTextColor,
      edge: player.state.subtitleEdge,
      bold: player.state.subtitleBold,
    }

    styleTag.textContent = buildCueCss(subtitleStyle)

    const video = refs.videoRef.current
    if (!video) return
    const fittedSize = fitSubtitleSize(
      player.state.subtitleFontSize,
      videoBoxH || video.clientHeight || 720
    )
    styleTag.textContent = buildCueCss({ ...subtitleStyle, fontSize: fittedSize })

    const getPos = () => {
      const raw = Number(player.state.subtitlePosition)
      const lift = isNaN(raw) ? 0 : Math.max(0, Math.min(100, raw))
      return Math.max(0, Math.min(100, 100 - lift))
    }

    const setCueLine = (cue: unknown, line: number) => {
      try {
        const vttCue = cue as { snapToLines?: boolean; line?: number }
        vttCue.snapToLines = false
        vttCue.line = line
      } catch {
        // ignore
      }
    }

    const cueMetrics = () => {
      const px = fittedSize * 16
      const h = video.videoHeight || video.clientHeight || 720
      const w = video.videoWidth || video.clientWidth || 1280
      return { step: ((px * 1.3) / h) * 100, chars: Math.max(20, Math.floor(w / (px * 0.55))) }
    }

    const restackTrack = (track: TextTrack) => {
      const pos = getPos()
      const active = Array.from(track.activeCues ?? [])
      if (active.length <= 1) {
        active.forEach((cue) => setCueLine(cue, pos))
        return
      }
      const { step, chars } = cueMetrics()
      let bottom = pos
      for (let i = active.length - 1; i >= 0; i--) {
        const text = String((active[i] as { text?: unknown }).text ?? '').replace(/<[^>]*>/g, '')
        const visual = text
          .split('\n')
          .reduce((n, seg) => n + Math.max(1, Math.ceil(seg.length / chars)), 0)
        const top = bottom - visual * step
        setCueLine(active[i], Math.max(0, top))
        bottom = top - step * 0.4
      }
    }

    const applyToTrack = (track: TextTrack) => {
      if (!track.cues) return
      const pos = getPos()
      Array.from(track.cues).forEach((cue: unknown) => setCueLine(cue, pos))
      if (track.mode === 'showing') restackTrack(track)
    }

    const applyToAllTracks = () => {
      Array.from(video.textTracks).forEach(applyToTrack)
    }

    applyToAllTracks()

    const handleCueChange = (e: Event) => {
      const track = e.target as TextTrack
      if (track.mode === 'showing') restackTrack(track)
    }

    Array.from(video.textTracks).forEach((t) => {
      t.addEventListener('cuechange', handleCueChange)
    })

    const handleAddTrack = () => {
      Array.from(video.textTracks).forEach((t) => {
        t.removeEventListener('cuechange', handleCueChange)
        t.addEventListener('cuechange', handleCueChange)
      })
      applyToAllTracks()
    }
    video.textTracks.addEventListener('addtrack', handleAddTrack)
    video.textTracks.addEventListener('removetrack', handleAddTrack)

    const trackElements = Array.from(video.querySelectorAll('track'))
    const handleTrackLoad = () => {
      applyToAllTracks()
    }
    trackElements.forEach((el) => {
      el.addEventListener('load', handleTrackLoad)
    })

    return () => {
      Array.from(video.textTracks).forEach((t) => {
        t.removeEventListener('cuechange', handleCueChange)
      })
      video.textTracks.removeEventListener('addtrack', handleAddTrack)
      video.textTracks.removeEventListener('removetrack', handleAddTrack)
      trackElements.forEach((el) => {
        el.removeEventListener('load', handleTrackLoad)
      })
    }
  }, [
    player.state.subtitleFontSize,
    player.state.subtitlePosition,
    player.state.subtitleBgOpacity,
    player.state.subtitleBgColor,
    player.state.subtitleTextColor,
    player.state.subtitleEdge,
    player.state.subtitleBold,
    player.state.activeSubtitleTrack,
    player.state.availableSubtitles,
    state.selectedSource,
    state.selectedLink,
    refs.videoRef,
    videoBoxH,
  ])

  useEffect(() => {
    if (!canvasPresentationActive) return
    const video = refs.videoRef.current
    const overlay = subtitleOverlayRef.current
    if (!video || !overlay) return

    const enabled = localStorage.getItem('playerSubtitlesEnabled') !== 'false'
    const activeTrackLabel = player.state.activeSubtitleTrack

    function renderCues() {
      overlay.innerHTML = ''
      if (!enabled || activeTrackLabel === 'off' || activeTrackLabel === null) return

      const track = Array.from(video.textTracks).find(
        (t) => t.language === activeTrackLabel || t.label === activeTrackLabel
      )
      if (!track || track.mode !== 'showing') return

      const delaySec = effectiveVideoDelayMs / 1000
      let cues: ArrayLike<TextTrackCue> | TextTrackCue[]
      if (delaySec > 0 && track.cues) {
        const t = video.currentTime - delaySec
        cues = Array.from(track.cues).filter((c) => c.startTime <= t && t <= c.endTime)
      } else {
        cues = Array.from(track.activeCues ?? [])
      }
      if (cues.length === 0) return

      const subtitleStyle: SubtitleStyleSettings = {
        fontSize: fitSubtitleSize(player.state.subtitleFontSize, video.clientHeight || 0),
        position: player.state.subtitlePosition,
        bgOpacity: player.state.subtitleBgOpacity,
        bgColor: player.state.subtitleBgColor,
        textColor: player.state.subtitleTextColor,
        edge: player.state.subtitleEdge,
        bold: player.state.subtitleBold,
      }
      const baseCss = buildOverlayCss(subtitleStyle)
      const baseBottomPx = subtitleBottomPx(video, subtitleStyle.position)
      const cueArray = Array.from(cues as ArrayLike<TextTrackCue>)

      cueArray.forEach((cue, index) => {
        const raw = String((cue as { text?: unknown }).text ?? '')
        if (!stripCueTags(raw).trim()) return
        const div = document.createElement('div')
        const stackOffset = (cueArray.length - 1 - index) * 1.7
        div.style.cssText = `${baseCss}\nbottom: calc(${baseBottomPx}px + ${stackOffset}em);`
        div.innerHTML = renderCueHtml(raw)
        overlay.appendChild(div)
      })
    }

    const handleCueChange = () => renderCues()
    const handleTimeUpdate = () => renderCues()

    Array.from(video.textTracks).forEach((t) => {
      t.addEventListener('cuechange', handleCueChange)
    })
    video.addEventListener('timeupdate', handleTimeUpdate)
    renderCues()

    return () => {
      Array.from(video.textTracks).forEach((t) => {
        t.removeEventListener('cuechange', handleCueChange)
      })
      video.removeEventListener('timeupdate', handleTimeUpdate)
      overlay.innerHTML = ''
    }
  }, [
    upscaler.isEnabled,
    upscaler.isWebGPUSupported,
    player.state.subtitleFontSize,
    player.state.subtitlePosition,
    player.state.subtitleBgOpacity,
    player.state.subtitleBgColor,
    player.state.subtitleTextColor,
    player.state.subtitleEdge,
    player.state.subtitleBold,
    player.state.activeSubtitleTrack,
    refs.videoRef,
    canvasPresentationActive,
    effectiveVideoDelayMs,
  ])

  useEffect(() => {
    try {
      localStorage.setItem('anime4kProfile', anime4kProfile)
    } catch {
      // ignore
    }
  }, [anime4kProfile])

  const handleResume = () => {
    if (refs.videoRef.current) {
      refs.videoRef.current.currentTime = state.resumeTime
      refs.videoRef.current.play()
    }
    dispatch({ type: 'SET_STATE', payload: { showResumeModal: false } })
  }

  const handleStartOver = () => {
    if (refs.videoRef.current) {
      refs.videoRef.current.currentTime = 0
      refs.videoRef.current.play()
    }
    dispatch({ type: 'SET_STATE', payload: { showResumeModal: false } })
  }

  const handleCloseModal = useCallback(() => {
    if (isShowCompleted) {
      hasDismissedShowCompletedRef.current = true
    }
    if (shouldShowNextEpisodeModal) {
      setHasReachedEpisodeEnd(false)
    }
    dispatch({ type: 'SET_STATE', payload: { showResumeModal: false } })
  }, [dispatch, isShowCompleted, shouldShowNextEpisodeModal])

  const handleReplayCompleted = useCallback(() => {
    setHasReachedEpisodeEnd(false)
    if (refs.videoRef.current) {
      try {
        refs.videoRef.current.currentTime = 0
        void refs.videoRef.current.play().catch(() => {})
      } catch {
        // ignore
      }
    }
    dispatch({ type: 'SET_STATE', payload: { showResumeModal: false } })
  }, [dispatch, refs])

  const handleMoveToCompletedAndNavigate = useCallback(async () => {
    try {
      await moveToCompleted()
      dispatch({ type: 'SET_STATE', payload: { showResumeModal: false } })
      navigate('/')
    } catch {
      // ignore
    }
  }, [moveToCompleted, dispatch, navigate])

  const episodeNavControls = (className: string, variant: 'desktop' | 'mobile') => (
    <div className={className}>
      <button
        className={`${styles.episodeNavBtn} ${styles.secondary}`}
        onClick={handlePreviousEpisode}
        disabled={!previousEpisode}
        type="button"
      >
        <Icon name="chevron-left" size={12} />
        Prev EP
      </button>
      <button
        className={`${styles.episodeNavBtn} ${styles.primary}`}
        onClick={handleNextEpisode}
        disabled={!nextEpisode}
        type="button"
      >
        Next EP
        <Icon name="chevron-right" size={12} />
      </button>
      {variant === 'mobile' && isMobile && (
        <button
          className={`${styles.episodeNavBtn} ${styles.episodePickerBtn}`}
          onClick={() => setIsEpisodeDrawerOpen(true)}
          type="button"
        >
          <Icon name="list-ul" size={12} />
          Episodes
        </button>
      )}
    </div>
  )

  useEffect(() => {
    if (!hasReachedEpisodeEnd) return
    if (state.showResumeModal) return
    if (queue.length > 0) return
    if (pendingQueueTransition) return
    if (hasDismissedShowCompletedRef.current) return
    if (isShowCompleted) {
      dispatch({ type: 'SET_STATE', payload: { showResumeModal: true } })
    }
  }, [
    hasReachedEpisodeEnd,
    isShowCompleted,
    state.showResumeModal,
    queue.length,
    pendingQueueTransition,
    dispatch,
  ])

  const handleAutoplayChange = (checked: boolean) => {
    dispatch({ type: 'SET_STATE', payload: { isAutoplayEnabled: checked } })
    storeAutoplayEnabled(checked)
  }

  const isCurrentEpisodeWatched = !!(
    state.currentEpisode && state.watchedEpisodes.includes(state.currentEpisode)
  )

  const showManualWatchedButton =
    state.selectedProvider !== 'megaplay' || state.selectedSource?.type === 'iframe'
  const prefetchNextEpisodeRef = useRef(prefetchEpisodeSources)
  prefetchNextEpisodeRef.current = prefetchEpisodeSources
  const prefetchedForRef = useRef<string>('')

  useEffect(() => {
    const videoElement = refs.videoRef.current

    setShowNextEpisodePrompt(false)
    setHasReachedEpisodeEnd(false)

    if (!videoElement || state.selectedSource?.type === 'iframe') return

    const handleThresholds = () => {
      const duration = videoElement.duration
      const currentTime = videoElement.currentTime

      if (!duration || Number.isNaN(duration)) {
        setShowNextEpisodePrompt(false)
        setHasReachedEpisodeEnd(false)
        return
      }

      const progress = currentTime / duration

      if (duration - currentTime <= 60) {
        const activeQueueIndex = queue.findIndex(
          (item) =>
            matchesQueueItem(item, showId, state.showMeta?.id) &&
            item.episodeNumber === state.currentEpisode
        )
        const nextQueueItem =
          queue.length > 0
            ? activeQueueIndex >= 0
              ? queue[activeQueueIndex + 1] || null
              : queue[0]
            : null

        const prefetchKey = nextQueueItem
          ? `${nextQueueItem.showId}:${nextQueueItem.episodeNumber}`
          : hasNextEpisode
            ? `${showId}:${nextEpisode}`
            : ''

        if (prefetchKey && prefetchedForRef.current !== prefetchKey) {
          prefetchedForRef.current = prefetchKey
          if (nextQueueItem) {
            prefetchNextEpisodeRef.current(nextQueueItem.episodeNumber, nextQueueItem.showId)
          } else {
            prefetchNextEpisodeRef.current(nextEpisode)
          }
        }
      }

      setShowNextEpisodePrompt(hasNextEpisode && progress >= 0.8)
      setHasReachedEpisodeEnd(currentTime >= Math.max(duration * 0.98, duration - 10))
    }

    handleThresholds()
    videoElement.addEventListener('timeupdate', handleThresholds)
    videoElement.addEventListener('loadedmetadata', handleThresholds)

    return () => {
      videoElement.removeEventListener('timeupdate', handleThresholds)
      videoElement.removeEventListener('loadedmetadata', handleThresholds)
    }
  }, [
    refs.videoRef,
    hasNextEpisode,
    state.currentEpisode,
    state.selectedSource,
    nextEpisode,
    showId,
    queue,
    state.showMeta?.id,
  ])

  const handleMarkEpisodeWatched = useCallback(async () => {
    if (!showId || !state.currentEpisode || !state.showMeta.name || isMarkingWatched) return

    const videoDuration = refs.videoRef.current?.duration
    const fallbackDuration = Math.max(
      videoDuration || 0,
      state.resumeDuration || 0,
      (state.showMeta.lengthMin || 0) * 60,
      1
    )

    await markEpisodeWatched(state.currentEpisode, fallbackDuration)
  }, [
    showId,
    state.currentEpisode,
    state.showMeta,
    state.resumeDuration,
    markEpisodeWatched,
    isMarkingWatched,
    refs.videoRef,
  ])

  if (
    state.error &&
    !state.showMeta.name &&
    state.videoSources.length === 0 &&
    state.episodes.length === 0
  )
    return <p className="error-message">Error: {state.error}</p>

  const isVideoLoading = state.loadingShowData || state.loadingVideo

  const handleLayoutClick = (e: React.MouseEvent) => {
    if (isTheaterMode && e.target === e.currentTarget) {
      setIsTheaterMode(false)
      localStorage.setItem('playerTheaterMode', 'false')
    }
  }

  const matureBlocked = state.showMeta?.isAdult === true && !hasMatureConsent

  if (matureBlocked) {
    return (
      <div className={layoutStyles.playerPageLayout}>
        <Modal isOpen title="Content Warning" onClose={() => navigate('/home')}>
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
              <Button variant="secondary" onClick={() => navigate('/home')}>
                Go Back
              </Button>
              <Button onClick={grantMatureConsent}>I'm 18+, Continue</Button>
            </div>
          </div>
        </Modal>
      </div>
    )
  }

  return (
    <div
      className={`${layoutStyles.playerPageLayout} ${isTheaterMode ? layoutStyles.theaterMode : ''}`}
      onClick={handleLayoutClick}
    >
      <Modal
        isOpen={shouldShowModal}
        onClose={handleCloseModal}
        title={isShowCompleted ? 'Show Completed!' : 'Resume Playback?'}
        width="sm"
      >
        {isShowCompleted ? (
          <>
            <Modal.Body>
              <p>Congratulations! You&apos;ve finished the final episode of this series.</p>
            </Modal.Body>
            <Modal.Actions>
              <Button
                onClick={handleMoveToCompletedAndNavigate}
                disabled={isUpdatingWatchlistStatus}
              >
                {isUpdatingWatchlistStatus ? 'Saving...' : 'Move to Completed'}
              </Button>
            </Modal.Actions>
          </>
        ) : (
          <>
            <Modal.Body>
              <p>
                You were watching at <strong>{player.actions.formatTime(state.resumeTime)}</strong>.
                Would you like to continue?
              </p>
            </Modal.Body>
            <Modal.Actions>
              <Button variant="secondary" onClick={handleStartOver}>
                Start Over
              </Button>
              <Button onClick={handleResume}>Resume</Button>
            </Modal.Actions>
          </>
        )}
      </Modal>

      <Modal
        isOpen={shouldShowNextEpisodeModal}
        onClose={handleCloseModal}
        title="Episode Completed"
        width="sm"
      >
        <Modal.Body>
          <p>
            You&apos;ve already watched Episode <strong>{state.currentEpisode}</strong>.
            {nextEpisode ? ' Would you like to watch the next episode?' : ''}
          </p>
        </Modal.Body>
        <Modal.Actions>
          <Button variant="secondary" onClick={handleReplayCompleted}>
            Replay
          </Button>
          {nextEpisode && <Button onClick={handleNextEpisode}>{`Watch EP ${nextEpisode}`}</Button>}
        </Modal.Actions>
      </Modal>

      <Modal
        isOpen={!!fallbackPrompt}
        onClose={dismissFallbackPrompt}
        title="Direct stream failed"
        width="sm"
      >
        <Modal.Body>
          <p>
            <strong>{state.selectedProvider}</strong>&apos;s direct stream failed for this episode.
          </p>
          {fallbackPrompt?.retryFailed && (
            <p>No working direct stream was found on the other providers either.</p>
          )}
          <p>
            You can continue with the embedded (iframe) player, but embedded players may show{' '}
            <strong>ads and pop-ups</strong>.
          </p>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '0.75rem',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={rememberFallbackChoice}
              onChange={(e) => setRememberFallbackChoice(e.target.checked)}
            />
            Remember my choice
          </label>
        </Modal.Body>
        <Modal.Actions>
          <Button variant="secondary" onClick={chooseIframeFallback}>
            Continue with iframe
          </Button>
          <Button onClick={chooseProviderRetry} disabled={isRetryingProvider}>
            {isRetryingProvider ? 'Searching…' : 'Try another provider'}
          </Button>
        </Modal.Actions>
      </Modal>

      <AnimePaheCookieModal
        isOpen={!!state.showCookieModal}
        onClose={() => dispatch({ type: 'SET_STATE', payload: { showCookieModal: false } })}
        onSuccess={() => {
          queryClient.invalidateQueries({
            queryKey: [
              'video-sources',
              showId,
              state.currentEpisode,
              state.selectedProvider,
              state.currentMode,
            ],
          })
        }}
      />

      {!isTheaterMode && (
        <aside ref={episodeSidebarRef} className={layoutStyles.episodeSidebar}>
          {state.loadingShowData ? (
            <EpisodeListSkeleton variant="sidebar" />
          ) : (
            <EpisodeList
              episodes={state.episodes}
              currentEpisode={state.currentEpisode}
              watchedEpisodes={state.watchedEpisodes}
              onEpisodeClick={(ep) => navigate(`/watch/${showId}/${ep}`)}
            />
          )}
        </aside>
      )}

      <div className={layoutStyles.playerMain}>
        <div
          className={`${styles.videoContainer} ${!player.state.isFullscreen ? layoutStyles.videoPlayerWrapper : ''} ${player.state.isFullscreen ? styles.fullscreenActive : ''}`}
          style={{
            ...(shouldPauseForModal ? { visibility: 'hidden' } : {}),
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <PlayerControls
            player={player}
            isAutoplayEnabled={state.isAutoplayEnabled}
            onAutoplayChange={handleAutoplayChange}
            fallbackChoice={fallbackChoice}
            onFallbackChoiceChange={updateFallbackChoice}
            showNextEpisodeButton={
              !shouldPauseForModal && showNextEpisodePrompt && queue.length === 0
            }
            onNextEpisode={handleNextEpisode}
            videoSources={state.videoSources}
            selectedSource={state.selectedSource}
            selectedLink={state.selectedLink}
            onSourceChange={(source, link) => {
              if (refs.videoRef.current && !isNaN(refs.videoRef.current.currentTime)) {
                seekToTimeRef.current = refs.videoRef.current.currentTime
              }

              setPreferredSource(source.sourceName)
              dispatch({
                type: 'SET_STATE',
                payload: {
                  selectedSource: source,
                  selectedLink: link,
                  showResumeModal: state.showResumeModal && source.type !== 'iframe',
                },
              })
            }}
            loadingVideo={state.loadingVideo}
            skipIntervals={state.skipIntervals}
            animeTitle={displayTitle}
            episodeNumber={state.currentEpisode}
            isTheaterMode={isTheaterMode}
            onTheaterModeToggle={() => {
              const newMode = !isTheaterMode
              setIsTheaterMode(newMode)
              localStorage.setItem('playerTheaterMode', newMode.toString())
            }}
            anime4kEnabled={upscaler.isEnabled}
            onAnime4kToggle={upscaler.toggle}
            anime4kSupported={upscaler.isWebGPUSupported}
            anime4kProfile={anime4kProfile}
            onAnime4kProfileChange={setAnime4kProfile}
            anime4kInitializing={upscaler.isInitializing}
            anime4kError={upscaler.error}
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
            isInteractingExtra={isEpisodeDrawerOpen || isCalibrating}
            className={shellStyles.shellFill}
            hideChrome={state.selectedSource?.type === 'iframe'}
            overlays={
              <>
                {player.state.isSpeedBoostActive && (
                  <div className={styles.speedBoostBadge} aria-hidden="true">
                    <span>2x</span>
                    <Icon name="forward" size={12} />
                  </div>
                )}
                {queueCountdown !== null && pendingQueueTransition?.nextItem && (
                  <div className={styles.queueCountdown}>Queue next in {queueCountdown}s</div>
                )}
              </>
            }
          >
            {skipIndicator && (
              <div
                className={`${styles.skipIndicatorContainer} ${skipIndicator.side === 'left' ? styles.leftSkip : styles.rightSkip} `}
              >
                <div className={styles.skipBubble}>
                  <div className={styles.skipIcon}>
                    {skipIndicator.side === 'left' ? (
                      <Icon name="backward" />
                    ) : (
                      <Icon name="forward" />
                    )}
                  </div>
                  <div className={styles.skipText}>15s</div>
                </div>
              </div>
            )}

            {isVideoLoading && (
              <div className={styles.loadingOverlay}>
                <div className={styles.loadingDots}>
                  <div className={styles.dot}></div>
                  <div className={styles.dot}></div>
                  <div className={styles.dot}></div>
                </div>
              </div>
            )}

            {player.state.isBuffering &&
              !isVideoLoading &&
              state.selectedSource?.type !== 'iframe' && (
                <div className={styles.bufferingOverlay}>
                  <div className={styles.bufferingSpinner}></div>
                </div>
              )}

            {state.selectedSource?.type === 'iframe' ? (
              !isVideoLoading && (
                <iframe
                  src={state.selectedLink?.link}
                  className={styles.videoIframe}
                  allow="autoplay; fullscreen; picture-in-picture"
                  allowFullScreen
                  sandbox={
                    state.selectedSource.sandbox
                      ? `${state.selectedSource.sandbox} allow-fullscreen allow-popups allow-popups-to-escape-sandbox`
                      : undefined
                  }
                ></iframe>
              )
            ) : (
              <>
                {!isVideoLoading && state.videoSources.length === 0 && (
                  <div className={styles.errorOverlay}>
                    <p>No sources found for this episode with {state.selectedProvider}.</p>
                    <p className={styles.errorSubtext}>
                      Please try selecting a different provider below.
                    </p>
                    <button
                      className={styles.retryButton}
                      onClick={() => window.location.reload()}
                      data-speed-boost-ignore="true"
                      style={{ marginTop: 8 }}
                    >
                      Retry
                    </button>
                  </div>
                )}
                {!isVideoLoading && state.videoSources.length > 0 && (
                  <video
                    ref={refs.videoRef}
                    controls={player.state.useNativeControls}
                    playsInline
                    webkit-playsinline="true"
                    disablePictureInPicture
                    disableRemotePlayback
                    onPlay={actions.onPlay}
                    onPause={actions.onPause}
                    onLoadedMetadata={actions.onLoadedMetadata}
                    onTimeUpdate={() => {
                      if (testClipActive) return
                      actions.onTimeUpdate()
                      if (
                        pendingQueueTransition &&
                        refs.videoRef.current &&
                        refs.videoRef.current.currentTime < refs.videoRef.current.duration - 1
                      ) {
                        setPendingQueueTransition(null)
                        setQueueCountdown(null)
                      }
                    }}
                    onProgress={actions.onProgress}
                    onVolumeChange={actions.onVolumeChange}
                    onWaiting={actions.onWaiting}
                    onPlaying={actions.onPlaying}
                    onError={handleVideoSourceError}
                    onContextMenu={(e) => e.preventDefault()}
                    className={canvasPresentationActive ? styles.videoElementHidden : ''}
                  />
                )}
                {upscaler.isWebGPUSupported && !isVideoLoading && state.videoSources.length > 0 && (
                  <canvas
                    ref={canvasRef}
                    className={`${styles.upscalerCanvas} ${upscalerActive ? styles.upscalerActive : ''}`}
                  />
                )}
                {!upscalerActive && !isVideoLoading && state.videoSources.length > 0 && (
                  <canvas
                    ref={delayCanvasRef}
                    className={`${styles.upscalerCanvas} ${delayCanvasActive ? styles.upscalerActive : ''}`}
                  />
                )}
                {upscaler.isEnabled && upscaler.isWebGPUSupported && upscaler.isInitializing && (
                  <div className={styles.upscalerStatusBadge}>Preparing upscaler…</div>
                )}
                {canvasPresentationActive && (
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
              </>
            )}
          </PlayerControls>
        </div>

        {!isTheaterMode && <PlayerStatusArea />}

        {!isTheaterMode && (
          <>
            {isQueueLoading && queue.length === 0 ? (
              <QueueRailSkeleton count={3} />
            ) : (
              <QueueRail
                title="Queue"
                items={queue}
                currentShowId={showId}
                currentEpisode={state.currentEpisode}
                onNextQueue={handleQueueTransition}
                onRemove={(item) =>
                  removeQueue.mutate({
                    showId: item.showId,
                    episodeNumber: item.episodeNumber,
                  })
                }
                onClear={() => clearQueue.mutate()}
                showClearAll
                onReorder={(items) =>
                  reorderQueue.mutate(
                    items.map((item) => ({
                      id: item.id,
                      showId: item.showId,
                      episodeNumber: item.episodeNumber,
                    }))
                  )
                }
              />
            )}

            <div className={styles.providerAndEpisodeRow}>
              <ProviderSelector
                selectedProvider={state.selectedProvider}
                isAdult={state.showMeta?.isAdult}
                options={animeOptions}
                onProviderChange={(newProvider) => {
                  hasAutoFallbackRef.current = false
                  triedProvidersRef.current = []
                  fallbackDismissedRef.current = false
                  setFallbackPrompt(null)
                  dispatch({
                    type: 'SET_STATE',
                    payload: {
                      selectedProvider: newProvider,
                      videoSources: [],
                      selectedSource: null,
                      selectedLink: null,
                      loadingVideo: true,
                    },
                  })
                  localStorage.setItem('preferredProvider', newProvider)
                }}
              />
              {episodeNavControls(
                `${styles.episodeActions} ${styles.desktopEpisodeActions}`,
                'desktop'
              )}
            </div>

            {isVideoLoading ? (
              <div className={styles.sourceLoader}>
                <div className={styles.spinner}></div>
              </div>
            ) : (
              <>
                <SourceSelector
                  videoSources={state.videoSources}
                  selectedSource={state.selectedSource}
                  selectedLink={state.selectedLink}
                  onSourceChange={(source) => {
                    if (refs.videoRef.current && !isNaN(refs.videoRef.current.currentTime)) {
                      seekToTimeRef.current = refs.videoRef.current.currentTime
                    }

                    const links = source.links || []
                    const bestLink =
                      links.sort(
                        (a: VideoLink, b: VideoLink) =>
                          (parseInt(b.resolutionStr) || 0) - (parseInt(a.resolutionStr) || 0)
                      )[0] || null

                    setPreferredSource(source.sourceName)
                    dispatch({
                      type: 'SET_STATE',
                      payload: {
                        selectedSource: source,
                        selectedLink: bestLink,
                        showResumeModal: state.showResumeModal && source.type !== 'iframe',
                      },
                    })
                  }}
                  onLinkChange={(link) => {
                    if (!state.selectedSource) return
                    setPreferredSource(state.selectedSource.sourceName)
                    dispatch({
                      type: 'SET_STATE',
                      payload: { selectedLink: link },
                    })
                  }}
                />
              </>
            )}

            <div className={layoutStyles.playerInfoContainer}>
              <div className={layoutStyles.playerInfoHeader}>
                <div className={layoutStyles.playerAnimeCard}>
                  <img
                    src={fixThumbnailUrl(state.showMeta.thumbnail || '')}
                    alt={displayTitle}
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).src = '/placeholder.svg'
                    }}
                  />
                </div>
                <div className={layoutStyles.videoTitleSection}>
                  <div className={styles.titleContainer}>
                    <h1>{displayTitle}</h1>
                    <div className={styles.scheduleInfo}>
                      {state.showMeta.status && (
                        <span className={styles.status}>{state.showMeta.status}</span>
                      )}
                      {state.showMeta.nextEpisodeAirDate && (
                        <span className={styles.nextEpisode}>
                          Next episode: {state.showMeta.nextEpisodeAirDate}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className={styles.controls}>
                    <button
                      className={`${styles.watchlistBtn} ${state.inWatchlist ? styles.inList : ''}`}
                      onClick={toggleWatchlist}
                    >
                      {state.inWatchlist ? (
                        <Icon name="check" size={14} />
                      ) : (
                        <Icon name="plus" size={14} />
                      )}
                      {state.inWatchlist ? 'In Watchlist' : 'Add to Watchlist'}
                    </button>
                    <QueueOptionsButton
                      showId={showId}
                      showName={state.showMeta.name || state.showMeta.names?.romaji}
                      showThumbnail={state.showMeta.thumbnail}
                      nativeName={state.showMeta.names?.native}
                      englishName={state.showMeta.names?.english}
                      showType={state.showMeta.type}
                      className={`${styles.watchlistBtn} ${styles.queueBtn}`}
                      activeClassName={styles.queueActive}
                    />
                    {showManualWatchedButton && (
                      <button
                        className={`${styles.watchlistBtn} ${styles.markWatchedBtn} ${isCurrentEpisodeWatched ? styles.markWatchedDone : ''}`}
                        onClick={handleMarkEpisodeWatched}
                        disabled={isMarkingWatched || !state.currentEpisode}
                      >
                        <Icon name="check" size={14} />
                        {isMarkingWatched
                          ? 'Saving...'
                          : isCurrentEpisodeWatched
                            ? 'Watched'
                            : 'Mark Watched'}
                      </button>
                    )}
                    <button
                      className={`${styles.watchlistBtn} ${styles.modeToggleBtn} ${state.currentMode === 'dub' ? styles.modeToggleActive : ''}`}
                      onClick={() => {
                        const mode = state.currentMode === 'dub' ? 'sub' : 'dub'
                        hasAutoFallbackRef.current = false
                        triedProvidersRef.current = []
                        fallbackDismissedRef.current = false
                        setFallbackPrompt(null)
                        dispatch({ type: 'SET_MODE', payload: mode })
                        localStorage.setItem('preferredMode', mode)
                      }}
                      type="button"
                      aria-pressed={state.currentMode === 'dub'}
                    >
                      {state.currentMode === 'dub' ? 'DUB' : 'SUB'}
                    </button>
                    <button
                      className={`${styles.watchlistBtn} ${styles.modeToggleBtn} ${player.state.useNativeControls ? styles.modeToggleActive : ''}`}
                      onClick={() => {
                        const newValue = !player.state.useNativeControls
                        player.actions.setUseNativeControls(newValue)
                        localStorage.setItem('playerUseNativeControls', newValue.toString())
                      }}
                      type="button"
                    >
                      {player.state.useNativeControls ? 'NATIVE: ON' : 'NATIVE: OFF'}
                    </button>
                  </div>
                </div>
              </div>
              {episodeNavControls(
                `${styles.episodeActions} ${styles.mobileEpisodeActions}`,
                'mobile'
              )}

              <div className={styles.descriptionSection}>
                <h3>Synopsis</h3>
                <SynopsisText
                  text={
                    state.showMeta.description
                      ? state.showMeta.description.replace(/<[^>]*>?/gm, '')
                      : ''
                  }
                  emptyText="No description available."
                />
              </div>

              <button className={styles.detailsToggleBtn} onClick={handleToggleDetails}>
                {state.showCombinedDetails ? (
                  <Icon name="chevron-up" />
                ) : (
                  <Icon name="chevron-down" />
                )}
                {state.showCombinedDetails ? 'Hide Details' : 'Show Details'}
              </button>

              {state.showCombinedDetails && (
                <AnimeMetaDetails showMeta={state.showMeta} styles={styles} />
              )}
            </div>
          </>
        )}
      </div>

      <EpisodeDrawer
        isOpen={isEpisodeDrawerOpen}
        onClose={() => setIsEpisodeDrawerOpen(false)}
        episodes={state.episodes}
        currentEpisode={state.currentEpisode}
        watchedEpisodes={state.watchedEpisodes}
        onEpisodeClick={(ep) => {
          setIsEpisodeDrawerOpen(false)
          navigate(`/watch/${showId}/${ep}`)
        }}
      />
    </div>
  )
}

export default Player
