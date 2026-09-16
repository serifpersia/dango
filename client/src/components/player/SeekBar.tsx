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

  useEffect(() => {
    if (!isScrubbing) return
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current || !duration) return
      const rect = containerRef.current.getBoundingClientRect()
      const percent = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      onScrubMove(percent)
      paintMove(percent)
    }
    const handleMouseUp = () => onScrubEnd()
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    function paintMove(percent: number) {
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
  }, [isScrubbing, duration, onScrubMove, onScrubEnd, formatTime, timeLabelRef])

  const percentAt = (clientX: number) => {
    if (!containerRef.current) return 0
    const rect = containerRef.current.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  return (
    <div
      className={`${classes.container} ${isScrubbing && classes.scrubbing ? classes.scrubbing : ''}`}
      ref={containerRef}
      onClick={(e) => {
        if (!videoRef.current || isNaN(duration) || duration === 0) return
        onSeek(percentAt(e.clientX))
      }}
      onMouseMove={(e) => {
        if (!duration) return
        const percent = percentAt(e.clientX)
        setHover({
          time: percent * duration,
          position: e.clientX - (containerRef.current?.getBoundingClientRect().left ?? 0),
        })
      }}
      onMouseLeave={() => {
        if (!isScrubbing) setHover({ time: 0, position: null })
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
            onScrubStart()
          }}
        />
        {children}
      </div>
    </div>
  )
}

export default SeekBar
