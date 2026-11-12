import { profileStorage } from '../lib/profileStorage'
import { PlayerVideo } from '../components/player/PlayerMedia'
import React, { useRef, useEffect, useMemo, useCallback, useState, useLayoutEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import styles from '../components/player/Player.module.css'
import layoutStyles from '../components/player/PlayerPageLayout.module.css'
import shellStyles from '../components/player/UnifiedPlayer.module.css'
import Icon from '../components/common/Icon'
import FadeImage from '../components/common/FadeImage'
import { fixThumbnailUrl, formatTime } from '../lib/utils'
import {
  isProgressCompleted,
  isShowFinishedStatus,
  loadWatchedOverlayEnabled,
  storeAutoplayEnabled,
} from '../lib/playbackCompletion'
import { type SubtitleStyleSettings } from '../lib/subtitleStyle'
import { Modal } from '../components/common/Modal'
import CompletionModal from '../components/common/CompletionModal'
import { Button } from '../components/common/Button'
import MatureConsentModal from '../components/common/MatureConsentModal'
import ResumeModal from '../components/common/ResumeModal'
import { useMatureConsent } from '../hooks/useMatureConsent'
import useIsMobile from '../hooks/useIsMobile'
import { useTitlePreference } from '../contexts/TitlePreferenceContext'
import { useLowEndMode } from '../contexts/LowEndModeContext'
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
import { useAnime4KEpisodeCycle } from '../hooks/useAnime4KEpisodeCycle'
import useDelayCanvas from '../hooks/useDelayCanvas'
import { useAvSync } from '../hooks/useAvSync'
import { useTheaterMode } from '../hooks/useTheaterMode'
import { useAmbientLight } from '../hooks/useAmbientLight'
import AmbientLightCanvas from '../components/player/AmbientLightCanvas'
import AvSyncCalibrator from '../components/player/AvSyncCalibrator'
import { usePlayerData } from '../hooks/usePlayerData'
import { usePlayerShortcuts } from '../hooks/usePlayerShortcuts'
import { useEpisodeEndFlow, matchesQueueItem } from '../hooks/useEpisodeEndFlow'
import { useNextEpisodePrompt } from '../hooks/useNextEpisodePrompt'
import { usePlaybackEnd } from '../hooks/usePlaybackEnd'
import { useProviderFallback } from '../hooks/useProviderFallback'
import { useMediaSource } from '../hooks/useMediaSource'
import { useSubtitleTracks } from '../hooks/useSubtitleTracks'
import { useSubtitleCueLayout } from '../hooks/useSubtitleCueLayout'
import { useSubtitleOverlay } from '../hooks/useSubtitleOverlay'
import { savePreferredProvider } from '../reducers/playerReducer'

import { useQueue, useRemoveFromQueue, useClearQueue, useReorderQueue } from '../hooks/useAnimeData'
import type { VideoLink } from '../types/player'
import AnimeMetaDetails from '../components/anime/AnimeMetaDetails'
import SynopsisText from '../components/anime/SynopsisText'
import QueueOptionsButton from '../components/anime/QueueOptionsButton'

import { useProviders } from '../hooks/useProviders'
import { qk } from '../lib/queryKeys'
import { useWatchAlong } from '../contexts/WatchAlongContext'
import { useWatchAlongPlayer } from '../hooks/useWatchAlongPlayer'
import WatchAlongPanel from '../components/player/WatchAlongPanel'
import type { WatchSelection } from '../lib/watchAlong'

const Player: React.FC = () => {
  const { id: showId, episodeNumber } = useParams<{ id: string; episodeNumber?: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const location = useLocation()
  const watchAlong = useWatchAlong()
  const inRoom = !!watchAlong.session
  const followingHost = inRoom && !watchAlong.session?.host
  const { hasConsent: hasMatureConsent, grant: grantMatureConsent } = useMatureConsent()
  const { options: providerOptions } = useProviders()
  const animeOptions = useMemo(
    () =>
      providerOptions.filter(
        (option) => (option.kind ?? 'anime') === 'anime' || option.kind === 'hentai'
      ),
    [providerOptions]
  )
  const DIRECT_PROVIDER_ORDER: string[] = useMemo(
    () => animeOptions.map((option) => option.id),
    [animeOptions]
  )
  const MATURE_PROVIDERS = useMemo(
    () =>
      new Set(
        animeOptions
          .filter((option) => option.mature || option.kind === 'hentai')
          .map((option) => option.id)
      ),
    [animeOptions]
  )

  const requestedProvider =
    ((location.state as Record<string, unknown> | null)?.requestedProvider as string | undefined) ||
    new URLSearchParams(location.search).get('requestedProvider') ||
    undefined
  const playerInitialMeta = {
    ...((location.state as Record<string, unknown>) || {}),
    ...(requestedProvider ? { requestedProvider } : {}),
  }

  const {
    state,
    dispatch,
    toggleWatchlist,
    moveToCompleted,
    setPreferredSource,
    setPreferredLink,
    handleToggleDetails,
    resetEpisodeProgress,
    prefetchEpisodeSources,
    isResettingProgress,
    isUpdatingWatchlistStatus,
  } = usePlayerData(showId, episodeNumber, playerInitialMeta, {
    hasMatureConsent,
    watchSelection: followingHost ? watchAlong.room?.selection : null,
  })

  const [countdownNowMs, setCountdownNowMs] = useState(() => Date.now())
  const nextAiringAt = state.showMeta.nextAiring?.airingAt
  const nextAiringTarget = typeof nextAiringAt === 'number' ? nextAiringAt * 1000 : null
  useEffect(() => {
    if (nextAiringTarget == null || nextAiringTarget <= Date.now()) return
    const timer = setInterval(() => setCountdownNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [nextAiringTarget])

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
  const roomSelection = useMemo<WatchSelection | null>(() => {
    if (
      !showId ||
      showId.startsWith('dango-mt-') ||
      !state.currentEpisode ||
      state.selectedSource?.type === 'iframe' ||
      !state.selectedLink?.hls ||
      !state.selectedSource
    )
      return null
    return {
      showId,
      episode: state.currentEpisode,
      provider: state.selectedProvider,
      mode: state.currentMode,
      source: state.selectedSource.sourceName,
      title: state.showMeta.name || showId,
    }
  }, [
    showId,
    state.currentEpisode,
    state.selectedProvider,
    state.currentMode,
    state.selectedSource,
    state.selectedLink,
    state.showMeta.name,
  ])
  const roomPlayer = useWatchAlongPlayer(
    player.engine,
    roomSelection,
    state.loadingVideo || state.loadingShowData
  )

  const isMobile = useIsMobile()
  const episodeSidebarRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const subtitleOverlayRef = useRef<HTMLDivElement>(null)

  const [anime4kProfile, setAnime4kProfile] = useState<Anime4KProfile>(() => {
    try {
      const stored = profileStorage.getItem('anime4kProfile')
      return (['low', 'balanced', 'high', 'denoise'] as const).includes(stored as Anime4KProfile)
        ? (stored as Anime4KProfile)
        : 'balanced'
    } catch {
      return 'balanced'
    }
  })

  const {
    videoDelayMs,
    videoDelayEnabled,
    setDelayEnabled,
    handleVideoDelayChange,
    isCalibrating,
    testClipActive,
    stopCalibration,
    openAvSyncCalibrator,
    cancelAvSyncCalibrator,
    applyAvSyncCalibrator,
    toggleTestClip,
    calibReturnRef,
    effectiveVideoDelayMs,
  } = useAvSync(refs.videoRef, () => actions.setShowSettings(false))
  const delayCanvasRef = useRef<HTMLCanvasElement>(null)

  const [replayRequested, setReplayRequested] = useState(false)
  const [watchedResumeTime, setWatchedResumeTime] = useState<number | null>(null)
  useEffect(() => {
    setReplayRequested(false)
    setWatchedResumeTime(null)
  }, [showId, state.currentEpisode])

  const episodeKey = `${showId ?? ''}:${state.currentEpisode ?? ''}`
  const [watchedAtEntry, setWatchedAtEntry] = useState<{ key: string; watched: boolean } | null>(
    null
  )
  useEffect(() => {
    if (state.loadingVideo || state.videoSources.length === 0) return
    setWatchedAtEntry((prev) =>
      prev?.key === episodeKey
        ? prev
        : {
            key: episodeKey,
            watched: isProgressCompleted(state.resumeTime, state.resumeDuration),
          }
    )
  }, [
    episodeKey,
    state.loadingVideo,
    state.videoSources.length,
    state.resumeTime,
    state.resumeDuration,
  ])

  const episodeProgressCompleted = watchedAtEntry?.key === episodeKey && watchedAtEntry.watched
  const [watchedOverlayEnabled] = useState(loadWatchedOverlayEnabled)
  const [watchedPopupDismissed, setWatchedPopupDismissed] = useState(false)
  useEffect(() => {
    setWatchedPopupDismissed(false)
  }, [showId, state.currentEpisode])
  const watchedEpisodePrompt =
    !inRoom &&
    !testClipActive &&
    episodeProgressCompleted &&
    state.videoSources.length > 0 &&
    !replayRequested
  const showWatchedOverlay = watchedEpisodePrompt && watchedOverlayEnabled
  const showWatchedPopup = watchedEpisodePrompt && !watchedOverlayEnabled && !watchedPopupDismissed
  const handleReplayWatchedEpisode = useCallback(() => {
    setWatchedResumeTime(null)
    setReplayRequested(true)
  }, [])
  const handleResumeWatchedEpisode = useCallback(() => {
    setWatchedResumeTime(state.resumeTime)
    setReplayRequested(true)
  }, [state.resumeTime])

  const upscaler = useAnime4K({
    videoRef: refs.videoRef,
    canvasRef,
    profile: anime4kProfile,
    delayMs: effectiveVideoDelayMs,
  })

  const upscalerActive = upscaler.isEnabled && upscaler.isWebGPUSupported
  useAnime4KEpisodeCycle({
    videoRef: refs.videoRef,
    episodeKey: `${showId ?? ''}:${state.currentEpisode ?? ''}`,
    isEnabled: upscaler.isEnabled,
    isSupported: upscaler.isWebGPUSupported,
    mediaReady: !state.loadingVideo && !!state.selectedLink,
    isIframeSource: state.selectedSource?.type === 'iframe',
    setEnabled: upscaler.setEnabled,
  })
  useDelayCanvas({
    videoRef: refs.videoRef,
    canvasRef: delayCanvasRef,
    delayMs: effectiveVideoDelayMs,
    enabled: videoDelayEnabled && !upscalerActive,
  })
  const delayCanvasActive = videoDelayEnabled && !upscalerActive
  const canvasPresentationActive = upscalerActive || delayCanvasActive

  const [isEpisodeDrawerOpen, setIsEpisodeDrawerOpen] = useState(false)
  const episodeParamRef = useRef(episodeNumber)

  useEffect(() => {
    if (episodeParamRef.current !== episodeNumber) {
      episodeParamRef.current = episodeNumber
      stopCalibration()
    }
  }, [episodeNumber, stopCalibration])
  const invalidateContinueWatching = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [qk.continueWatching] })
  }, [queryClient])
  const { data: queue = [], isLoading: isQueueLoading } = useQueue()
  const removeQueue = useRemoveFromQueue()
  const clearQueue = useClearQueue()
  const reorderQueue = useReorderQueue()
  const { isTheaterMode, toggleTheaterMode, handleLayoutClick } = useTheaterMode()

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

  const isShowFinished = isShowFinishedStatus(state.showMeta?.status)
  const showCompletedState = !nextEpisode && isShowFinished
  const resumeIsPrimary = !nextEpisode && !showCompletedState

  const {
    showCompleteModal,
    queueCountdown,
    pendingQueueTransition,
    handleQueueTransition,
    handleNextEpisode,
    handleNShortcut,
    handlePreviousEpisode,
    handlePlaybackFinished,
    closeCompleteModal,
    cancelQueueTransition,
  } = useEpisodeEndFlow({
    testClipActive,
    selectedSourceType: state.selectedSource?.type,
    onEnded: actions.onEnded,
    queue,
    removeFromQueue: removeQueue.mutate,
    showId,
    showMetaId: state.showMeta?.id,
    showStatus: state.showMeta?.status,
    currentEpisode: state.currentEpisode,
    isAutoplayEnabled: !followingHost && state.isAutoplayEnabled,
    nextEpisode,
    previousEpisode,
    navigate,
    invalidateContinueWatching,
    dispatch,
  })

  const { showNextEpisodePrompt, handleThresholds } = useNextEpisodePrompt({
    videoRef: refs.videoRef,
    queue,
    showId,
    showMetaId: state.showMeta?.id,
    currentEpisode: state.currentEpisode,
    selectedSource: state.selectedSource,
    hasNextEpisode,
    nextEpisode,
    prefetchEpisodeSources,
    matchesQueueItem,
  })

  const { checkEnd, logDuration } = usePlaybackEnd({
    videoRef: refs.videoRef,
    sourceType: state.selectedSource?.type,
    resetKey: `${showId}:${state.currentEpisode}:${replayRequested}`,
    onEnd: followingHost ? actions.onEnded : handlePlaybackFinished,
  })

  const shouldShowResumeModal = !inRoom && state.showResumeModal && !state.resumeProgressPending
  const showCompleteOverlay = showCompleteModal && watchedOverlayEnabled
  const shouldShowCompleteModal = showCompleteModal && !watchedOverlayEnabled
  const shouldPauseForModal = shouldShowResumeModal || showCompleteModal || showWatchedPopup

  useAutoRotateFullscreen(
    player,
    !!state.selectedLink &&
      !isTheaterMode &&
      !shouldPauseForModal &&
      !showWatchedOverlay &&
      !showCompleteOverlay &&
      !showWatchedPopup
  )

  const {
    fallbackPrompt,
    isRetryingProvider,
    rememberFallbackChoice,
    setRememberFallbackChoice,
    fallbackChoice,
    updateFallbackChoice,
    dismissFallbackPrompt,
    chooseIframeFallback,
    chooseProviderRetry,
    handleVideoSourceError,
    resetFallback,
  } = useProviderFallback({
    showId,
    episodeNumber: state.currentEpisode ?? undefined,
    currentMode: state.currentMode,
    selectedProvider: state.selectedProvider,
    selectedSourceType: state.selectedSource?.type,
    videoSources: state.videoSources,
    isAdult: state.showMeta?.isAdult,
    providerOrder: DIRECT_PROVIDER_ORDER,
    matureProviders: MATURE_PROVIDERS,
    setPreferredSource,
    showControls: actions.setShowControls,
    dispatch,
  })

  const { seekToTimeRef } = useMediaSource({
    engine: player.engine,
    videoRef: refs.videoRef,
    selectedSource: state.selectedSource,
    selectedLink: state.selectedLink,
    loadingVideo: state.loadingVideo,
    testClipActive: !inRoom && testClipActive,
    resumeTime: inRoom ? 0 : state.resumeTime,
    resumeDuration: state.resumeDuration,
    showResumeModal: !inRoom && state.showResumeModal,
    disabled: showWatchedOverlay || showCompleteOverlay,
    startOver: replayRequested && watchedResumeTime == null,
    resumeAt: watchedResumeTime,
    calibReturnRef,
    setAvailableSubtitles: actions.setAvailableSubtitles,
    setActiveSubtitleTrack: actions.setActiveSubtitleTrack,
    onFatalError: inRoom ? () => {} : handleVideoSourceError,
  })

  useEffect(() => {
    if (
      (shouldPauseForModal || showWatchedOverlay || showCompleteOverlay) &&
      player.state.isFullscreen
    ) {
      player.actions.toggleFullscreen()
    }
  }, [
    shouldPauseForModal,
    showWatchedOverlay,
    showCompleteOverlay,
    player.state.isFullscreen,
    player.actions,
  ])

  useEffect(() => {
    if (shouldPauseForModal && refs.videoRef.current) {
      refs.videoRef.current.pause()
    }
  }, [shouldPauseForModal, refs.videoRef])

  const { titlePreference } = useTitlePreference()
  const { lowEndMode } = useLowEndMode()
  const { settings: ambientSettings, update: updateAmbient } = useAmbientLight()
  const ambientActive =
    isTheaterMode &&
    ambientSettings.enabled &&
    !lowEndMode &&
    state.selectedSource?.type !== 'iframe' &&
    !!state.selectedLink
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

  usePlayerShortcuts({
    onPrevious: followingHost ? () => {} : handlePreviousEpisode,
    onNext: followingHost ? () => {} : handleNShortcut,
    onToggleTheater: toggleTheaterMode,
    flashControls: player.actions.flashControls,
  })

  const { setAvailableSubtitles, setActiveSubtitleTrack } = actions

  const subtitleStyle = useMemo<SubtitleStyleSettings>(
    () => ({
      font: player.state.subtitleFont,
      fontSize: player.state.subtitleFontSize,
      position: player.state.subtitlePosition,
      bgOpacity: player.state.subtitleBgOpacity,
      bgColor: player.state.subtitleBgColor,
      textColor: player.state.subtitleTextColor,
      edge: player.state.subtitleEdge,
      outlineWidth: player.state.subtitleOutlineWidth,
      outlineColor: player.state.subtitleOutlineColor,
      bold: player.state.subtitleBold,
    }),
    [
      player.state.subtitleFont,
      player.state.subtitleFontSize,
      player.state.subtitlePosition,
      player.state.subtitleBgOpacity,
      player.state.subtitleBgColor,
      player.state.subtitleTextColor,
      player.state.subtitleEdge,
      player.state.subtitleOutlineWidth,
      player.state.subtitleOutlineColor,
      player.state.subtitleBold,
    ]
  )

  useSubtitleTracks({
    videoRef: refs.videoRef,
    availableSubtitles: player.state.availableSubtitles,
    activeSubtitleTrack: player.state.activeSubtitleTrack,
    setAvailableSubtitles,
    setActiveSubtitleTrack,
  })

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

  useSubtitleCueLayout({
    videoRef: refs.videoRef,
    videoBoxH,
    style: subtitleStyle,
    sourceKey: `${state.selectedSource?.sourceName ?? ''}:${state.selectedLink?.link ?? ''}`,
    activeSubtitleTrack: player.state.activeSubtitleTrack,
    availableSubtitles: player.state.availableSubtitles,
  })

  useSubtitleOverlay({
    videoRef: refs.videoRef,
    overlayRef: subtitleOverlayRef,
    style: subtitleStyle,
    activeSubtitleTrack: player.state.activeSubtitleTrack,
    delayMs: effectiveVideoDelayMs,
    enabled: canvasPresentationActive,
  })

  useEffect(() => {
    try {
      profileStorage.setItem('anime4kProfile', anime4kProfile)
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

  const handleCloseResumeModal = useCallback(() => {
    dispatch({ type: 'SET_STATE', payload: { showResumeModal: false } })
  }, [dispatch])

  const handleMoveToCompletedAndNavigate = useCallback(async () => {
    try {
      await moveToCompleted()
      closeCompleteModal()
      dispatch({ type: 'SET_STATE', payload: { showResumeModal: false } })
      navigate('/')
    } catch {
      // ignore
    }
  }, [moveToCompleted, closeCompleteModal, dispatch, navigate])

  const episodeNavControls = (className: string, variant: 'desktop' | 'mobile') => (
    <div className={className}>
      <button
        className={`${styles.episodeNavBtn} ${styles.secondary}`}
        onClick={handlePreviousEpisode}
        disabled={followingHost || !previousEpisode}
        type="button"
      >
        <Icon name="chevron-left" size={12} />
        Prev EP
      </button>
      <button
        className={`${styles.episodeNavBtn} ${styles.primary}`}
        onClick={handleNextEpisode}
        disabled={followingHost || !nextEpisode}
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

  const handleAutoplayChange = (checked: boolean) => {
    dispatch({ type: 'SET_STATE', payload: { isAutoplayEnabled: checked } })
    storeAutoplayEnabled(checked)
  }

  if (
    state.error &&
    !state.showMeta.name &&
    state.videoSources.length === 0 &&
    state.episodes.length === 0
  )
    return <p className="error-message">Error: {state.error}</p>

  const isVideoLoading = state.loadingShowData || state.loadingVideo

  const matureBlocked = state.showMeta?.isAdult === true && !hasMatureConsent

  if (matureBlocked) {
    return (
      <div className={layoutStyles.playerPageLayout}>
        <MatureConsentModal isOpen onClose={() => navigate('/home')} onGrant={grantMatureConsent} />
      </div>
    )
  }

  return (
    <div
      className={`${layoutStyles.playerPageLayout} ${isTheaterMode ? layoutStyles.theaterMode : ''}`}
      onClick={handleLayoutClick}
    >
      {isTheaterMode && (
        <AmbientLightCanvas
          videoRef={refs.videoRef}
          active={ambientActive}
          settings={ambientSettings}
        />
      )}
      <CompletionModal
        isOpen={shouldShowCompleteModal}
        onClose={closeCompleteModal}
        title="Show Completed!"
        heading={displayTitle}
        message="Congratulations! You finished all available episodes."
      >
        <Button onClick={handleMoveToCompletedAndNavigate} disabled={isUpdatingWatchlistStatus}>
          {isUpdatingWatchlistStatus ? 'Saving...' : 'Move to Completed'}
        </Button>
      </CompletionModal>

      <CompletionModal
        isOpen={showWatchedPopup}
        onClose={() => setWatchedPopupDismissed(true)}
        title={showCompletedState ? 'Show Completed!' : 'Episode Completed'}
        heading={state.currentEpisode ? `Episode ${state.currentEpisode}` : displayTitle}
        message={
          showCompletedState
            ? 'Congratulations! You finished all available episodes.'
            : "You've already watched this episode. Resume where you left off, replay it, or continue with the next episode."
        }
      >
        {state.resumeTime > 5 && (
          <Button
            variant={resumeIsPrimary ? undefined : 'secondary'}
            onClick={handleResumeWatchedEpisode}
          >
            {`Resume ${formatTime(state.resumeTime)}`}
          </Button>
        )}
        <Button variant="secondary" onClick={handleReplayWatchedEpisode}>
          Replay
        </Button>
        {nextEpisode && <Button onClick={handleNextEpisode}>{`Watch EP ${nextEpisode}`}</Button>}
        {showCompletedState && (
          <Button onClick={handleMoveToCompletedAndNavigate} disabled={isUpdatingWatchlistStatus}>
            {isUpdatingWatchlistStatus ? 'Saving...' : 'Move to Completed'}
          </Button>
        )}
      </CompletionModal>

      <ResumeModal
        isOpen={shouldShowResumeModal}
        onClose={handleCloseResumeModal}
        title="Resume Playback?"
        message={
          <>
            You were watching at <strong>{player.actions.formatTime(state.resumeTime)}</strong>.
            Would you like to continue?
          </>
        }
        onResume={handleResume}
        onRestart={handleStartOver}
      />

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
              onChange={(e) => setRememberFallbackChoice(e.currentTarget.checked)}
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

      {!isTheaterMode && (
        <aside ref={episodeSidebarRef} className={layoutStyles.episodeSidebar}>
          {state.loadingShowData ? (
            <EpisodeListSkeleton variant="sidebar" />
          ) : (
            <EpisodeList
              episodes={state.episodes}
              currentEpisode={state.currentEpisode ?? undefined}
              watchedEpisodes={state.watchedEpisodes}
              onEpisodeClick={(ep) => {
                if (!followingHost) navigate(`/watch/${showId}/${ep}`)
              }}
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
            ambientSettings={ambientSettings}
            onAmbientChange={updateAmbient}
            showNextEpisodeButton={
              !followingHost && !shouldPauseForModal && showNextEpisodePrompt && queue.length === 0
            }
            onNextEpisode={handleNextEpisode}
            videoSources={
              followingHost
                ? []
                : inRoom
                  ? state.videoSources.filter(
                      (source) => source.type !== 'iframe' && source.links.some((link) => link.hls)
                    )
                  : state.videoSources
            }
            selectedSource={state.selectedSource}
            selectedLink={state.selectedLink}
            onSourceChange={(source, link) => {
              if (
                (followingHost && source.sourceName !== watchAlong.room?.selection.source) ||
                (inRoom && (source.type === 'iframe' || !link.hls))
              )
                return
              if (refs.videoRef.current && !isNaN(refs.videoRef.current.currentTime)) {
                seekToTimeRef.current = refs.videoRef.current.currentTime
              }

              setPreferredSource(source.sourceName)
              void setPreferredLink(link.resolutionStr)
              dispatch({
                type: 'SET_STATE',
                payload: {
                  selectedSource: source,
                  selectedLink: link,
                  showResumeModal: state.showResumeModal && source.type !== 'iframe',
                },
              })
            }}
            loadingVideo={isVideoLoading}
            skipIntervals={state.skipIntervals}
            animeTitle={displayTitle}
            episodeNumber={state.currentEpisode ?? undefined}
            mode={state.currentMode}
            isTheaterMode={isTheaterMode}
            onTheaterModeToggle={toggleTheaterMode}
            anime4kEnabled={upscaler.isEnabled}
            onAnime4kToggle={upscaler.toggle}
            anime4kSupported={upscaler.isWebGPUSupported}
            anime4kProfile={anime4kProfile}
            onAnime4kProfileChange={setAnime4kProfile}
            anime4kInitializing={upscaler.isInitializing}
            anime4kError={upscaler.error}
            videoDelayEnabled={videoDelayEnabled}
            onVideoDelayToggle={setDelayEnabled}
            videoDelayMs={videoDelayMs}
            onVideoDelayChange={handleVideoDelayChange}
            onCalibrateAvSync={inRoom ? () => {} : openAvSyncCalibrator}
            isInteractingExtra={isEpisodeDrawerOpen || isCalibrating}
            className={shellStyles.shellFill}
            hideChrome={
              showWatchedOverlay || showCompleteOverlay || state.selectedSource?.type === 'iframe'
            }
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
            <>
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

              {state.selectedSource?.type === 'iframe' && !inRoom ? (
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
                    <PlayerVideo
                      controls={!player.state.playbackLocked && player.state.useNativeControls}
                      playsInline
                      webkit-playsinline="true"
                      disablePictureInPicture
                      disableRemotePlayback
                      onPlay={actions.onPlay}
                      onPause={actions.onPause}
                      onEnded={() => {
                        if (!testClipActive) checkEnd(true)
                      }}
                      onDurationChange={() => {
                        logDuration()
                      }}
                      onSeeked={() => {
                        if (testClipActive) return
                        handleThresholds()
                        checkEnd()
                      }}
                      onLoadedMetadata={() => {
                        handleThresholds()
                        logDuration()
                        if (!testClipActive) checkEnd()
                      }}
                      onTimeUpdate={() => {
                        if (testClipActive) return
                        actions.onTimeUpdate()
                        handleThresholds()
                        checkEnd()
                        if (
                          pendingQueueTransition &&
                          refs.videoRef.current &&
                          refs.videoRef.current.currentTime < refs.videoRef.current.duration - 1
                        ) {
                          cancelQueueTransition()
                        }
                      }}
                      onError={inRoom ? undefined : handleVideoSourceError}
                      onContextMenu={(e) => e.preventDefault()}
                      className={canvasPresentationActive ? styles.videoElementHidden : ''}
                    />
                  )}
                  {upscaler.isWebGPUSupported &&
                    !isVideoLoading &&
                    state.videoSources.length > 0 && (
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
              {(showWatchedOverlay || showCompleteOverlay) && (
                <div className={styles.watchedOverlay}>
                  <Icon name="check-circle" size={48} style={{ color: 'var(--accent-lighter)' }} />
                  <p className={styles.watchedTitle}>
                    {showCompletedState
                      ? 'Show Completed!'
                      : state.currentEpisode
                        ? `Episode ${state.currentEpisode} watched`
                        : 'Watched'}
                  </p>
                  <p className={styles.watchedSubtext}>
                    {showCompletedState
                      ? 'Congratulations! You finished all available episodes.'
                      : 'Resume where you left off, replay from the beginning, or continue with the next episode.'}
                  </p>
                  <div
                    className={`${styles.watchedActions} ${showCompleteOverlay ? styles.watchedActionsCentered : ''}`}
                  >
                    <div>
                      {state.resumeTime > 5 && !showCompleteOverlay && (
                        <Button
                          variant={resumeIsPrimary ? undefined : 'secondary'}
                          onClick={handleResumeWatchedEpisode}
                        >
                          {`Resume ${formatTime(state.resumeTime)}`}
                        </Button>
                      )}
                    </div>
                    <div>
                      {nextEpisode && (
                        <Button onClick={handleNextEpisode}>{`Watch EP ${nextEpisode}`}</Button>
                      )}
                      {showCompletedState && (
                        <Button
                          onClick={handleMoveToCompletedAndNavigate}
                          disabled={isUpdatingWatchlistStatus}
                        >
                          {isUpdatingWatchlistStatus ? 'Saving...' : 'Move to Completed'}
                        </Button>
                      )}
                    </div>
                    <div>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          closeCompleteModal()
                          handleReplayWatchedEpisode()
                        }}
                      >
                        Replay
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          </PlayerControls>
        </div>

        <WatchAlongPanel
          playback={
            roomSelection && !isVideoLoading
              ? {
                  selection: roomSelection,
                  position: refs.videoRef.current?.currentTime || 0,
                  playing: false,
                  rate: player.engine.getState().playbackRate,
                }
              : null
          }
          onCreate={() => {
            stopCalibration()
            player.engine.pause()
          }}
          needsPlayback={roomPlayer.needsPlayback}
          onEnablePlayback={roomPlayer.enablePlayback}
        />
        {inRoom && !isVideoLoading && !roomSelection && (
          <p role="alert">
            This room requires the host's direct HLS source. It is unavailable here. Retry the
            episode or leave the room to use another source.
          </p>
        )}

        {!isTheaterMode && <PlayerStatusArea />}

        {!isTheaterMode && (
          <>
            <div className={styles.streamPanel}>
              {!followingHost && (
                <ProviderSelector
                  selectedProvider={state.selectedProvider}
                  isAdult={state.showMeta?.isAdult}
                  options={animeOptions}
                  onProviderChange={(newProvider) => {
                    resetFallback()
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
                    savePreferredProvider(newProvider, state.showMeta?.isAdult === true)
                  }}
                />
              )}
              {episodeNavControls(
                `${styles.episodeActions} ${styles.desktopEpisodeActions}`,
                'desktop'
              )}

              {isVideoLoading ? (
                <div className={styles.sourceLoader}>
                  <div className={styles.spinner}></div>
                </div>
              ) : !followingHost ? (
                <SourceSelector
                  videoSources={
                    inRoom
                      ? state.videoSources.filter(
                          (source) =>
                            source.type !== 'iframe' && source.links.some((link) => link.hls)
                        )
                      : state.videoSources
                  }
                  selectedSource={state.selectedSource}
                  selectedLink={state.selectedLink}
                  onSourceChange={(source) => {
                    if (
                      inRoom &&
                      (source.type === 'iframe' || !source.links.some((link) => link.hls))
                    )
                      return
                    if (refs.videoRef.current && !isNaN(refs.videoRef.current.currentTime)) {
                      seekToTimeRef.current = refs.videoRef.current.currentTime
                    }

                    const links = inRoom
                      ? source.links.filter((link) => link.hls)
                      : source.links || []
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
                    void setPreferredLink(link.resolutionStr)
                    dispatch({
                      type: 'SET_STATE',
                      payload: { selectedLink: link },
                    })
                  }}
                />
              ) : (
                <p>
                  Provider: {state.selectedProvider} · Source: {watchAlong.room?.selection.source} ·{' '}
                  {state.currentMode}
                </p>
              )}
            </div>

            {isQueueLoading && queue.length === 0 ? (
              <QueueRailSkeleton count={3} />
            ) : (
              <QueueRail
                title="Queue"
                items={queue}
                currentShowId={showId}
                currentEpisode={state.currentEpisode ?? undefined}
                onNextQueue={followingHost ? () => {} : handleQueueTransition}
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

            <div className={layoutStyles.playerInfoContainer}>
              <div className={layoutStyles.playerInfoHeader}>
                <div className={layoutStyles.playerAnimeCard}>
                  <FadeImage
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
                      {state.showMeta.nextEpisodeAirDate &&
                        (() => {
                          const nextAiring = state.showMeta.nextAiring
                          const target = nextAiringAt != null ? nextAiringAt * 1000 : null
                          let tick = ''
                          if (target != null) {
                            let diff = Math.floor((target - countdownNowMs) / 1000)
                            if (diff <= 0) return null
                            const days = Math.floor(diff / 86400)
                            diff %= 86400
                            const hours = Math.floor(diff / 3600)
                            diff %= 3600
                            const minutes = Math.floor(diff / 60)
                            const seconds = diff % 60
                            tick = `in ${days}d ${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
                          }
                          const ep = nextAiring?.episode != null ? `E${nextAiring.episode} · ` : ''
                          return (
                            <span className={styles.nextEpisode}>
                              Next episode: {ep}
                              {state.showMeta.nextEpisodeAirDate}
                              {tick ? ` · ${tick}` : ''}
                            </span>
                          )
                        })()}
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
                    <button
                      className={`${styles.watchlistBtn} ${styles.modeToggleBtn} ${state.currentMode === 'dub' ? styles.modeToggleActive : ''}`}
                      disabled={followingHost}
                      onClick={() => {
                        const mode = state.currentMode === 'dub' ? 'sub' : 'dub'
                        resetFallback()
                        dispatch({ type: 'SET_MODE', payload: mode })
                        profileStorage.setItem('preferredMode', mode)
                      }}
                      type="button"
                      aria-pressed={state.currentMode === 'dub'}
                    >
                      {state.currentMode === 'dub' ? 'DUB' : 'SUB'}
                    </button>
                    <button
                      className={`${styles.watchlistBtn} ${styles.modeToggleBtn}`}
                      onClick={() =>
                        state.currentEpisode && resetEpisodeProgress(state.currentEpisode)
                      }
                      disabled={isResettingProgress || !state.currentEpisode}
                      type="button"
                    >
                      <Icon name="undo" size={14} />
                      {isResettingProgress ? 'Resetting...' : 'Reset Progress'}
                    </button>
                  </div>
                </div>
              </div>

              {episodeNavControls(
                `${styles.episodeActions} ${styles.mobileEpisodeActions}`,
                'mobile'
              )}

              <div className={layoutStyles.infoColumns}>
                <div className={`${styles.descriptionSection} ${styles.synopsisFlat}`}>
                  <h3>Synopsis</h3>
                  <SynopsisText
                    text={
                      state.showMeta.description
                        ? state.showMeta.description.replace(/<[^>]*>?/gm, '')
                        : ''
                    }
                    emptyText="No description available."
                  />
                  <button className={styles.detailsToggleBtn} onClick={handleToggleDetails}>
                    {state.showCombinedDetails ? (
                      <Icon name="chevron-up" />
                    ) : (
                      <Icon name="chevron-down" />
                    )}
                    {state.showCombinedDetails ? 'Hide Details' : 'Show Details'}
                  </button>
                </div>

                {state.showCombinedDetails && (
                  <AnimeMetaDetails showMeta={state.showMeta} styles={styles} />
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <EpisodeDrawer
        isOpen={isEpisodeDrawerOpen}
        onClose={() => setIsEpisodeDrawerOpen(false)}
        episodes={state.episodes}
        currentEpisode={state.currentEpisode ?? undefined}
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
