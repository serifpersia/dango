import { useCallback, useRef, useState, type RefObject } from 'react'

const persistDelay = (ms: number, enabled: boolean) => {
  try {
    localStorage.setItem('playerVideoDelayMs', String(ms))
    localStorage.setItem('playerVideoDelayEnabled', String(enabled))
  } catch {
    // ignore
  }
}

const persistDelayEnabled = (enabled: boolean) => {
  try {
    localStorage.setItem('playerVideoDelayEnabled', String(enabled))
  } catch {
    // ignore
  }
}

export function useAvSync(
  videoRef: RefObject<HTMLVideoElement | null>,
  onOpenCalibrator?: () => void
) {
  const [videoDelayMs, setVideoDelayMs] = useState<number>(() => {
    try {
      const stored = Number(localStorage.getItem('playerVideoDelayMs'))
      if (Number.isFinite(stored) && stored >= 0 && stored <= 500) return Math.round(stored)
    } catch {
      // ignore
    }
    return 180
  })
  const [videoDelayEnabled, setVideoDelayEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('playerVideoDelayEnabled') === 'true'
    } catch {
      return false
    }
  })
  const [isCalibrating, setIsCalibrating] = useState(false)
  const [testClipActive, setTestClipActive] = useState(false)
  const calibSnapshotRef = useRef<{ enabled: boolean; ms: number } | null>(null)
  const calibReturnRef = useRef<number | null>(null)

  const handleVideoDelayChange = (ms: number) => {
    const clamped = Math.max(0, Math.min(500, Math.round(ms)))
    setVideoDelayMs(clamped)
    try {
      localStorage.setItem('playerVideoDelayMs', String(clamped))
    } catch {
      // ignore
    }
  }
  const setDelayEnabled = (enabled: boolean) => {
    setVideoDelayEnabled(enabled)
    persistDelayEnabled(enabled)
  }
  const stopCalibration = useCallback(() => {
    setTestClipActive(false)
    setIsCalibrating(false)
  }, [])
  const openAvSyncCalibrator = () => {
    calibSnapshotRef.current = { enabled: videoDelayEnabled, ms: videoDelayMs }
    setVideoDelayEnabled(true)
    persistDelayEnabled(true)
    onOpenCalibrator?.()
    setIsCalibrating(true)
  }
  const cancelAvSyncCalibrator = () => {
    const snap = calibSnapshotRef.current
    calibSnapshotRef.current = null
    if (snap) {
      setVideoDelayMs(snap.ms)
      setVideoDelayEnabled(snap.enabled)
      persistDelay(snap.ms, snap.enabled)
    }
    setTestClipActive(false)
    setIsCalibrating(false)
  }
  const applyAvSyncCalibrator = () => {
    calibSnapshotRef.current = null
    setVideoDelayEnabled(true)
    persistDelay(videoDelayMs, true)
    setTestClipActive(false)
    setIsCalibrating(false)
  }
  const toggleTestClip = () => {
    if (testClipActive) {
      setTestClipActive(false)
      return
    }
    const v = videoRef.current
    if (v && !isNaN(v.currentTime)) calibReturnRef.current = v.currentTime
    setTestClipActive(true)
  }

  return {
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
    effectiveVideoDelayMs: videoDelayEnabled ? videoDelayMs : 0,
  }
}
