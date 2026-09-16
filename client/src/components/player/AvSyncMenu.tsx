import React, { useEffect, useState } from 'react'
import Icon from '../common/Icon'
import { MenuSlider } from './MenuControls'

export interface AvSyncMenuClasses {
  item: string
  active: string
  note: string
}

interface AvSyncMenuProps {
  classes: AvSyncMenuClasses
  enabled: boolean
  delayMs: number
  onToggle: (enabled: boolean) => void
  onDelayChange: (ms: number) => void
  onCalibrate?: () => void
}

const AvSyncMenu: React.FC<AvSyncMenuProps> = ({
  classes,
  enabled,
  delayMs,
  onToggle,
  onDelayChange,
  onCalibrate,
}) => {
  const [pendingDelayMs, setPendingDelayMs] = useState<number | null>(null)
  const shownDelayMs = pendingDelayMs ?? delayMs

  useEffect(() => {
    setPendingDelayMs(null)
  }, [delayMs])

  const commitDelay = () => {
    if (pendingDelayMs !== null) {
      onDelayChange(pendingDelayMs)
      setPendingDelayMs(null)
    }
  }

  return (
    <>
      <button
        type="button"
        className={`${classes.item} ${enabled ? classes.active : ''}`}
        onClick={() => onToggle(!enabled)}
      >
        <span>Video delay</span>
        {enabled && <Icon name="check" size={12} />}
      </button>
      <MenuSlider
        label="Video delay"
        display={`${shownDelayMs}ms`}
        min={0}
        max={500}
        step={5}
        value={shownDelayMs}
        percent={(shownDelayMs / 500) * 100}
        onChange={(v) => setPendingDelayMs(Math.round(v))}
        onCommit={commitDelay}
      />
      <div className={classes.note}>
        For Bluetooth headsets where audio arrives late. Video is held back via canvas; audio plays
        untouched.
      </div>
      {onCalibrate && (
        <button type="button" className={classes.item} onClick={onCalibrate}>
          <span>Calibrate…</span>
        </button>
      )}
    </>
  )
}

export default AvSyncMenu
