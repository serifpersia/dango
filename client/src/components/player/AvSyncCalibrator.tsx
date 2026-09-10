import React, { useEffect, useRef, useState } from 'react'
import GenericModal from '../common/GenericModal'
import { Button } from '../common/Button'
import { MenuSlider } from './MenuControls'
import useDelayCanvas from '../../hooks/useDelayCanvas'

interface AvSyncCalibratorProps {
  isOpen: boolean
  initialMs: number
  onApply: (ms: number) => void
  onClose: () => void
}

const STEP_MS = 10
const MAX_MS = 500
const TEST_CLIP = '/av-sync-test.mp4'

const AvSyncCalibrator: React.FC<AvSyncCalibratorProps> = ({
  isOpen,
  initialMs,
  onApply,
  onClose,
}) => {
  const [tempMs, setTempMs] = useState(initialMs)
  const [videoFailed, setVideoFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useDelayCanvas({
    videoRef,
    canvasRef,
    delayMs: tempMs,
    enabled: isOpen && !videoFailed,
  })

  useEffect(() => {
    if (isOpen) {
      setTempMs(Math.max(0, Math.min(MAX_MS, Math.round(initialMs))))
      setVideoFailed(false)
    }
  }, [isOpen, initialMs])

  useEffect(() => {
    if (!isOpen) return
    const video = videoRef.current
    if (!video) return
    video.currentTime = 0
    const start = () => {
      video.play().catch(() => {})
    }
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) start()
    else {
      video.addEventListener('canplay', start, { once: true })
      return () => video.removeEventListener('canplay', start)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      const video = videoRef.current
      if (video) {
        video.pause()
        try {
          video.currentTime = 0
        } catch {
          // ignore
        }
      }
    }
  }, [isOpen])

  const clamp = (v: number) => Math.max(0, Math.min(MAX_MS, Math.round(v)))

  return (
    <GenericModal isOpen={isOpen} onClose={onClose} title="Calibrate A/V sync">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        {!videoFailed ? (
          <button
            type="button"
            aria-label="Replay test clip"
            onClick={() => videoRef.current?.play().catch(() => {})}
            style={{
              width: '100%',
              maxWidth: 420,
              aspectRatio: '16 / 9',
              padding: 0,
              border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              background: 'black',
              cursor: 'pointer',
            }}
          >
            <video
              ref={videoRef}
              src={TEST_CLIP}
              loop
              playsInline
              preload="auto"
              onError={() => setVideoFailed(true)}
              style={{ display: 'none' }}
            />
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
          </button>
        ) : (
          <div
            style={{
              fontSize: '0.8rem',
              color: 'var(--text-tertiary)',
              textAlign: 'center',
              maxWidth: 320,
            }}
          >
            Test clip failed to load. You can still set the delay manually below.
          </div>
        )}
        <div
          style={{
            fontSize: '0.85rem',
            color: 'var(--text-tertiary)',
            textAlign: 'center',
            maxWidth: 340,
          }}
        >
          The circle flashes white with a click every second. Adjust ms until the flash lands
          exactly on the heard click — this runs through the same video-delay pipeline as playback.
          The clip loops, so judge the average over several beats.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button
            onClick={() => setTempMs((v) => clamp(v - STEP_MS))}
            aria-label="Decrease delay by 10 milliseconds"
          >
            − {STEP_MS}ms
          </Button>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, minWidth: 90, textAlign: 'center' }}>
            {tempMs}ms
          </div>
          <Button
            onClick={() => setTempMs((v) => clamp(v + STEP_MS))}
            aria-label="Increase delay by 10 milliseconds"
          >
            + {STEP_MS}ms
          </Button>
        </div>
        <div style={{ width: '100%' }}>
          <MenuSlider
            label="Video delay"
            display={`${tempMs}ms`}
            min={0}
            max={MAX_MS}
            step={5}
            value={tempMs}
            percent={(tempMs / MAX_MS) * 100}
            onChange={(v) => setTempMs(clamp(v))}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={() => onApply(tempMs)}>Use {tempMs}ms</Button>
        </div>
      </div>
    </GenericModal>
  )
}

export default AvSyncCalibrator
