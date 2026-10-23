import { PlayerVideo } from '../components/player/PlayerMedia'
import React, { useRef, useEffect, useMemo, useCallback, useState, useLayoutEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import styles from '../components/player/Player.module.css'
import layoutStyles from '../components/player/PlayerPageLayout.module.css'
import shellStyles from '../components/player/UnifiedPlayer.module.css'
import Icon from '../components/common/Icon'
import { fixThumbnailUrl } from '../lib/utils'
import { storeAutoplayEnabled } from '../lib/playbackCompletion'
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
import AnimePaheCookieModal from '../components/anime/AnimePaheCookieModal'
import MkissaVerificationModal from '../components/anime/MkissaVerificationModal'
import QueueOptionsButton from '../components/anime/QueueOptionsButton'

import { useProviders } from '../hooks/useProviders'
import { qk } from '../lib/queryKeys'

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
    () => animeOptions.map((option) => option.id),
    [animeOptions]
  )
  const MATURE_PROVIDERS = useMemo(
    () => new Set(animeOptions.filter((option) => option.mature).map((option) => option.id)),
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

  const isMobile = useIsMobile()
  const episodeSidebarRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const subtitleOverlayRef = useRef<HTMLDivElement>(null)

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
    currentEpisode: state.currentEpisode,
    isAutoplayEnabled: state.isAutoplayEnabled,
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
    resetKey: `${showId}:${state.currentEpisode}`,
    onEnd: handlePlaybackFinished,
  })

  const shouldShowResumeModal = state.showResumeModal
  const shouldShowCompleteModal = showCompleteModal
  const shouldPauseForModal = shouldShowResumeModal || shouldShowCompleteModal

  useAutoRotateFullscreen(player, !!state.selectedLink && !isTheaterMode && !shouldPauseForModal)

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
    testClipActive,
    resumeTime: state.resumeTime,
    showResumeModal: state.showResumeModal,
    calibReturnRef,
    setAvailableSubtitles: actions.setAvailableSubtitles,
    setActiveSubtitleTrack: actions.setActiveSubtitleTrack,
    onFatalError: handleVideoSourceError,
  })

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
    onNext: handleNShortcut,
    onToggleTheater: toggleTheaterMode,
    flashControls: player.actions.flashControls,
  })

  const { setAvailableSubtitles, setActiveSubtitleTrack } = actions

  const subtitleStyle = useMemo<SubtitleStyleSettings>(
    () => ({
      fontSize: player.state.subtitleFontSize,
      position: player.state.subtitlePosition,
      bgOpacity: player.state.subtitleBgOpacity,
      bgColor: player.state.subtitleBgColor,
      textColor: player.state.subtitleTextColor,
      edge: player.state.subtitleEdge,
      bold: player.state.subtitleBold,
    }),
    [
      player.state.subtitleFontSize,
      player.state.subtitlePosition,
      player.state.subtitleBgOpacity,
      player.state.subtitleBgColor,
      player.state.subtitleTextColor,
      player.state.subtitleEdge,
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

  const handleAutoplayChange = (checked: boolean) => {
    dispatch({ type: 'SET_STATE', payload: { isAutoplayEnabled: checked } })
    storeAutoplayEnabled(checked)
  }

  const isCurrentEpisodeWatched = !!(
    state.currentEpisode && state.watchedEpisodes.includes(state.currentEpisode)
  )

  const showManualWatchedButton =
    state.selectedProvider !== 'megaplay' || state.selectedSource?.type === 'iframe'

  const handleMarkEpisodeWatched = useCallback(async () => {
    if (!showId || !state.currentEpisode || !state.showMeta.name || isMarkingWatched) return

    const videoDuration = refs.videoRef.current?.duration
    const fallbackDuration = Math.max(
      videoDuration || 0,
      state.resumeDuration || 0,
      Number(state.showMeta.episodeDuration || 0) * 60,
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
        <Button variant="secondary" onClick={closeCompleteModal}>
          Close
        </Button>
        <Button onClick={handleMoveToCompletedAndNavigate} disabled={isUpdatingWatchlistStatus}>
          {isUpdatingWatchlistStatus ? 'Saving...' : 'Move to Completed'}
        </Button>
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

      <AnimePaheCookieModal
        isOpen={!!state.showCookieModal && state.cookieProvider !== 'mkissa'}
        onClose={() => dispatch({ type: 'SET_STATE', payload: { showCookieModal: false } })}
        onSuccess={() => {
          queryClient.invalidateQueries({
            queryKey: [
              qk.videoSources,
              showId,
              state.currentEpisode,
              state.selectedProvider,
              state.currentMode,
            ],
          })
        }}
      />

      <MkissaVerificationModal
        isOpen={!!state.showCookieModal && state.cookieProvider === 'mkissa'}
        onClose={() => dispatch({ type: 'SET_STATE', payload: { showCookieModal: false } })}
        onSuccess={() => {
          queryClient.invalidateQueries({
            queryKey: [
              qk.videoSources,
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
              currentEpisode={state.currentEpisode ?? undefined}
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
            ambientSettings={ambientSettings}
            onAmbientChange={updateAmbient}
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
            loadingVideo={isVideoLoading}
            skipIntervals={state.skipIntervals}
            animeTitle={displayTitle}
            episodeNumber={state.currentEpisode ?? undefined}
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
                  <PlayerVideo
                    controls={player.state.useNativeControls}
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
                currentEpisode={state.currentEpisode ?? undefined}
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

            <div className={styles.streamPanel}>
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
              {episodeNavControls(
                `${styles.episodeActions} ${styles.desktopEpisodeActions}`,
                'desktop'
              )}

              {isVideoLoading ? (
                <div className={styles.sourceLoader}>
                  <div className={styles.spinner}></div>
                </div>
              ) : (
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
              )}
            </div>

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
                        resetFallback()
                        dispatch({ type: 'SET_MODE', payload: mode })
                        localStorage.setItem('preferredMode', mode)
                      }}
                      type="button"
                      aria-pressed={state.currentMode === 'dub'}
                    >
                      {state.currentMode === 'dub' ? 'DUB' : 'SUB'}
                    </button>
                    {lowEndMode && (
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
                    )}
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
