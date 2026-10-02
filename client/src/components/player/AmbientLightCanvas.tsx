import React, { useEffect, useRef } from 'react'
import layoutStyles from '../../pages/PlayerPageLayout.module.css'
import type { AmbientLightSettings } from '../../hooks/useAmbientLight'

interface AmbientLightCanvasProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  active: boolean
  settings: AmbientLightSettings
  className?: string
}

const W = 160
const H = 90
const FRAME_MS = 120

const AmbientLightCanvas: React.FC<AmbientLightCanvasProps> = ({
  videoRef,
  active,
  settings,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    let raf = 0
    let last = 0
    let stopped = false

    const paint = () => {
      if (video.readyState < 2 || !video.videoWidth) return
      try {
        const vw = video.videoWidth
        const vh = video.videoHeight
        const targetAspect = W / H
        const videoAspect = vw / vh
        let sw = vw
        let sh = vh
        let sx = 0
        let sy = 0
        if (videoAspect > targetAspect) {
          sw = vh * targetAspect
          sx = (vw - sw) / 2
        } else {
          sh = vw / targetAspect
          sy = (vh - sh) / 2
        }
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H)
      } catch {
        // ignore
      }
    }

    const tick = (now: number) => {
      if (stopped || video.paused) return
      raf = requestAnimationFrame(tick)
      if (now - last < FRAME_MS) return
      last = now
      paint()
    }

    const start = () => {
      if (stopped) return
      cancelAnimationFrame(raf)
      last = 0
      raf = requestAnimationFrame(tick)
    }

    video.addEventListener('play', start)
    video.addEventListener('seeked', paint)
    video.addEventListener('loadeddata', paint)
    raf = requestAnimationFrame(tick)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      video.removeEventListener('play', start)
      video.removeEventListener('seeked', paint)
      video.removeEventListener('loadeddata', paint)
    }
  }, [active, videoRef])

  if (!active) return null

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      aria-hidden="true"
      className={className ?? layoutStyles.theaterAmbient}
      style={{
        filter: `blur(${settings.blur}px) saturate(${settings.saturation}%) brightness(${settings.brightness}%)`,
        opacity: settings.opacity / 100,
      }}
    />
  )
}

export default AmbientLightCanvas
