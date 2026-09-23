import React, { useCallback, useEffect, useRef, useState } from 'react'
import shellStyles from './UnifiedPlayer.module.css'
import useCoarsePointer from '../../hooks/useCoarsePointer'

interface UnifiedVolumeControlProps {
  muted: boolean
  volume: number
  volumeIcon: React.ReactNode
  buttonClassName: string
  sliderClassName?: string
  onToggleMute: () => void
  onVolumeChange: (value: number) => void
  onExpandedChange?: (expanded: boolean) => void
}

const LONG_PRESS_MS = 450

const UnifiedVolumeControl: React.FC<UnifiedVolumeControlProps> = ({
  muted,
  volume,
  volumeIcon,
  buttonClassName,
  sliderClassName,
  onToggleMute,
  onVolumeChange,
  onExpandedChange,
}) => {
  const isCoarse = useCoarsePointer()
  const [expanded, setExpanded] = useState(false)
  const pressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const setExpandedState = useCallback(
    (value: boolean) => {
      setExpanded(value)
      onExpandedChange?.(value)
    },
    [onExpandedChange]
  )

  useEffect(
    () => () => {
      if (pressTimer.current) window.clearTimeout(pressTimer.current)
    },
    []
  )

  useEffect(() => {
    if (!expanded) return
    const handleOutside = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setExpandedState(false)
    }
    document.addEventListener('pointerdown', handleOutside)
    return () => document.removeEventListener('pointerdown', handleOutside)
  }, [expanded, setExpandedState])

  const level = muted ? 0 : volume

  const startPress = () => {
    longPressed.current = false
    if (pressTimer.current) window.clearTimeout(pressTimer.current)
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true
      setExpandedState(true)
    }, LONG_PRESS_MS)
  }

  const cancelPress = () => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  const handleButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (longPressed.current) {
      longPressed.current = false
      return
    }
    if (isCoarse) {
      if (expanded) {
        onToggleMute()
      } else {
        setExpandedState(true)
      }
      return
    }
    onToggleMute()
  }

  return (
    <div
      ref={wrapRef}
      className={shellStyles.volumeWrap}
      data-expanded={expanded ? 'true' : 'false'}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className={buttonClassName}
        onClick={handleButtonClick}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={muted ? 'Unmute' : 'Mute'}
        aria-expanded={expanded}
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
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
        className={`${shellStyles.volumeSlider} ${sliderClassName ?? ''}`}
        style={{ '--volume-percent': `${level * 100}%` } as React.CSSProperties}
        aria-label="Volume"
      />
    </div>
  )
}

export default UnifiedVolumeControl
