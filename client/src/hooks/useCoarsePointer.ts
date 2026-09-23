import { useState, useEffect } from 'react'

function queryCoarse(): boolean {
  try {
    if (typeof window === 'undefined') return false
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
    const touchPoints = (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0
    const hasTouch = touchPoints > 0 || 'ontouchstart' in window
    return coarse || hasTouch
  } catch {
    return false
  }
}

export default function useCoarsePointer(): boolean {
  const [isCoarse, setIsCoarse] = useState<boolean>(queryCoarse)

  useEffect(() => {
    setIsCoarse(queryCoarse())
    let mq: MediaQueryList | null = null
    const onChange = () => setIsCoarse(queryCoarse())
    try {
      mq = window.matchMedia('(pointer: coarse)')
      if (mq.addEventListener) mq.addEventListener('change', onChange)
      else mq.addListener(onChange)
    } catch {
      // ignore
    }
    window.addEventListener('touchstart', onChange, { passive: true, once: true })
    return () => {
      try {
        if (mq) {
          if (mq.removeEventListener) mq.removeEventListener('change', onChange)
          else mq.removeListener(onChange)
        }
      } catch {
        // ignore
      }
      window.removeEventListener('touchstart', onChange)
    }
  }, [])

  return isCoarse
}
