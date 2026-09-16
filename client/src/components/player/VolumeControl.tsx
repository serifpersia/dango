import React from 'react'

export interface VolumeControlClasses {
  container: string
  visible?: string
  button: string
  slider: string
}

interface VolumeControlProps {
  classes: VolumeControlClasses
  muted: boolean
  volume: number
  volumeIcon: React.ReactNode
  sliderVisible?: boolean
  containerRef?: React.RefObject<HTMLDivElement | null>
  muteLabel?: string
  onToggleMute: (e: React.MouseEvent<HTMLButtonElement>) => void
  onVolumeChange: (value: number) => void
}

const VolumeControl: React.FC<VolumeControlProps> = ({
  classes,
  muted,
  volume,
  volumeIcon,
  sliderVisible = true,
  containerRef,
  muteLabel,
  onToggleMute,
  onVolumeChange,
}) => {
  const level = muted ? 0 : volume
  return (
    <div
      className={`${classes.container} ${sliderVisible && classes.visible ? classes.visible : ''}`}
      ref={containerRef}
    >
      <button
        className={classes.button}
        onClick={onToggleMute}
        aria-label={muteLabel ?? (muted ? 'Unmute' : 'Mute')}
      >
        {volumeIcon}
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={level}
        onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
        className={classes.slider}
        style={{ '--volume-percent': `${level * 100}%` } as React.CSSProperties}
      />
    </div>
  )
}

export default VolumeControl
