import { useCallback, useEffect, useRef } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import type { PlayerEngine } from '../../lib/player/engine'
import { usePlayerState } from '../../lib/player/usePlayerCore'
import { usePlayerInput } from '../../lib/player/usePlayerInput'
import useCoarsePointer from '../../hooks/useCoarsePointer'
import { PlayerProvider } from './PlayerProvider'
import { PlayerStatus } from './PlaybackControls'
import styles from './UnifiedPlayer.module.css'

interface PlayerSurfaceProps {
  engine: PlayerEngine
  topBar?: ReactNode
  centerControls?: ReactNode
  bottomBar?: ReactNode
  settingsPanel?: ReactNode
  overlays?: ReactNode
  isInteracting?: boolean
  nativeControls?: boolean
  chromeDisabled?: boolean
  className?: string
  onStageClick?: () => void
  children: ReactNode
}

function isUiTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      'button, input, select, textarea, a, [role="button"], [role="slider"], [data-player-ui="true"]'
    )
  )
}

export default function PlayerSurface({
  engine,
  topBar,
  centerControls,
  bottomBar,
  settingsPanel,
  overlays,
  isInteracting = false,
  nativeControls = false,
  chromeDisabled = false,
  className,
  onStageClick,
  children,
}: PlayerSurfaceProps) {
  const state = usePlayerState(engine)
  const isCoarse = useCoarsePointer()
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastTap = useRef(0)
  const interaction = useRef(isInteracting)
  interaction.current = isInteracting
  const clearHideTimer = useCallback(() => {
    clearTimeout(hideTimer.current)
    hideTimer.current = undefined
  }, [])
  const scheduleHide = useCallback(() => {
    clearHideTimer()
    const current = engine.getState()
    if (!current.isPlaying || current.isScrubbing || interaction.current || nativeControls) return
    hideTimer.current = setTimeout(
      () => {
        const current = engine.getState()
        if (interaction.current || current.isScrubbing || !current.isPlaying) return
        engine.setShowControls(false)
      },
      isCoarse ? 5000 : 3000
    )
  }, [engine, isCoarse, nativeControls, clearHideTimer])
  const wake = useCallback(() => {
    engine.setShowControls(true)
    scheduleHide()
  }, [engine, scheduleHide])
  usePlayerInput(engine, wake, !nativeControls && !chromeDisabled)

  useEffect(() => {
    if (isInteracting || state.isScrubbing || !state.isPlaying) {
      engine.setShowControls(true)
      clearHideTimer()
    } else scheduleHide()
    return clearHideTimer
  }, [
    engine,
    isInteracting,
    state.isPlaying,
    state.isScrubbing,
    state.showControls,
    clearHideTimer,
    scheduleHide,
  ])

  useEffect(
    () => () => {
      clearTimeout(tapTimer.current)
    },
    []
  )

  const stageClick = (event: MouseEvent<HTMLDivElement>) => {
    if (isUiTarget(event.target) || nativeControls || chromeDisabled) return
    onStageClick?.()
    const now = Date.now()
    if (now - lastTap.current < 280) {
      clearTimeout(tapTimer.current)
      tapTimer.current = undefined
      lastTap.current = 0
      engine.toggleFullscreen()
      return
    }
    lastTap.current = now
    clearTimeout(tapTimer.current)
    tapTimer.current = setTimeout(() => {
      tapTimer.current = undefined
      engine.setShowControls(!engine.getState().showControls)
      scheduleHide()
    }, 280)
  }

  const visible = state.showControls || state.isScrubbing || isInteracting || !state.isPlaying
  return (
    <PlayerProvider engine={engine}>
      <div
        ref={engine.containerRef}
        data-player-root="true"
        className={`${styles.shell} ${state.isFullscreen ? styles.shellFullscreen : ''} ${className ?? ''}`}
        style={{ cursor: !visible && state.isFullscreen ? 'none' : 'default' }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerMove={(event) => {
          if (event.pointerType === 'mouse') wake()
        }}
        onFocusIn={wake}
        onMouseLeave={() => {
          if (
            window.matchMedia?.('(hover: hover) and (pointer: fine)').matches &&
            engine.getState().isPlaying &&
            !interaction.current
          )
            engine.setShowControls(false)
        }}
      >
        <div className={styles.stage} onClick={stageClick}>
          {children}
        </div>
        {overlays}
        {(state.error || state.playBlocked) && (
          <div className={styles.engineStatus} data-player-ui="true">
            <PlayerStatus />
          </div>
        )}
        {!chromeDisabled && !nativeControls && (
          <div className={styles.uiLayer}>
            <div data-player-ui="true">{topBar}</div>
            {visible && centerControls && <div data-player-ui="true">{centerControls}</div>}
            <div data-player-ui="true">{bottomBar}</div>
            {settingsPanel && <div data-player-ui="true">{settingsPanel}</div>}
          </div>
        )}
      </div>
    </PlayerProvider>
  )
}
