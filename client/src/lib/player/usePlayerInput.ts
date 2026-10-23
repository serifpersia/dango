import { useEffect, useRef } from 'react'
import type { PlayerEngine } from './engine'

const INTERACTIVE =
  'input, textarea, button, select, a, [role="button"], [role="slider"], [contenteditable]:not([contenteditable="false"]), [data-player-ui="true"], [data-speed-boost-ignore="true"]'

export function usePlayerInput(engine: PlayerEngine, onActivity: () => void, enabled = true) {
  const activity = useRef(onActivity)
  activity.current = onActivity

  useEffect(() => {
    if (!enabled) return
    let keyHeld = false
    let keyboardBoost = false
    let pointerBoost = false
    let keyTimer: ReturnType<typeof setTimeout> | undefined
    let pointerTimer: ReturnType<typeof setTimeout> | undefined
    let boosting = false
    const syncBoost = () => {
      const active = keyboardBoost || pointerBoost
      if (active === boosting) return
      boosting = active
      engine.setSpeedBoost(active)
    }
    const ignored = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest(INTERACTIVE)
    const keydown = (event: KeyboardEvent) => {
      if (
        !engine.isActive() ||
        !engine.mediaRef.current ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        ignored(event.target)
      )
        return
      if (event.code === 'Space') {
        event.preventDefault()
        if (keyHeld) return
        keyHeld = true
        keyTimer = setTimeout(() => {
          keyTimer = undefined
          keyboardBoost = true
          syncBoost()
        }, 180)
        activity.current()
        return
      }
      const key = event.key.toLowerCase()
      if (
        !['k', 'j', 'l', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'm', 'f'].includes(key)
      )
        return
      event.preventDefault()
      if (event.repeat && ['k', 'm', 'f'].includes(key)) return
      if (key === 'k') engine.togglePlay()
      if (key === 'j' || key === 'arrowleft') engine.seekRelative(-10)
      if (key === 'l' || key === 'arrowright') engine.seekRelative(10)
      if (key === 'arrowup') engine.setVolume(engine.getState().volume + 0.1)
      if (key === 'arrowdown') engine.setVolume(engine.getState().volume - 0.1)
      if (key === 'm') engine.toggleMute()
      if (key === 'f') engine.toggleFullscreen()
      activity.current()
    }
    const keyup = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !keyHeld) return
      event.preventDefault()
      keyHeld = false
      clearTimeout(keyTimer)
      keyTimer = undefined
      if (keyboardBoost) {
        keyboardBoost = false
        syncBoost()
      } else engine.togglePlay()
      activity.current()
    }
    const pointerdown = (event: PointerEvent) => {
      const target = event.target
      if (
        event.button !== 0 ||
        !(target instanceof Element) ||
        ignored(target) ||
        !engine.containerRef.current?.contains(target)
      )
        return
      clearTimeout(pointerTimer)
      pointerTimer = setTimeout(() => {
        pointerTimer = undefined
        pointerBoost = true
        syncBoost()
      }, 180)
    }
    const pointerup = () => {
      clearTimeout(pointerTimer)
      pointerTimer = undefined
      pointerBoost = false
      syncBoost()
    }
    const reset = () => {
      clearTimeout(keyTimer)
      keyTimer = undefined
      keyHeld = false
      keyboardBoost = false
      pointerup()
    }
    document.addEventListener('keydown', keydown)
    document.addEventListener('keyup', keyup)
    document.addEventListener('pointerdown', pointerdown)
    document.addEventListener('pointerup', pointerup)
    document.addEventListener('pointercancel', pointerup)
    window.addEventListener('blur', reset)
    return () => {
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('keyup', keyup)
      document.removeEventListener('pointerdown', pointerdown)
      document.removeEventListener('pointerup', pointerup)
      document.removeEventListener('pointercancel', pointerup)
      window.removeEventListener('blur', reset)
      reset()
    }
  }, [engine, enabled])
}
