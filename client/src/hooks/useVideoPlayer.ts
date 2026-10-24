import { profileStorage } from '../lib/profileStorage'
import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { usePlayerCore, usePlayerState } from '../lib/player/usePlayerCore'
import { useQueryClient } from '@tanstack/react-query'
import type { SkipInterval, SubtitleTrack } from '../types/player'
import { formatTime } from '../lib/utils'
import { trpcClient, useTRPC } from '../lib/trpc'
import { clearDiscordPresence, trpcKeepalive } from '../lib/trpcBeacon'
import {
  loadSubtitleStyle,
  SUBTITLE_STYLE_STORAGE_KEYS,
  type SubtitleEdge,
  type SubtitleStyleKey,
} from '../lib/subtitleStyle'
import { qk } from '../lib/queryKeys'
import { isProgressCompleted } from '../lib/playbackCompletion'

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
  const trpc = useTRPC()
  const { engine, mediaRef: videoRef } = usePlayerCore({
    volumeKey: 'playerVolume',
    mutedKey: 'playerMuted',
  })
  const {
    isPlaying,
    isMuted,
    volume,
    duration,
    isScrubbing,
    isBuffering,
    isFullscreen,
    isSpeedBoostActive,
    showControls,
    playbackLocked,
  } = usePlayerState(engine)
  const playerContainerRef = engine.containerRef
  const debouncedUpdateTimer = useRef<NodeJS.Timeout | null>(null)
  const lastThrottledUpdateTime = useRef(0)

  const sessionIdRef = useRef(Math.random().toString(36).substring(2))

  const setShowControls = engine.setShowControls
  const [isAutoSkipEnabled, setIsAutoSkipEnabled] = useState(
    profileStorage.getItem('autoSkipEnabled') === 'true'
  )
  const [currentSkipInterval, setCurrentSkipInterval] = useState<SkipInterval | null>(null)
  const [initialSubtitleStyle] = useState(loadSubtitleStyle)
  const [subtitleFontSize, setSubtitleFontSize] = useState(initialSubtitleStyle.fontSize)
  const [subtitlePosition, setSubtitlePosition] = useState(initialSubtitleStyle.position)
  const [subtitleBgOpacity, setSubtitleBgOpacity] = useState(initialSubtitleStyle.bgOpacity)
  const [subtitleBgColor, setSubtitleBgColor] = useState(initialSubtitleStyle.bgColor)
  const [subtitleTextColor, setSubtitleTextColor] = useState(initialSubtitleStyle.textColor)
  const [subtitleEdge, setSubtitleEdge] = useState<SubtitleEdge>(initialSubtitleStyle.edge)
  const [subtitleBold, setSubtitleBold] = useState(initialSubtitleStyle.bold)
  // one action for the 7 style fields, the persistence lives here too
  const setSubtitleStyle = useCallback(
    (key: SubtitleStyleKey, value: number | string | boolean) => {
      const setters: Record<SubtitleStyleKey, (v: number | string | boolean) => boolean> = {
        fontSize: (v) => {
          if (typeof v !== 'number') return false
          setSubtitleFontSize(v)
          return true
        },
        position: (v) => {
          if (typeof v !== 'number') return false
          setSubtitlePosition(v)
          return true
        },
        bgOpacity: (v) => {
          if (typeof v !== 'number') return false
          setSubtitleBgOpacity(v)
          return true
        },
        bgColor: (v) => {
          if (typeof v !== 'string') return false
          setSubtitleBgColor(v)
          return true
        },
        textColor: (v) => {
          if (typeof v !== 'string') return false
          setSubtitleTextColor(v)
          return true
        },
        edge: (v) => {
          if (v !== 'shadow' && v !== 'outline' && v !== 'none') return false
          setSubtitleEdge(v)
          return true
        },
        bold: (v) => {
          if (typeof v !== 'boolean') return false
          setSubtitleBold(v)
          return true
        },
      }
      if (!setters[key](value)) return
      try {
        profileStorage.setItem(SUBTITLE_STYLE_STORAGE_KEYS[key], String(value))
      } catch {
        // ignore
      }
    },
    []
  )
  const [availableSubtitles, setAvailableSubtitles] = useState<SubtitleTrack[]>([])
  const [activeSubtitleTrack, setActiveSubtitleTrack] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showVolumeSlider, setShowVolumeSlider] = useState(false)
  const [useNativeControls, setUseNativeControls] = useState(() => {
    try {
      return profileStorage.getItem('playerUseNativeControls') === 'true'
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
      currentTime: engine.getTimeline().currentTime,
      duration: engine.getState().duration,
      showName: showMeta.name,
      showThumbnail: showMeta.thumbnail,
      nativeName: showMeta.names?.native,
      englishName: showMeta.names?.english,
      genres: Array.isArray(showMeta.genres)
        ? showMeta.genres.map((g) => (typeof g === 'string' ? g : g?.name)).filter(Boolean)
        : undefined,
      popularityScore: showMeta.score,
      type: showMeta.type,
      isPlaying: video ? !video.paused : sourceType === 'iframe',
      sessionId: sessionIdRef.current,
      isAdult: showMeta.isAdult,
    }
  }, [engine, videoRef, showId, episodeNumber, episodeCount, showMeta, sourceType])

  const sendProgressUpdate = useCallback(
    (isFinalUpdate = false, force = false) => {
      if (hasEnded.current) return false

      const payload = buildProgressPayload()
      if (!payload) return false

      const video = videoRef.current
      if (!video && !isFinalUpdate && sourceType !== 'iframe') return false
      if (sourceType !== 'iframe' && payload.duration <= 0) return false

      const timeToReport = engine.getTimeline().currentTime

      if (!force) {
        if (timeToReport === 0) return false

        const timeDiff = video ? Math.abs(timeToReport - lastReportedTime.current) : 0
        if (!isFinalUpdate && video && timeToReport !== video.duration && timeDiff < 5) {
          return false
        }
      }

      payload.currentTime = timeToReport
      lastReportedTime.current = timeToReport

      const saveProgress = async () => {
        try {
          await trpcKeepalive('progress.updateProgress', payload)
          queryClient.invalidateQueries({ queryKey: [qk.playerData, showId] })
          queryClient.invalidateQueries({ queryKey: [qk.videoSources, showId, episodeNumber] })
          queryClient.invalidateQueries({ queryKey: [qk.continueWatching] })
          queryClient.invalidateQueries({ queryKey: [qk.thisWeekSchedule] })
          void queryClient.invalidateQueries(trpc.continueWatching.pathFilter())
        } catch (err) {
          console.error('Failed to update progress:', err)
        }
      }

      if (isFinalUpdate) {
        saveProgress()
      } else {
        trpcKeepalive('progress.updateProgress', payload)
          .then(() => {
            if (isProgressCompleted(payload.currentTime, payload.duration)) {
              void queryClient.invalidateQueries({ queryKey: [qk.playerData, showId] })
            }
          })
          .catch((err) => console.error('Failed to update progress:', err))
      }

      return true
    },
    [
      engine,
      buildProgressPayload,
      sourceType,
      queryClient,
      showId,
      episodeNumber,
      trpc.continueWatching,
      videoRef,
    ]
  )

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!hasEnded.current) {
        sendProgressUpdate(true)
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', handleBeforeUnload)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') handleBeforeUnload()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const debounceTimer = debouncedUpdateTimer
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('pagehide', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (!hasEnded.current) {
        sendProgressUpdate(true)
      }
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [sendProgressUpdate])

  const flashControls = useCallback(() => engine.setShowControls(true), [engine])

  const toggleFullscreen = engine.toggleFullscreen
  const togglePlay = useCallback(() => {
    engine.togglePlay()
    setShowControls(true)
  }, [engine, setShowControls])
  const toggleMute = useCallback(() => {
    engine.toggleMute()
    setShowControls(true)
  }, [engine, setShowControls])
  const seek = useCallback(
    (seconds: number) => {
      engine.seekRelative(seconds)
      if (debouncedUpdateTimer.current) clearTimeout(debouncedUpdateTimer.current)
      debouncedUpdateTimer.current = setTimeout(() => sendProgressUpdate(false, true), 1500)
      setShowControls(true)
    },
    [engine, sendProgressUpdate, setShowControls]
  )
  const onPlay = useCallback(() => {
    hasEnded.current = false
    sendProgressUpdate(false, true)
  }, [sendProgressUpdate])
  const onPause = useCallback(() => {
    setShowControls(true)
    sendProgressUpdate(false, true)
  }, [sendProgressUpdate, setShowControls])

  useEffect(() => {
    hasEnded.current = false
    lastReportedTime.current = -1
    lastThrottledUpdateTime.current = 0
    sessionIdRef.current = Math.random().toString(36).substring(2)
    engine.reset()
  }, [engine, showId, episodeNumber])

  const resetMediaState = engine.reset

  useEffect(() => {
    const sessionId = sessionIdRef.current
    return () => {
      clearDiscordPresence(sessionId)
    }
  }, [engine, showId, episodeNumber])

  useEffect(() => {
    if (sourceType !== 'iframe') return

    sendProgressUpdate(false, true)

    const heartbeatInterval = setInterval(() => {
      sendProgressUpdate(false, true)
    }, 60000)

    return () => clearInterval(heartbeatInterval)
  }, [sourceType, sendProgressUpdate])

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const time = video.currentTime || 0
    const now = Date.now()
    const crossedCompletionThreshold =
      isProgressCompleted(time, video.duration) &&
      !isProgressCompleted(lastReportedTime.current, video.duration)
    if (
      (crossedCompletionThreshold || now - lastThrottledUpdateTime.current > 60000) &&
      sendProgressUpdate(false, crossedCompletionThreshold)
    ) {
      lastThrottledUpdateTime.current = now
    }
    const activeSkip =
      skipIntervals.find((interval) => time >= interval.start_time && time < interval.end_time) ||
      null

    setCurrentSkipInterval((prev) => {
      if (prev?.skip_id !== activeSkip?.skip_id) return activeSkip
      return prev
    })
    if (isAutoSkipEnabled && activeSkip && !video.paused && !engine.getState().playbackLocked) {
      engine.seek(activeSkip.end_time)
      setCurrentSkipInterval(null)
    }
  }, [videoRef, skipIntervals, isAutoSkipEnabled, sendProgressUpdate, engine])

  const reportFinalProgress = useCallback(() => {
    const payload = buildProgressPayload()
    if (!payload) return

    payload.currentTime = payload.duration

    trpcClient.progress.updateProgress
      .mutate(payload)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: [qk.playerData, showId] })
        queryClient.invalidateQueries({ queryKey: [qk.videoSources, showId, episodeNumber] })
        queryClient.invalidateQueries({ queryKey: [qk.continueWatching] })
      })
      .catch((err) => console.error('Failed to send final progress:', err))
  }, [buildProgressPayload, queryClient, showId, episodeNumber])

  const onEnded = useCallback(() => {
    hasEnded.current = true
    reportFinalProgress()
  }, [reportFinalProgress])

  const actions = useMemo(
    () => ({
      togglePlay,
      seek,
      toggleMute,
      toggleFullscreen,
      onPlay,
      onPause,
      formatTime,
      onTimeUpdate,
      onEnded,
      setShowControls,
      setIsAutoSkipEnabled,
      setCurrentSkipInterval,
      setSubtitleFontSize,
      setSubtitlePosition,
      setSubtitleBgOpacity,
      setSubtitleBgColor,
      setSubtitleTextColor,
      setSubtitleEdge,
      setSubtitleBold,
      setSubtitleStyle,
      setAvailableSubtitles,
      setActiveSubtitleTrack,
      setShowSettings,
      setShowVolumeSlider,
      flashControls,
      sendProgressUpdate,
      setUseNativeControls,
      resetMediaState,
    }),
    [
      togglePlay,
      seek,
      toggleMute,
      toggleFullscreen,
      onPlay,
      onPause,
      onTimeUpdate,
      onEnded,
      sendProgressUpdate,
      setUseNativeControls,
      resetMediaState,
      flashControls,
      setSubtitleStyle,
      setShowControls,
    ]
  )

  return {
    engine,
    refs: { videoRef, playerContainerRef },
    state: {
      playbackLocked,
      isPlaying,
      isMuted,
      volume,
      isFullscreen,
      duration,
      showControls,
      isScrubbing,
      isAutoSkipEnabled,
      currentSkipInterval,
      subtitleFontSize,
      subtitlePosition,
      subtitleBgOpacity,
      subtitleBgColor,
      subtitleTextColor,
      subtitleEdge,
      subtitleBold,
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
