import React, { useEffect, useRef, useState } from 'react'
import { formatSubtitleDelay } from '../../lib/subtitleStyle'
import { MenuSlider } from './MenuControls'

export interface SubtitleDelayMenuClasses {
  item: string
  active: string
  note: string
}

interface SubtitleDelayMenuProps {
  classes: SubtitleDelayMenuClasses
  delayMs: number
  onDelayChange: (ms: number) => void
}

const SUBTITLE_DELAY_MIN_MS = -10000
const SUBTITLE_DELAY_MAX_MS = 10000
const SUBTITLE_DELAY_STEP_MS = 500

const SubtitleDelayMenu: React.FC<SubtitleDelayMenuProps> = ({
  classes,
  delayMs,
  onDelayChange,
}) => {
  const [pendingDelayMs, setPendingDelayMs] = useState<number | null>(null)
  const shownDelayMs = pendingDelayMs ?? delayMs
  const onDelayChangeRef = useRef(onDelayChange)
  onDelayChangeRef.current = onDelayChange
  const delayMsRef = useRef(delayMs)
  delayMsRef.current = delayMs
  const pendingRef = useRef<number | null>(null)
  pendingRef.current = pendingDelayMs

  useEffect(() => {
    setPendingDelayMs(null)
  }, [delayMs])

  useEffect(() => {
    return () => {
      const pending = pendingRef.current
      if (pending !== null && pending !== delayMsRef.current) {
        onDelayChangeRef.current(pending)
      }
    }
  }, [])

  const commitDelay = (value: number) => {
    delayMsRef.current = value
    pendingRef.current = null
    onDelayChangeRef.current(value)
    setPendingDelayMs(null)
  }

  const step = (delta: number) => {
    const base = pendingRef.current ?? delayMsRef.current
    const next = Math.max(SUBTITLE_DELAY_MIN_MS, Math.min(SUBTITLE_DELAY_MAX_MS, base + delta))
    commitDelay(next)
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, padding: '0.5rem 0.75rem 0.25rem' }}>
        <button
          type="button"
          className={classes.item}
          onClick={() => step(-SUBTITLE_DELAY_STEP_MS)}
          aria-label="Show subtitles 0.5 seconds earlier"
          style={{ flex: 1, justifyContent: 'center' }}
        >
          <span>-0.5s</span>
        </button>
        <button
          type="button"
          className={classes.item}
          onClick={() => step(SUBTITLE_DELAY_STEP_MS)}
          aria-label="Show subtitles 0.5 seconds later"
          style={{ flex: 1, justifyContent: 'center' }}
        >
          <span>+0.5s</span>
        </button>
        <button
          type="button"
          className={classes.item}
          onClick={() => commitDelay(0)}
          disabled={shownDelayMs === 0}
          aria-label="Reset subtitle timing"
          style={{ flex: 1, justifyContent: 'center' }}
        >
          <span>Reset</span>
        </button>
      </div>
      <MenuSlider
        label="Subtitle timing"
        display={formatSubtitleDelay(shownDelayMs)}
        min={SUBTITLE_DELAY_MIN_MS}
        max={SUBTITLE_DELAY_MAX_MS}
        step={100}
        value={shownDelayMs}
        percent={
          ((shownDelayMs - SUBTITLE_DELAY_MIN_MS) /
            (SUBTITLE_DELAY_MAX_MS - SUBTITLE_DELAY_MIN_MS)) *
          100
        }
        onChange={(value) => {
          const next = Math.round(value)
          pendingRef.current = next
          setPendingDelayMs(next)
        }}
        onCommit={() => {
          const pending = pendingRef.current
          if (pending !== null) commitDelay(pending)
        }}
      />
      <div className={classes.note}>
        Positive delays subtitles (show later). Negative shows them earlier. 0.0s is default.
      </div>
    </>
  )
}

export default SubtitleDelayMenu
