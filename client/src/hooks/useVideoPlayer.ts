import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SkipInterval, SubtitleTrack } from '../types/player'

interface VideoPlayerProps {
  skipIntervals: SkipInterval[]
  showId?: string
  episodeNumber?: string
  episodeCount?: number
  sourceType?: string
  showMeta?: {
    name?: string
    thumbnail?: string
    names?: { native?: string; english?: string }
    genres?: { name: string }[]
    score?: number
    type?: string
    isAdult?: boolean
  }
}

const useVideoPlayer = ({
  skipIntervals,
  showId,
  episodeNumber,
  episodeCount,
  sourceType,
  showMeta,
}: VideoPlayerProps) => {
  const queryClient = useQueryClient()
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerContainerRef = useRef<HTMLDivElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const inactivityTimer = useRef<number | null>(null)
  const wasPlayingBeforeScrub = useRef(false)
  const debouncedUpdateTimer = useRef<NodeJS.Timeout | null>(null)
  const lastThrottledUpdateTime = useRef(0)
  const normalPlaybackRateRef = useRef(1)
  const speedBoostRef = useRef({
    mouse: false,
    keyboard: false,
  })
  const mouseHoldTimerRef = useRef<number | null>(null)
  const spaceHoldTimerRef = useRef<number | null>(null)
  const spaceKeyHeldRef = useRef(false)

  const sessionIdRef = useRef(Math.random().toString(36).substring(2))

  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(() => {
    try {
      return localStorage.getItem('playerMuted') === 'true'
    } catch {
      return false
    }
  })
  const [volume, setVolume] = useState(() => {
    try {
      const savedVolume = parseFloat(localStorage.getItem('playerVolume') || '')
      return isNaN(savedVolume) ? 1 : Math.max(0, Math.min(1, savedVolume))
    } catch {
      return 1
    }
  })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [duration, setDuration] = useState(0)
  const [showControls, setShowControls] = useState(true)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [hoverTime, setHoverTime] = useState<{ time: number; position: number | null }>({
    time: 0,
    position: null,
  })
  const [isAutoSkipEnabled, setIsAutoSkipEnabled] = useState(
    localStorage.getItem('autoSkipEnabled') === 'true'
  )
  const [currentSkipInterval, setCurrentSkipInterval] = useState<SkipInterval | null>(null)
  const [showCCMenu, setShowCCMenu] = useState(false)
  const [subtitleFontSize, setSubtitleFontSize] = useState(
    parseFloat(localStorage.getItem('subtitleFontSize') || '1.8')
  )
  const [subtitlePosition, setSubtitlePosition] = useState(
    parseInt(localStorage.getItem('subtitlePosition') || '-4')
  )
  const [availableSubtitles, setAvailableSubtitles] = useState<SubtitleTrack[]>([])
  const [activeSubtitleTrack, setActiveSubtitleTrack] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showVolumeSlider, setShowVolumeSlider] = useState(false)
  const [isBuffering, setIsBuffering] = useState(false)
  const [isSpeedBoostActive, setIsSpeedBoostActive] = useState(false)
  const [useNativeControls, setUseNativeControls] = useState(() => {
    try {
      return localStorage.getItem('playerUseNativeControls') === 'true'
    } catch {
      return false
    }
  })
  const hasEnded = useRef(false)
  const lastReportedTime = useRef<number>(-1)

  const buildProgressPayload = useCallback(() => {
    const video = videoRef.current
    if (!showId || !episodeNumber || !showMeta?.name) return null

    return {
      showId,
      episodeNumber,
      episodeCount,
      currentTime: video ? video.currentTime : 0,
      duration: video ? video.duration : 0,
      showName: showMeta.name,
      showThumbnail: showMeta.thumbnail,
      nativeName: showMeta.names?.native,
      englishName: showMeta.names?.english,
      genres: Array.isArray(showMeta.genres)
        ? showMeta.genres.map((g) => (typeof g === 'string' ? g : g?.name)).filter(Boolean)
        : undefined,
      popularityScore: showMeta.score,
      type: showMeta.type,
      isPlaying: video ? !video.paused : true,
      sessionId: sessionIdRef.current,
      isAdult: showMeta.isAdult,
    }
  }, [showId, episodeNumber, episodeCount, showMeta])

  const sendProgressUpdate = useCallback(
    (isFinalUpdate = false, force = false) => {
      if (hasEnded.current) return false

      const payload = buildProgressPayload()
      if (!payload) return false

      const video = videoRef.current
      if (!video && sourceType !== 'iframe') return false

      const isFinished = video ? video.currentTime >= video.duration * 0.8 : false
      let timeToReport = video ? video.currentTime : 0

      if (isFinalUpdate && isFinished) {
        timeToReport = video ? video.duration : 0
      }

      if (!force) {
        if (timeToReport === 0 && !isFinished) return false

        const timeDiff = video ? Math.abs(timeToReport - lastReportedTime.current) : 0
        if (!isFinalUpdate && video && timeToReport !== video.duration && timeDiff < 5) {
          return false
        }
      }

      payload.currentTime = timeToReport
      lastReportedTime.current = timeToReport

      const animepaheUa = localStorage.getItem('animepahe_ua')
      const animepaheCookie = localStorage.getItem('animepahe_cookie')

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (animepaheUa) headers['x-animepahe-ua'] = animepaheUa
      if (animepaheCookie) headers['x-animepahe-cookie'] = animepaheCookie

      const saveProgress = async () => {
        try {
          await fetch('/api/update-progress', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          })
          queryClient.invalidateQueries({ queryKey: ['video-sources', showId, episodeNumber] })
          queryClient.invalidateQueries({ queryKey: ['continueWatchingFast'] })
          queryClient.invalidateQueries({ queryKey: ['continueWatchingUpNext'] })
          queryClient.invalidateQueries({ queryKey: ['continueWatching'] })
          queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
        } catch (err) {
          console.error('Failed to update progress:', err)
        }
      }

      if (isFinalUpdate) {
        saveProgress()
      } else {
        fetch('/api/update-progress', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch((err) => console.error('Failed to update progress:', err))
      }

      return true
    },
    [buildProgressPayload, sourceType, queryClient, showId, episodeNumber]
  )

  useEffect(() => {
    const video = videoRef.current
    if (video) {
      video.volume = volume
      video.muted = isMuted
    }
  }, [videoRef, volume, isMuted])

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!hasEnded.current) {
        sendProgressUpdate(true)
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    const debounceTimer = debouncedUpdateTimer
    const activityTimer = inactivityTimer
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (!hasEnded.current) {
        sendProgressUpdate(true)
      }
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      if (activityTimer.current) clearTimeout(activityTimer.current)
    }
  }, [sendProgressUpdate])

  const formatTime = (timeInSeconds: number): string => {
    if (isNaN(timeInSeconds) || timeInSeconds <= 0) return '00:00'
    const result = new Date(timeInSeconds * 1000).toISOString().slice(11, 19)
    const hours = parseInt(result.slice(0, 2), 10)
    return hours > 0 ? result : result.slice(3)
  }
  const toggleFullscreen = useCallback(() => {
    if (!playerContainerRef.current) return
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`)
      })
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen()
      }
    }
  }, [])

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => console.warn('Autoplay was prevented.'))
    } else {
      videoRef.current.pause()
      setShowControls(true)
    }
  }, [setShowControls])

  const syncPlaybackRate = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    const shouldBoost = speedBoostRef.current.mouse || speedBoostRef.current.keyboard
    video.playbackRate = shouldBoost ? 2 : normalPlaybackRateRef.current
  }, [])

  const setMouseSpeedBoost = useCallback(
    (enabled: boolean) => {
      if (speedBoostRef.current.mouse === enabled) return
      speedBoostRef.current.mouse = enabled
      setIsSpeedBoostActive(enabled || speedBoostRef.current.keyboard)
      syncPlaybackRate()
    },
    [syncPlaybackRate]
  )

  const setKeyboardSpeedBoost = useCallback(
    (enabled: boolean) => {
      if (speedBoostRef.current.keyboard === enabled) return
      speedBoostRef.current.keyboard = enabled
      setIsSpeedBoostActive(speedBoostRef.current.mouse || enabled)
      syncPlaybackRate()
    },
    [syncPlaybackRate]
  )

  const seek = useCallback(
    (seconds: number) => {
      if (videoRef.current) {
        videoRef.current.currentTime += seconds
        if (debouncedUpdateTimer.current) clearTimeout(debouncedUpdateTimer.current)
        debouncedUpdateTimer.current = setTimeout(() => {
          sendProgressUpdate(false, true)
        }, 1500)
        setShowControls(true)
      }
    },
    [sendProgressUpdate, setShowControls]
  )

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return
    const newMuted = !videoRef.current.muted
    videoRef.current.muted = newMuted
    setIsMuted(newMuted)
    localStorage.setItem('playerMuted', String(newMuted))
    if (!newMuted && videoRef.current.volume === 0) {
      const newVolume = 0.5
      videoRef.current.volume = newVolume
      setVolume(newVolume)
      localStorage.setItem('playerVolume', String(newVolume))
    }
    setShowControls(true)
  }, [setShowControls])

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = document.fullscreenElement !== null
      setIsFullscreen(isCurrentlyFullscreen)
      if (isCurrentlyFullscreen) {
        setShowControls(true)
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [setShowControls])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target.closest(
          'input, textarea, button, select, a, [role="button"], [contenteditable="true"]'
        )
      )
        return

      if (e.code === 'Space') {
        e.preventDefault()

        if (spaceKeyHeldRef.current) return

        spaceKeyHeldRef.current = true

        if (spaceHoldTimerRef.current) {
          clearTimeout(spaceHoldTimerRef.current)
        }

        spaceHoldTimerRef.current = window.setTimeout(() => {
          spaceHoldTimerRef.current = null
          if (!spaceKeyHeldRef.current) return
          setKeyboardSpeedBoost(true)
        }, 180)
        return
      }

      switch (e.key.toLowerCase()) {
        case 'f':
          toggleFullscreen()
          break
        case 'm':
          toggleMute()
          break
        case 'arrowright':
          seek(10)
          break
        case 'arrowleft':
          seek(-10)
          break
        case 'arrowup':
          e.preventDefault()
          if (videoRef.current) {
            const newVolume = Math.min(1, videoRef.current.volume + 0.1)
            videoRef.current.volume = newVolume
            setVolume(newVolume)
          }
          break
        case 'arrowdown':
          e.preventDefault()
          if (videoRef.current) {
            const newVolume = Math.max(0, videoRef.current.volume - 0.1)
            videoRef.current.volume = newVolume
            setVolume(newVolume)
          }
          break
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return

      e.preventDefault()
      spaceKeyHeldRef.current = false

      if (speedBoostRef.current.keyboard) {
        setKeyboardSpeedBoost(false)
        return
      }

      if (spaceHoldTimerRef.current) {
        clearTimeout(spaceHoldTimerRef.current)
        spaceHoldTimerRef.current = null
        togglePlay()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
      if (spaceHoldTimerRef.current) {
        clearTimeout(spaceHoldTimerRef.current)
        spaceHoldTimerRef.current = null
      }
      spaceKeyHeldRef.current = false
      setKeyboardSpeedBoost(false)
      setIsSpeedBoostActive(false)
    }
  }, [setKeyboardSpeedBoost, togglePlay, toggleFullscreen, toggleMute, seek])

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return

      const target = e.target as HTMLElement | null
      if (!target) return

      if (target.closest('[data-speed-boost-ignore="true"]')) return

      const container = playerContainerRef.current
      if (!container || !container.contains(target)) return

      if (mouseHoldTimerRef.current) {
        clearTimeout(mouseHoldTimerRef.current)
      }

      mouseHoldTimerRef.current = window.setTimeout(() => {
        mouseHoldTimerRef.current = null
        setMouseSpeedBoost(true)
      }, 180)
    }

    const handleMouseUp = () => {
      if (mouseHoldTimerRef.current) {
        clearTimeout(mouseHoldTimerRef.current)
        mouseHoldTimerRef.current = null
      }
      setMouseSpeedBoost(false)
    }

    const handleWindowBlur = () => {
      if (mouseHoldTimerRef.current) {
        clearTimeout(mouseHoldTimerRef.current)
        mouseHoldTimerRef.current = null
      }
      spaceKeyHeldRef.current = false
      if (spaceHoldTimerRef.current) {
        clearTimeout(spaceHoldTimerRef.current)
        spaceHoldTimerRef.current = null
      }
      setKeyboardSpeedBoost(false)
      setMouseSpeedBoost(false)
      setIsSpeedBoostActive(false)
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('blur', handleWindowBlur)
      if (mouseHoldTimerRef.current) {
        clearTimeout(mouseHoldTimerRef.current)
        mouseHoldTimerRef.current = null
      }
    }
  }, [setKeyboardSpeedBoost, setMouseSpeedBoost])

  const onPlay = useCallback(() => {
    setIsPlaying(true)
    setIsBuffering(false)
    setTimeout(() => sendProgressUpdate(false, true), 50)
  }, [sendProgressUpdate])
  const onPlaying = useCallback(() => {
    setIsBuffering(false)
  }, [])
  const onWaiting = useCallback(() => {
    setIsBuffering(true)
  }, [])
  const onPause = useCallback(() => {
    setIsPlaying(false)
    setShowControls(true)
    setTimeout(() => sendProgressUpdate(false, true), 50)
  }, [sendProgressUpdate])

  useEffect(() => {
    hasEnded.current = false
    lastReportedTime.current = -1
    lastThrottledUpdateTime.current = 0
    sessionIdRef.current = Math.random().toString(36).substring(2)
  }, [showId, episodeNumber])

  useEffect(() => {
    const sessionId = sessionIdRef.current
    return () => {
      const payload = JSON.stringify({ sessionId })
      const blob = new Blob([payload], { type: 'application/json' })
      navigator.sendBeacon('/api/discord/clear', blob)
    }
  }, [showId, episodeNumber])

  useEffect(() => {
    if (sourceType !== 'iframe') return

    // Immediate update at start
    sendProgressUpdate(false, true)

    // Periodic update every 60 seconds
    const heartbeatInterval = setInterval(() => {
      sendProgressUpdate(false, true)
    }, 60000)

    return () => clearInterval(heartbeatInterval)
  }, [sourceType, sendProgressUpdate])

  const onLoadedMetadata = useCallback(() => {
    setDuration(videoRef.current?.duration || 0)
    syncPlaybackRate()
  }, [syncPlaybackRate])
  const onVolumeChange = useCallback(() => {
    if (videoRef.current) {
      const newMuted = videoRef.current.muted
      const newVolume = videoRef.current.volume

      setIsMuted(newMuted)
      setVolume(newVolume)

      localStorage.setItem('playerMuted', String(newMuted))
      localStorage.setItem('playerVolume', String(newVolume))
    }
  }, [])
  const onProgress = useCallback(() => {}, [])
  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const time = video.currentTime || 0
    const now = Date.now()
    if (now - lastThrottledUpdateTime.current > 60000) {
      if (sendProgressUpdate()) {
        lastThrottledUpdateTime.current = now
      }
    }

    const activeSkip =
      skipIntervals.find((interval) => time >= interval.start_time && time < interval.end_time) ||
      null

    setCurrentSkipInterval((prev) => {
      if (prev?.skip_id !== activeSkip?.skip_id) return activeSkip
      return prev
    })
    if (isAutoSkipEnabled && activeSkip && !video.paused) {
      video.currentTime = activeSkip.end_time
      setCurrentSkipInterval(null)
    }
  }, [skipIntervals, isAutoSkipEnabled, sendProgressUpdate])

  const reportFinalProgress = useCallback(() => {
    const payload = buildProgressPayload()
    if (!payload) return

    payload.currentTime = payload.duration

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const animepaheUa = localStorage.getItem('animepahe_ua')
    const animepaheCookie = localStorage.getItem('animepahe_cookie')

    if (animepaheUa) headers['x-animepahe-ua'] = animepaheUa
    if (animepaheCookie) headers['x-animepahe-cookie'] = animepaheCookie

    fetch('/api/update-progress', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['video-sources', showId, episodeNumber] })
        queryClient.invalidateQueries({ queryKey: ['continueWatchingFast'] })
        queryClient.invalidateQueries({ queryKey: ['continueWatchingUpNext'] })
        queryClient.invalidateQueries({ queryKey: ['continueWatching'] })
        queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
      })
      .catch((err) => console.error('Failed to send final progress:', err))
  }, [buildProgressPayload, queryClient, showId, episodeNumber])

  const onEnded = useCallback(() => {
    hasEnded.current = true
    reportFinalProgress()
  }, [reportFinalProgress])

  useEffect(() => {
    const handleDocumentMouseUp = () => {
      if (isScrubbing) {
        setIsScrubbing(false)
        setHoverTime({ time: 0, position: null })
        if (wasPlayingBeforeScrub.current) {
          videoRef.current?.play()
        }
        sendProgressUpdate(false, true)
      }
    }
    if (isScrubbing) {
      document.addEventListener('mouseup', handleDocumentMouseUp)
    }
    return () => {
      document.removeEventListener('mouseup', handleDocumentMouseUp)
    }
  }, [isScrubbing, sendProgressUpdate])

  const actions = useMemo(
    () => ({
      togglePlay,
      seek,
      toggleMute,
      toggleFullscreen,
      onPlay,
      onPause,
      onLoadedMetadata,
      formatTime,
      onVolumeChange,
      onProgress,
      onTimeUpdate,
      onEnded,
      setShowControls,
      setIsScrubbing,
      setHoverTime,
      setIsAutoSkipEnabled,
      setCurrentSkipInterval,
      setShowCCMenu,
      setSubtitleFontSize,
      setSubtitlePosition,
      setAvailableSubtitles,
      setActiveSubtitleTrack,
      setShowSettings,
      setShowVolumeSlider,
      wasPlayingBeforeScrub,
      inactivityTimer,
      setIsFullscreen,
      onWaiting,
      onPlaying,
      sendProgressUpdate,
      setUseNativeControls,
    }),
    [
      togglePlay,
      seek,
      toggleMute,
      toggleFullscreen,
      onPlay,
      onPause,
      onLoadedMetadata,
      onVolumeChange,
      onProgress,
      onTimeUpdate,
      onEnded,
      setIsFullscreen,
      onWaiting,
      onPlaying,
      sendProgressUpdate,
      setUseNativeControls,
    ]
  )

  return {
    refs: { videoRef, playerContainerRef, progressBarRef },
    state: {
      isPlaying,
      isMuted,
      volume,
      isFullscreen,
      duration,
      showControls,
      isScrubbing,
      hoverTime,
      isAutoSkipEnabled,
      currentSkipInterval,
      showCCMenu,
      subtitleFontSize,
      subtitlePosition,
      availableSubtitles,
      activeSubtitleTrack,
      showSettings,
      showVolumeSlider,
      isBuffering,
      isSpeedBoostActive,
      useNativeControls,
    },
    actions: actions,
  }
}

export default useVideoPlayer
