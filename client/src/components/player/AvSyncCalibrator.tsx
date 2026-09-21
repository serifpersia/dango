import React from 'react'
import { Button } from '../common/Button'
import { MenuSlider } from './MenuControls'

interface AvSyncCalibratorProps {
  isOpen: boolean
  ms: number
  onChange: (ms: number) => void
  onApply: () => void
  onClose: () => void
  testClipActive: boolean
  onTestClip: () => void
}

const STEP_MS = 10
const MAX_MS = 500

const clamp = (v: number) => Math.max(0, Math.min(MAX_MS, Math.round(v)))

const AvSyncCalibrator: React.FC<AvSyncCalibratorProps> = ({
  isOpen,
  ms,
  onChange,
  onApply,
  onClose,
  testClipActive,
  onTestClip,
}) => {
  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-label="Calibrate audio video sync"
      data-speed-boost-ignore="true"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        right: 8,
        bottom: 112,
        width: 'min(260px, calc(100% - 16px))',
        maxHeight: 'calc(100% - 124px)',
        overflowY: 'auto',
        overflowX: 'hidden',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: 12,
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--glass-border)',
        background: 'rgba(18, 18, 22, 0.95)',
        boxShadow: 'var(--glass-shadow)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-primary)' }}>
        A/V sync
      </div>
      <div>
        <Button size="sm" variant="secondary" onClick={onTestClip}>
          {testClipActive ? 'Back to video' : 'Preview test clip'}
        </Button>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        <Button
          size="sm"
          onClick={() => onChange(clamp(ms - STEP_MS))}
          aria-label="Decrease delay by 10 milliseconds"
        >
          − {STEP_MS}ms
        </Button>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, minWidth: 64, textAlign: 'center' }}>
          {ms}ms
        </div>
        <Button
          size="sm"
          onClick={() => onChange(clamp(ms + STEP_MS))}
          aria-label="Increase delay by 10 milliseconds"
        >
          + {STEP_MS}ms
        </Button>
      </div>
      <MenuSlider
        label="Video delay"
        display={`${ms}ms`}
        min={0}
        max={MAX_MS}
        step={5}
        value={ms}
        percent={(ms / MAX_MS) * 100}
        onChange={(v) => onChange(clamp(v))}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button size="sm" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={onApply}>
          Apply {ms}ms
        </Button>
      </div>
    </div>
  )
}

export default AvSyncCalibrator
