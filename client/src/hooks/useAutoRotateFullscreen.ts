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
  const { refs, actions } = player
  const readyRef = useRef(ready)
  readyRef.current = ready
  const engagedRef = useRef(false)
  const dismissedInLandscapeRef = useRef(false)

  const readLandscape = (mq: MediaQueryList | null) => {
    try {
      if (mq) return mq.matches
    } catch {
      // ignore
    }
    try {
      return window.innerWidth > window.innerHeight
    } catch {
      return false
    }
  }

  useEffect(() => {
    if (!isAndroidBrowser()) return
    let mq: MediaQueryList | null = null
    const onChange = () => {
      const container = refs.playerContainerRef.current
      const landscape = readLandscape(mq)
      if (landscape) {
        if (!readyRef.current || !container) return
        if (isFullscreenActive(refs.videoRef.current)) return
        if (dismissedInLandscapeRef.current) return
        engagedRef.current = true
        actions.toggleFullscreen()
      } else {
        dismissedInLandscapeRef.current = false
        if (engagedRef.current) {
          engagedRef.current = false
          if (isFullscreenActive(refs.videoRef.current)) {
            actions.toggleFullscreen()
          }
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
    const markDismissedOnExit = () => {
      if (isFullscreenActive(refs.videoRef.current)) return
      engagedRef.current = false
      try {
        if (window.matchMedia('(orientation: landscape)').matches) {
          dismissedInLandscapeRef.current = true
        }
      } catch {
        dismissedInLandscapeRef.current = true
      }
    }
    document.addEventListener('fullscreenchange', markDismissedOnExit)
    document.addEventListener('webkitfullscreenchange', markDismissedOnExit)
    return () => {
      document.removeEventListener('fullscreenchange', markDismissedOnExit)
      document.removeEventListener('webkitfullscreenchange', markDismissedOnExit)
    }
  }, [refs.videoRef])
}
