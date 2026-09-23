import { useEffect, useRef } from 'react'
import { isFullscreenActive } from '../lib/fullscreen'
import type useVideoPlayer from './useVideoPlayer'

function isAndroidBrowser(): boolean {
  try {
    return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
  } catch {
    return false
  }
}

export default function useAutoRotateFullscreen(
  player: ReturnType<typeof useVideoPlayer>,
  ready: boolean
): void {
  const { state, refs, actions } = player
  const readyRef = useRef(ready)
  readyRef.current = ready
  const engagedRef = useRef(false)

  useEffect(() => {
    if (!isAndroidBrowser()) return
    let mq: MediaQueryList | null = null
    const isLandscape = () => (mq ? mq.matches : window.innerWidth > window.innerHeight)
    const onChange = () => {
      const container = refs.playerContainerRef.current
      if (isLandscape()) {
        if (!readyRef.current || !container) return
        if (isFullscreenActive(refs.videoRef.current)) return
        engagedRef.current = true
        actions.toggleFullscreen()
      } else if (engagedRef.current) {
        engagedRef.current = false
        if (isFullscreenActive(refs.videoRef.current)) {
          actions.toggleFullscreen()
        }
      }
    }
    try {
      mq = window.matchMedia('(orientation: landscape)')
      if (mq.addEventListener) mq.addEventListener('change', onChange)
      else mq.addListener(onChange)
    } catch {
      // ignore
    }
    onChange()
    return () => {
      try {
        if (mq) {
          if (mq.removeEventListener) mq.removeEventListener('change', onChange)
          else mq.removeListener(onChange)
        }
      } catch {
        // ignore
      }
    }
  }, [actions, refs.playerContainerRef, refs.videoRef, ready])

  useEffect(() => {
    if (!state.isFullscreen) engagedRef.current = false
  }, [state.isFullscreen])
}
