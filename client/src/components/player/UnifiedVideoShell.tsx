import React, { useCallback, useEffect, useRef } from 'react'
import shellStyles from './UnifiedPlayer.module.css'
import useCoarsePointer from '../../hooks/useCoarsePointer'
import type useVideoPlayer from '../../hooks/useVideoPlayer'

interface UnifiedVideoShellProps {
  player: ReturnType<typeof useVideoPlayer>
  topBar: React.ReactNode
  centerControls?: React.ReactNode
  bottomBar: React.ReactNode
  settingsPanel?: React.ReactNode
  overlays?: React.ReactNode
  isInteracting?: boolean
  className?: string
  chromeDisabled?: boolean
  children: React.ReactNode
}

const TAP_DOUBLE_MS = 280

function isUiTarget(target: HTMLElement | null): boolean {
  if (!target) return false
  return !!target.closest(
    'button, input, select, textarea, a, [role="button"], [data-player-ui="true"]'
  )
}

const UnifiedVideoShell: React.FC<UnifiedVideoShellProps> = ({
  player,
  topBar,
  centerControls,
  bottomBar,
  settingsPanel,
  overlays,
  isInteracting = false,
  className,
  chromeDisabled = false,
  children,
}) => {
  const { state, refs, actions } = player
  const containerRef = refs.playerContainerRef
  const isCoarse = useCoarsePointer()
  const hideDelayMs = isCoarse ? 5000 : 3000
  const lastTapRef = useRef(0)
  const singleTapTimer = useRef<number | null>(null)
  const interactingRef = useRef(isInteracting)
  interactingRef.current = isInteracting

  const clearHideTimer = useCallback(() => {
    const t = actions.inactivityTimer.current
    if (t) {
      window.clearTimeout(t)
      actions.inactivityTimer.current = null
    }
  }, [actions])

  const scheduleHide = useCallback(() => {
    clearHideTimer()
    if (!state.isPlaying) return
    if (interactingRef.current) return
    if (state.useNativeControls) return
    actions.inactivityTimer.current = window.setTimeout(() => {
      if (interactingRef.current) return
      actions.setShowControls(false)
      const container = containerRef.current
      if (container && state.isFullscreen) container.style.cursor = 'none'
    }, hideDelayMs)
  }, [
    actions,
    clearHideTimer,
    containerRef,
    hideDelayMs,
    state.isFullscreen,
    state.isPlaying,
    state.useNativeControls,
  ])

  const wake = useCallback(() => {
    const container = containerRef.current
    if (container) container.style.cursor = 'default'
    if (!state.showControls && !state.useNativeControls) actions.setShowControls(true)
    scheduleHide()
  }, [actions, containerRef, scheduleHide, state.showControls, state.useNativeControls])

  useEffect(() => {
    if (!state.showControls) return
    if (!state.isPlaying) {
      clearHideTimer()
      return
    }
    if (isInteracting || state.isScrubbing || state.showSettings || state.showVolumeSlider) {
      actions.setShowControls(true)
      clearHideTimer()
      return
    }
    scheduleHide()
  }, [
    actions,
    clearHideTimer,
    isInteracting,
    scheduleHide,
    state.isPlaying,
    state.isScrubbing,
    state.showControls,
    state.showSettings,
    state.showVolumeSlider,
  ])

  useEffect(() => () => clearHideTimer(), [clearHideTimer])

  const handleStageClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (isUiTarget(target)) return
      const now = Date.now()
      const isDouble = now - lastTapRef.current < TAP_DOUBLE_MS
      lastTapRef.current = now
      if (isDouble) {
        if (singleTapTimer.current) {
          window.clearTimeout(singleTapTimer.current)
          singleTapTimer.current = null
        }
        actions.toggleFullscreen()
        return
      }
      if (singleTapTimer.current) window.clearTimeout(singleTapTimer.current)
      singleTapTimer.current = window.setTimeout(() => {
        singleTapTimer.current = null
        actions.setShowControls(!state.showControls)
        if (state.showControls) scheduleHide()
        else wake()
      }, TAP_DOUBLE_MS)
    },
    [actions, scheduleHide, state.showControls, wake]
  )

  useEffect(
    () => () => {
      if (singleTapTimer.current) window.clearTimeout(singleTapTimer.current)
    },
    []
  )

  const controlsVisible =
    state.showControls || state.isScrubbing || state.showSettings || state.showVolumeSlider

  return (
    <div
      ref={containerRef}
      className={`${shellStyles.shell} ${state.isFullscreen ? shellStyles.shellFullscreen : ''} ${className ?? ''}`}
      onContextMenu={(e) => e.preventDefault()}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') wake()
      }}
      onMouseLeave={() => {
        if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
          if (state.isPlaying && !interactingRef.current) actions.setShowControls(false)
        }
      }}
    >
      <div
        className={shellStyles.stage}
        onClick={handleStageClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        {children}
      </div>

      {overlays}

      {!chromeDisabled && !state.useNativeControls && (
        <div className={shellStyles.uiLayer} onContextMenu={(e) => e.preventDefault()}>
          <div data-player-ui="true">{topBar}</div>
          {controlsVisible && centerControls && <div data-player-ui="true">{centerControls}</div>}
          <div data-player-ui="true">{bottomBar}</div>
          {settingsPanel && <div data-player-ui="true">{settingsPanel}</div>}
        </div>
      )}
    </div>
  )
}

export default UnifiedVideoShell
