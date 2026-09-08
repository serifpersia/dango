import React, { useEffect, useRef, useState } from 'react'
import GenericModal from '../common/GenericModal'
import { Button } from '../common/Button'
import settingsStyles from './PlayerSettings.module.css'

interface AvSyncCalibratorProps {
  isOpen: boolean
  initialMs: number
  onApply: (ms: number) => void
  onClose: () => void
}

const BEAT_MS = 1000
const FLASH_MS = 150
const STEP_MS = 10
const MAX_MS = 500

function playClick(ctx: AudioContext) {
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = 2000
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(0.6, t + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(t)
  osc.stop(t + 0.08)
}

const AvSyncCalibrator: React.FC<AvSyncCalibratorProps> = ({
  isOpen,
  initialMs,
  onApply,
  onClose,
}) => {
  const [tempMs, setTempMs] = useState(initialMs)
  const [flash, setFlash] = useState(false)
  const tempRef = useRef(initialMs)
  tempRef.current = tempMs
  const ctxRef = useRef<AudioContext | null>(null)
  const timersRef = useRef<number[]>([])

  useEffect(() => {
    if (isOpen) setTempMs(Math.max(0, Math.min(MAX_MS, Math.round(initialMs))))
  }, [isOpen, initialMs])

  useEffect(() => {
    if (!isOpen) return
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    ctxRef.current = ctx
    void ctx.resume().catch(() => {})
    const beat = window.setInterval(() => {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
      playClick(ctx)
      const delay = Math.max(0, tempRef.current)
      const show = window.setTimeout(() => {
        setFlash(true)
        const hide = window.setTimeout(() => setFlash(false), FLASH_MS)
        timersRef.current.push(hide)
      }, delay)
      timersRef.current.push(show)
    }, BEAT_MS)
    return () => {
      window.clearInterval(beat)
      for (const t of timersRef.current) window.clearTimeout(t)
      timersRef.current = []
      setFlash(false)
      void ctx.close().catch(() => {})
      ctxRef.current = null
    }
  }, [isOpen])

  const clamp = (v: number) => Math.max(0, Math.min(MAX_MS, Math.round(v)))

  return (
    <GenericModal isOpen={isOpen} onClose={onClose} title="Calibrate A/V sync">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div
          aria-hidden="true"
          style={{
            width: 96,
            height: 96,
            borderRadius: '50%',
            background: flash ? '#a78bfa' : 'rgba(255,255,255,0.12)',
            boxShadow: flash ? '0 0 32px rgba(167,139,250,0.9)' : 'none',
            border: '2px solid rgba(255,255,255,0.25)',
            transition: 'background 60ms linear, box-shadow 60ms linear',
          }}
        />
        <div
          style={{
            fontSize: '0.85rem',
            color: 'var(--text-tertiary)',
            textAlign: 'center',
            maxWidth: 320,
          }}
        >
          A click plays every second. Adjust ms until the circle flash lands exactly on the heard
          click (Bluetooth delays the click). That value is your video delay.
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
        <div className={settingsStyles.sliderGroup} style={{ width: '100%' }}>
          <label>Video delay ({tempMs}ms)</label>
          <input
            type="range"
            min={0}
            max={MAX_MS}
            step={5}
            value={tempMs}
            onChange={(e) => setTempMs(clamp(Number((e.target as HTMLInputElement).value)))}
            style={{ '--slider-percent': `${(tempMs / MAX_MS) * 100}%` } as React.CSSProperties}
            aria-label="Video delay milliseconds"
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
