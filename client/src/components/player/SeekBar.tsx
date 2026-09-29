import React, { useEffect, useRef, useState } from 'react'

export interface SeekBarClasses {
  container: string
  scrubbing?: string
  timeBubble: string
  bar: string
  buffered: string
  watched: string
  thumb: string
}

interface SeekBarProps {
  classes: SeekBarClasses
  videoRef: React.RefObject<HTMLVideoElement | null>
  duration: number
  formatTime: (time: number) => string
  isScrubbing: boolean
  buffered?: 'auto' | 'full'
  onSeek: (percent: number) => void
  onScrubStart: () => void
  onScrubMove: (percent: number) => void
  onScrubEnd: () => void
  timeLabelRef?: React.RefObject<HTMLSpanElement | null>
  children?: React.ReactNode
}

const SeekBar: React.FC<SeekBarProps> = ({
  classes,
  videoRef,
  duration,
  formatTime,
  isScrubbing,
  buffered = 'auto',
  onSeek,
  onScrubStart,
  onScrubMove,
  onScrubEnd,
  timeLabelRef,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const watchedRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const bufferedRef = useRef<HTMLDivElement>(null)
  const scrubPointerIdRef = useRef<number | null>(null)
  const justScrubbedRef = useRef(false)
  const isScrubbingRef = useRef(isScrubbing)
  isScrubbingRef.current = isScrubbing
  const callbacksRef = useRef({ onScrubMove, onScrubEnd })
  callbacksRef.current = { onScrubMove, onScrubEnd }
  const [hover, setHover] = useState<{ time: number; position: number | null }>({
    time: 0,
    position: null,
  })

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const paint = (time: number) => {
      const percent = (time / duration) * 100 || 0
      if (watchedRef.current) watchedRef.current.style.width = `${percent}%`
      if (thumbRef.current) thumbRef.current.style.left = `${percent}%`
      if (timeLabelRef?.current) {
        timeLabelRef.current.innerText = `${formatTime(time)} / ${formatTime(duration)}`
      }
    }
    const handleTimeUpdate = () => {
      if (isScrubbing) return
      paint(video.currentTime)
    }
    const handleProgress = () => {
      if (buffered !== 'auto') return
      if (video.buffered.length > 0) {
        const end = video.buffered.end(video.buffered.length - 1)
        const percent = (end / duration) * 100 || 0
        if (bufferedRef.current) bufferedRef.current.style.width = `${percent}%`
      }
    }
    paint(video.currentTime)
    handleProgress()
    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('progress', handleProgress)
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('progress', handleProgress)
    }
  }, [videoRef, duration, isScrubbing, buffered, formatTime, timeLabelRef])

  const percentAt = (clientX: number) => {
    if (!containerRef.current) return 0
    const rect = containerRef.current.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  const paintPreview = (percent: number) => {
    const time = percent * duration
    const pct100 = (time / duration) * 100 || 0
    if (watchedRef.current) watchedRef.current.style.width = `${pct100}%`
    if (thumbRef.current) thumbRef.current.style.left = `${pct100}%`
    if (timeLabelRef?.current) {
      timeLabelRef.current.innerText = `${formatTime(time)} / ${formatTime(duration)}`
    }
    const rect = containerRef.current?.getBoundingClientRect()
    setHover({ time, position: rect ? percent * rect.width : null })
  }

  useEffect(() => {
    if (!isScrubbing) {
      scrubPointerIdRef.current = null
      return
    }
    const handleMove = (e: PointerEvent) => {
      if (scrubPointerIdRef.current !== null && e.pointerId !== scrubPointerIdRef.current) return
      if (!duration) return
      const percent = percentAt(e.clientX)
      callbacksRef.current.onScrubMove(percent)
      const time = percent * duration
      const pct100 = (time / duration) * 100 || 0
      if (watchedRef.current) watchedRef.current.style.width = `${pct100}%`
      if (thumbRef.current) thumbRef.current.style.left = `${pct100}%`
      if (timeLabelRef?.current) {
        timeLabelRef.current.innerText = `${formatTime(time)} / ${formatTime(duration)}`
      }
      const rect = containerRef.current?.getBoundingClientRect()
      setHover({ time, position: rect ? percent * rect.width : null })
    }
    const handleEnd = (e: PointerEvent) => {
      if (scrubPointerIdRef.current !== null && e.pointerId !== scrubPointerIdRef.current) return
      scrubPointerIdRef.current = null
      justScrubbedRef.current = true
      if (e.pointerType !== 'mouse') setHover({ time: 0, position: null })
      callbacksRef.current.onScrubEnd()
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleEnd)
    document.addEventListener('pointercancel', handleEnd)
    return () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleEnd)
      document.removeEventListener('pointercancel', handleEnd)
    }
  }, [isScrubbing, duration, formatTime, timeLabelRef])

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (!videoRef.current || !duration) return
    e.preventDefault()
    scrubPointerIdRef.current = e.pointerId
    try {
      containerRef.current?.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    if (!isScrubbingRef.current) onScrubStart()
    const percent = percentAt(e.clientX)
    onScrubMove(percent)
    paintPreview(percent)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!duration) return
    if (isScrubbingRef.current) return
    if (e.pointerType !== 'mouse') return
    const percent = percentAt(e.clientX)
    setHover({
      time: percent * duration,
      position: e.clientX - (containerRef.current?.getBoundingClientRect().left ?? 0),
    })
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (scrubPointerIdRef.current !== null && e.pointerId !== scrubPointerIdRef.current) return
    if (!isScrubbingRef.current) return
    scrubPointerIdRef.current = null
    justScrubbedRef.current = true
    if (e.pointerType !== 'mouse') setHover({ time: 0, position: null })
    try {
      if (containerRef.current?.hasPointerCapture(e.pointerId)) {
        containerRef.current.releasePointerCapture(e.pointerId)
      }
    } catch {
      // ignore
    }
    onScrubEnd()
  }

  return (
    <div
      className={`${classes.container} ${isScrubbing && classes.scrubbing ? classes.scrubbing : ''}`}
      ref={containerRef}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration || 0)}
      aria-valuenow={Math.round(
        ((Number(watchedRef.current?.style.width?.replace('%', '')) || 0) * (duration || 0)) / 100
      )}
      tabIndex={0}
      onClick={(e) => {
        if (justScrubbedRef.current) {
          justScrubbedRef.current = false
          return
        }
        if (!videoRef.current || isNaN(duration) || duration === 0) return
        onSeek(percentAt(e.clientX))
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onMouseMove={(e) => {
        if (isScrubbing || !duration) return
        const percent = percentAt(e.clientX)
        setHover({
          time: percent * duration,
          position: e.clientX - (containerRef.current?.getBoundingClientRect().left ?? 0),
        })
      }}
      onMouseLeave={() => {
        if (!isScrubbing) setHover({ time: 0, position: null })
      }}
      onKeyDown={(e) => {
        if (!videoRef.current || !duration) return
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault()
          const delta = (e.key === 'ArrowRight' ? 5 : -5) / duration
          const current = videoRef.current.currentTime / duration || 0
          onSeek(Math.min(1, Math.max(0, current + delta)))
        }
      }}
    >
      {hover.position !== null && (
        <div className={classes.timeBubble} style={{ left: hover.position }}>
          {formatTime(hover.time)}
        </div>
      )}
      <div className={classes.bar}>
        <div
          className={classes.buffered}
          ref={bufferedRef}
          style={buffered === 'full' ? { width: '100%' } : undefined}
        />
        <div className={classes.watched} ref={watchedRef} />
        <div
          className={classes.thumb}
          ref={thumbRef}
          onMouseDown={(e) => {
            e.preventDefault()
            if (!videoRef.current) return
            if (!isScrubbingRef.current) onScrubStart()
          }}
        />
        {children}
      </div>
    </div>
  )
}

export default SeekBar
