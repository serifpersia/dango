import { useEffect, useRef } from 'react'

interface UseDelayCanvasOptions {
  videoRef: { current: HTMLVideoElement | null }
  canvasRef: { current: HTMLCanvasElement | null }
  delayMs: number
  enabled: boolean
}

const queueCapFor = (delayMs: number) => Math.max(8, Math.min(40, Math.ceil(delayMs / 16.7) + 4))

export default function useDelayCanvas({
  videoRef,
  canvasRef,
  delayMs,
  enabled,
}: UseDelayCanvasOptions) {
  const delayMsRef = useRef(delayMs)
  delayMsRef.current = delayMs
  const queueRef = useRef<{ bitmap: ImageBitmap; capture: number }[]>([])
  const lastCapturedRef = useRef(-1)
  const lastTimeRef = useRef(-1)
  const hasPrimedRef = useRef(false)
  const primedDelayRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const closeBitmap = (bitmap: ImageBitmap | undefined) => {
      if (!bitmap) return
      try {
        bitmap.close()
      } catch {
        // ignore
      }
    }

    const flushQueue = () => {
      for (const entry of queueRef.current) closeBitmap(entry.bitmap)
      queueRef.current = []
    }

    if (!enabled) {
      flushQueue()
      lastCapturedRef.current = -1
      lastTimeRef.current = -1
      hasPrimedRef.current = false
      primedDelayRef.current = 0
      return
    }

    let cancelled = false

    const cancelScheduled = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }

    const schedule = () => {
      if (cancelled) return
      cancelScheduled()
      rafRef.current = requestAnimationFrame(() => {
        void frame()
      })
    }

    async function frame() {
      if (cancelled) return
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.videoWidth === 0) {
        schedule()
        return
      }
      if (
        video.paused ||
        video.ended ||
        document.hidden ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        schedule()
        return
      }
      const presented = video.getVideoPlaybackQuality().totalVideoFrames
      if (presented === lastCapturedRef.current) {
        schedule()
        return
      }
      if (
        video.seeking ||
        (lastTimeRef.current >= 0 && Math.abs(video.currentTime - lastTimeRef.current) > 0.5)
      ) {
        flushQueue()
        hasPrimedRef.current = false
        primedDelayRef.current = 0
        lastCapturedRef.current = -1
      }
      lastTimeRef.current = video.currentTime

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }

      const effectiveDelay = Math.max(0, delayMsRef.current || 0)
      if (effectiveDelay > primedDelayRef.current) hasPrimedRef.current = false

      try {
        const fresh = await createImageBitmap(video)
        if (cancelled) {
          closeBitmap(fresh)
          return
        }
        lastCapturedRef.current = presented
        const now = performance.now()
        const ctx = canvas.getContext('2d')
        const draw = (bitmap: ImageBitmap) => {
          if (ctx) ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        }
        if (effectiveDelay <= 0) {
          flushQueue()
          hasPrimedRef.current = false
          primedDelayRef.current = 0
          draw(fresh)
          closeBitmap(fresh)
          schedule()
          return
        }
        const queue = queueRef.current
        queue.push({ bitmap: fresh, capture: now })
        const cap = queueCapFor(effectiveDelay)
        while (queue.length > cap) closeBitmap(queue.shift()?.bitmap)
        let idx = -1
        for (let i = queue.length - 1; i >= 0; i--) {
          if (now - queue[i].capture >= effectiveDelay) {
            idx = i
            break
          }
        }
        if (idx !== -1) {
          for (let i = 0; i < idx; i++) closeBitmap(queue.shift()?.bitmap)
          const chosen = queue.shift()
          if (chosen) {
            draw(chosen.bitmap)
            closeBitmap(chosen.bitmap)
            hasPrimedRef.current = true
            primedDelayRef.current = effectiveDelay
          } else {
            draw(fresh)
          }
        } else if (!hasPrimedRef.current) {
          draw(fresh)
        } else {
          const oldest = queue.shift()
          if (oldest) {
            draw(oldest.bitmap)
            closeBitmap(oldest.bitmap)
          } else {
            draw(fresh)
          }
        }
      } catch {
        // ignore
      }
      schedule()
    }

    schedule()
    return () => {
      cancelled = true
      cancelScheduled()
      for (const entry of queueRef.current) {
        try {
          entry.bitmap.close()
        } catch {
          // ignore
        }
      }
      queueRef.current = []
    }
  }, [enabled, videoRef, canvasRef])
}
