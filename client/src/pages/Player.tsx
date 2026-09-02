import React, { useRef, useEffect, useMemo, useCallback, useState, useLayoutEffect } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import styles from './Player.module.css'
import layoutStyles from './PlayerPageLayout.module.css'
import {
  FaCheck,
  FaPlus,
  FaChevronDown,
  FaChevronUp,
  FaBackward,
  FaForward,
  FaChevronLeft,
  FaChevronRight,
  FaListUl,
} from 'react-icons/fa'
import { fixThumbnailUrl } from '../lib/utils'
import GenericModal from '../components/common/GenericModal'
import { Button } from '../components/common/Button'
import { useMatureConsent } from '../hooks/useMatureConsent'
import ResumeModal from '../components/common/ResumeModal'
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
import { usePlayerData } from '../hooks/usePlayerData'
import { useQueue, useRemoveFromQueue, useClearQueue, useReorderQueue } from '../hooks/useAnimeData'
import type { QueueItem } from '../hooks/useAnimeData'
import type { VideoLink, SubtitleTrack } from '../types/player'
import AnimeMetaDetails from '../components/anime/AnimeMetaDetails'
import SynopsisText from '../components/anime/SynopsisText'
import AnimePaheCookieModal from '../components/anime/AnimePaheCookieModal'
import QueueOptionsButton from '../components/anime/QueueOptionsButton'

const Player: React.FC = () => {
  const { id: showId, episodeNumber } = useParams<{ id: string; episodeNumber?: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const location = useLocation()
  const { hasConsent: hasMatureConsent, grant: grantMatureConsent } = useMatureConsent()

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
  const rafIdRef = useRef<number | null>(null)
  const episodeSidebarRef = useRef<HTMLDivElement>(null)
  const seekToTimeRef = useRef<number>(0)
  const resumeTimeRef = useRef(state.resumeTime)
  const showResumeModalRef = useRef(state.showResumeModal)

  useEffect(() => {
    resumeTimeRef.current = state.resumeTime
    showResumeModalRef.current = state.showResumeModal
  }, [state.resumeTime, state.showResumeModal])

  const [skipIndicator, setSkipIndicator] = useState<{
    side: 'left' | 'right'
    visible: boolean
  } | null>(null)
  const [showNextEpisodePrompt, setShowNextEpisodePrompt] = useState(false)
  const [hasReachedEpisodeEnd, setHasReachedEpisodeEnd] = useState(false)
  const [isEpisodeDrawerOpen, setIsEpisodeDrawerOpen] = useState(false)
  const hasDismissedShowCompletedRef = useRef(false)
  const [queueCountdown, setQueueCountdown] = useState<number | null>(null)
  const hasAutoFallbackRef = useRef(false)
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
    }
  }, [episodeNumber])

  useEffect(() => {
    if (!hasReachedEpisodeEnd) {
      hasDismissedShowCompletedRef.current = false
    }
  }, [hasReachedEpisodeEnd])
  const clickCountRef = useRef(0)
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastInteractionTimeRef = useRef(0)
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
  const isCompleted =
    state.resumeTime > 0 &&
    state.resumeDuration > 0 &&
    state.resumeTime >= state.resumeDuration * 0.8
  const effectiveIsCompleted = isCompleted || hasReachedEpisodeEnd
  const isShowCompleted = isLastEpisode && isFinishedShow && effectiveIsCompleted
  const shouldShowModal = state.showResumeModal && (isShowCompleted || !effectiveIsCompleted)

  const handlePlayerClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest(`.${styles.controlsOverlay}`)) return

      const isHiding = player.state.showControls
      actions.setShowControls(!player.state.showControls)

      if (isHiding) {
        lastInteractionTimeRef.current = Date.now()
      }

      clickCountRef.current += 1

      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current)
      }

      if (clickCountRef.current === 2) {
        actions.toggleFullscreen()
        clickCountRef.current = 0
        return
      }

      clickTimerRef.current = setTimeout(() => {
        clickCountRef.current = 0
      }, 250)
    },
    [actions, player.state.showControls]
  )

  useEffect(() => {
    const videoElement = refs.videoRef.current
    if (!videoElement) return

    if (hlsInstance.current) {
      hlsInstance.current.destroy()
    }

    if (state.loadingVideo || state.selectedSource) {
      videoElement.pause()
      videoElement.removeAttribute('src')
      videoElement.load()
    }

    while (videoElement.firstChild) {
      videoElement.removeChild(videoElement.firstChild)
    }

    if (!state.selectedSource || !state.selectedLink) return

    if (state.selectedSource.type === 'iframe') {
      seekToTimeRef.current = 0
      return
    }

    if (resumeTimeRef.current > 5 && !showResumeModalRef.current) {
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
      state.selectedSource.subtitles.forEach((sub) => {
        const track = document.createElement('track')
        track.kind = 'subtitles'
        track.label = sub.label
        track.srclang = sub.lang

        const subSrc = sub.src ?? sub.url
        if (subSrc) {
          let subUrl = `/api/subtitle-proxy?url=${encodeURIComponent(subSrc)}`
          if (state.selectedLink?.headers?.Referer) {
            subUrl += `&referer=${encodeURIComponent(state.selectedLink.headers.Referer)}`
          }
          track.src = subUrl
        }

        if (subtitlesEnabled && (sub.lang === 'en' || sub.label === 'English')) {
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

    if (state.selectedLink.hls) {
      const Hls = (window as unknown as { Hls?: typeof Hls }).Hls
      if (Hls && Hls.isSupported()) {
        const isLowEnd = document.body.classList.contains('low-end')
        const hls = new Hls({
          maxBufferLength: isLowEnd ? 15 : 30,
          maxMaxBufferLength: isLowEnd ? 30 : 60,
          maxBufferSize: isLowEnd ? 25 * 1000 * 1000 : 60 * 1000 * 1000,
          startLevel: -1,
          enableWorker: true,
        })
        hlsInstance.current = hls
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal && !hasAutoFallbackRef.current) {
            handleVideoSourceErrorRef.current()
          }
        })
        hls.loadSource(proxiedUrl)
        hls.attachMedia(videoElement)
      } else if (
        videoElement.canPlayType('application/vnd.apple.mpegurl') ||
        videoElement.canPlayType('application/x-mpegURL')
      ) {
        videoElement.src = proxiedUrl
      } else {
        videoElement.src = proxiedUrl
      }
    } else {
      videoElement.src = proxiedUrl
    }

    const savedVolume = localStorage.getItem('playerVolume')
    const savedMuted = localStorage.getItem('playerMuted')

    if (savedVolume !== null) {
      videoElement.volume = parseFloat(savedVolume)
    }
    if (savedMuted !== null) {
      videoElement.muted = savedMuted === 'true'
    }

    const shouldAutoPlay = !(showResumeModalRef.current && resumeTimeRef.current > 5)
    if (shouldAutoPlay) {
      videoElement.play().catch((error) => {
        console.warn('Autoplay was prevented:', error)
        actions.setShowControls(true)
      })
    }

    return () => {
      videoElement.removeEventListener('loadedmetadata', handleLoaded)
      if (hlsInstance.current) {
        hlsInstance.current.destroy()
      }
    }
  }, [state.selectedSource, state.selectedLink, refs.videoRef, actions, state.loadingVideo])

  const handleVideoSourceError = useCallback(() => {
    if (hasAutoFallbackRef.current) return
    const sources = videoSourcesRef.current
    if (state.selectedSource?.type !== 'player') return
    const fallbackSource = sources.find((s) => s.type === 'iframe')
    if (!fallbackSource?.links?.length) return

    hasAutoFallbackRef.current = true
    const bestLink = fallbackSource.links[0]
    setPreferredSource(fallbackSource.sourceName)
    dispatch({
      type: 'SET_STATE',
      payload: { selectedSource: fallbackSource, selectedLink: bestLink },
    })
  }, [state.selectedSource, dispatch, setPreferredSource])
  handleVideoSourceErrorRef.current = handleVideoSourceError

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
      handlePlaybackFinished()
    }
    videoElement.addEventListener('ended', handleVideoEnd)
    return () => {
      if (videoElement) {
        videoElement.removeEventListener('ended', handleVideoEnd)
      }
    }
  }, [handlePlaybackFinished, refs.videoRef, player.state.isFullscreen])

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
    if (shouldShowModal && player.state.isFullscreen) {
      player.actions.toggleFullscreen()
    }
  }, [shouldShowModal, player.state.isFullscreen, player.actions])

  useEffect(() => {
    if (shouldShowModal && refs.videoRef.current) {
      refs.videoRef.current.pause()
    }
  }, [shouldShowModal, refs.videoRef])

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

  const handleUserActivity = useCallback(
    (e: MouseEvent | TouchEvent) => {
      const container = refs.playerContainerRef.current
      if (!container) return

      const interactionDelay = e.type === 'touchstart' ? 800 : 500
      if (Date.now() - lastInteractionTimeRef.current < interactionDelay) return

      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          if (!player.state.showControls && !player.state.useNativeControls) {
            actions.setShowControls(true)
          }
          container.style.cursor = 'default'

          if (player.actions.inactivityTimer.current) {
            clearTimeout(player.actions.inactivityTimer.current)
          }

          const isInteracting =
            player.state.isScrubbing ||
            player.state.showSettings ||
            player.state.showVolumeSlider ||
            isEpisodeDrawerOpen

          if (player.state.isPlaying && !isInteracting) {
            player.actions.inactivityTimer.current = window.setTimeout(() => {
              if (!player.state.useNativeControls) {
                actions.setShowControls(false)
              }
              if (player.state.isFullscreen) {
                container.style.cursor = 'none'
              }
            }, 3000)
          }
          rafIdRef.current = null
        })
      }
    },
    [
      player.state.isPlaying,
      player.state.isFullscreen,
      player.state.showControls,
      player.state.isScrubbing,
      player.state.showSettings,
      player.state.showVolumeSlider,
      player.state.useNativeControls,
      isEpisodeDrawerOpen,
      actions,
      player.actions,
      refs.playerContainerRef,
    ]
  )

  useEffect(() => {
    const isInteracting =
      player.state.isScrubbing ||
      player.state.showSettings ||
      player.state.showVolumeSlider ||
      isEpisodeDrawerOpen

    if (isInteracting) {
      actions.setShowControls(true)
      if (player.actions.inactivityTimer.current) {
        clearTimeout(player.actions.inactivityTimer.current)
      }
    }
  }, [
    player.state.isScrubbing,
    player.state.showSettings,
    player.state.showVolumeSlider,
    isEpisodeDrawerOpen,
    actions,
    player.actions,
  ])

  useEffect(() => {
    const container = refs.playerContainerRef.current
    if (container) {
      container.addEventListener('mousemove', handleUserActivity)

      const handleTouch = (e: TouchEvent) => {
        handleUserActivity(e)
      }
      container.addEventListener('touchstart', handleTouch, { passive: true })

      const handleMouseLeave = () => {
        actions.setShowControls(false)
      }
      container.addEventListener('mouseleave', handleMouseLeave)

      return () => {
        container.removeEventListener('mousemove', handleUserActivity)
        container.removeEventListener('touchstart', handleTouch)
        container.removeEventListener('mouseleave', handleMouseLeave)
      }
    }
  }, [handleUserActivity, refs.playerContainerRef, actions])

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

  const { setIsFullscreen, setAvailableSubtitles, setActiveSubtitleTrack } = actions

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [setIsFullscreen])

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
      const englishTrack = player.state.availableSubtitles.find(
        (t) => t.lang === 'en' || t.label === 'English'
      )
      const trackToActivate = englishTrack || player.state.availableSubtitles[0]
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
      const isActive = t.language === active || t.label === active
      t.mode = isActive ? 'showing' : 'hidden'
      if (isActive) matched = true
    })
    if (!matched && video.textTracks.length > 0) {
      const fallback =
        Array.from(video.textTracks).find((t) => t.language === 'en' || t.label === 'English') ||
        video.textTracks[0]
      if (fallback) fallback.mode = 'showing'
    }
  }, [player.state.activeSubtitleTrack, player.state.availableSubtitles, refs.videoRef])

  useEffect(() => {
    const styleId = 'dynamic-subtitle-styles'
    let styleTag = document.getElementById(styleId)
    if (!styleTag) {
      styleTag = document.createElement('style')
      styleTag.id = styleId
      document.head.appendChild(styleTag)
    }

    const fontSize = `${player.state.subtitleFontSize}rem`

    styleTag.textContent = `
  video::cue {
    font-size: ${fontSize} !important;
    background-color: rgba(0, 0, 0, 0.5) !important;
    color: white !important;
    text-shadow: 0 0 4px black;
  }
  `

    const video = refs.videoRef.current
    if (!video) return

    const updateCuePosition = () => {
      const activeTrack = Array.from(video.textTracks).find((t) => t.mode === 'showing')
      if (activeTrack && activeTrack.cues) {
        Array.from(activeTrack.cues).forEach((cue: unknown) => {
          try {
            const vttCue = cue as { snapToLines?: boolean; line?: number }
            vttCue.snapToLines = false
            const pos = Math.max(0, Math.min(100, 100 - player.state.subtitlePosition))
            vttCue.line = pos
          } catch (e) {
            // Ignore error
          }
        })
      }
    }

    updateCuePosition()

    const handleCueChange = () => {
      updateCuePosition()
    }

    const activeTrack = Array.from(video.textTracks).find((t) => t.mode === 'showing')
    if (activeTrack) {
      activeTrack.addEventListener('cuechange', handleCueChange)
    }

    return () => {
      if (activeTrack) {
        activeTrack.removeEventListener('cuechange', handleCueChange)
      }
      const tag = document.getElementById(styleId)
      if (tag) {
        tag.remove()
      }
    }
  }, [
    player.state.subtitleFontSize,
    player.state.subtitlePosition,
    player.state.activeSubtitleTrack,
    refs.videoRef,
  ])

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
    dispatch({ type: 'SET_STATE', payload: { showResumeModal: false } })
  }, [dispatch, isShowCompleted])

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
        <FaChevronLeft size={12} />
        Prev EP
      </button>
      <button
        className={`${styles.episodeNavBtn} ${styles.primary}`}
        onClick={handleNextEpisode}
        disabled={!nextEpisode}
        type="button"
      >
        Next EP
        <FaChevronRight size={12} />
      </button>
      {variant === 'mobile' && isMobile && (
        <button
          className={`${styles.episodeNavBtn} ${styles.episodePickerBtn}`}
          onClick={() => setIsEpisodeDrawerOpen(true)}
          type="button"
        >
          <FaListUl size={12} />
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
    localStorage.setItem('autoplayEnabled', checked.toString())
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
        <GenericModal isOpen title="Content Warning" onClose={() => navigate('/home')}>
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
        </GenericModal>
      </div>
    )
  }

  return (
    <div
      className={`${layoutStyles.playerPageLayout} ${isTheaterMode ? layoutStyles.theaterMode : ''}`}
      onClick={handleLayoutClick}
    >
      <ResumeModal
        show={shouldShowModal}
        resumeTime={player.actions.formatTime(state.resumeTime)}
        onResume={handleResume}
        onStartOver={handleStartOver}
        onClose={handleCloseModal}
        isShowCompleted={isShowCompleted}
        onMoveToCompleted={handleMoveToCompletedAndNavigate}
        isMovingToCompleted={isUpdatingWatchlistStatus}
      />

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
          ref={refs.playerContainerRef}
          className={`${styles.videoContainer} ${!player.state.isFullscreen ? layoutStyles.videoPlayerWrapper : ''} ${player.state.isFullscreen ? styles.fullscreenActive : ''}`}
          onClick={handlePlayerClick}
          style={{
            ...(shouldShowModal ? { visibility: 'hidden' } : {}),
          }}
        >
          {skipIndicator && (
            <div
              className={`${styles.skipIndicatorContainer} ${skipIndicator.side === 'left' ? styles.leftSkip : styles.rightSkip} `}
            >
              <div className={styles.skipBubble}>
                <div className={styles.skipIcon}>
                  {skipIndicator.side === 'left' ? <FaBackward /> : <FaForward />}
                </div>
                <div className={styles.skipText}>15s</div>
              </div>
            </div>
          )}

          {player.state.isSpeedBoostActive && (
            <div className={styles.speedBoostBadge} aria-hidden="true">
              <span>2x</span>
              <FaForward size={12} />
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
              {!isVideoLoading &&
                state.videoSources.length > 0 &&
                !player.state.useNativeControls && (
                  <PlayerControls
                    player={player}
                    isAutoplayEnabled={state.isAutoplayEnabled}
                    onAutoplayChange={handleAutoplayChange}
                    showNextEpisodeButton={
                      !shouldShowModal && showNextEpisodePrompt && queue.length === 0
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
                  />
                )}{' '}
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
                />
              )}
            </>
          )}
          {queueCountdown !== null && pendingQueueTransition?.nextItem && (
            <div className={styles.queueCountdown}>Queue next in {queueCountdown}s</div>
          )}
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
                onProviderChange={(newProvider) => {
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
                />
              </>
            )}

            <div className={layoutStyles.playerInfoContainer}>
              <div className={layoutStyles.playerInfoHeader}>
                <div className={layoutStyles.playerAnimeCard}>
                  <img
                    src={fixThumbnailUrl(state.showMeta.thumbnail || '')}
                    alt={displayTitle}
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
                      {state.inWatchlist ? <FaCheck size={14} /> : <FaPlus size={14} />}
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
                        <FaCheck size={14} />
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
                {state.showCombinedDetails ? <FaChevronUp /> : <FaChevronDown />}
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
