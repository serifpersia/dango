import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  FaPlay,
  FaPause,
  FaStepForward,
  FaStepBackward,
  FaUndo,
  FaRedo,
  FaVolumeUp,
  FaTimes,
  FaImage,
  FaEyeSlash,
  FaChevronDown,
  FaChevronUp,
  FaChevronLeft,
  FaChevronRight,
  FaListOl,
} from 'react-icons/fa'
import type { AsmrChapter, AsmrTrack } from '../../hooks/useAsmr'
import styles from './Asmr.module.css'

interface AsmrPlayerProps {
  title: string
  images: string[]
  chapters: AsmrChapter[]
  tracks: AsmrTrack[]
  trackIndex: number
  expanded: boolean
  isAdult?: boolean
  rjCode?: string
  t?: (s: string) => string
  onTrackChange: (index: number) => void
  onExpandedChange: (expanded: boolean) => void
  onClose: () => void
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

const AsmrPlayer: React.FC<AsmrPlayerProps> = ({
  title,
  images,
  chapters,
  tracks,
  trackIndex,
  expanded,
  isAdult,
  rjCode,
  t,
  onTrackChange,
  onExpandedChange,
  onClose,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [bufferedEnd, setBufferedEnd] = useState(0)
  const [showArt, setShowArt] = useState(true)
  const [imageIndex, setImageIndex] = useState(0)
  const [loadedImages, setLoadedImages] = useState<ReadonlySet<string>>(new Set())
  const [showChapterPanel, setShowChapterPanel] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const sessionIdRef = useRef<string>('')
  if (!sessionIdRef.current) {
    sessionIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `asmr-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
  const [volume, setVolume] = useState(() => {
    const saved = parseFloat(localStorage.getItem('asmrVolume') || '')
    return Number.isFinite(saved) ? saved : 1
  })

  const track = tracks[trackIndex]
  const hasImages = images.length > 0

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !track) return

    setCurrentTime(0)
    setDuration(0)
    setBufferedEnd(0)
    setIsPlaying(false)
    destroyHls()

    if (track.hls) {
      if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({ enableWorker: true })
        hlsRef.current = hls
        hls.loadSource(track.link)
        hls.attachMedia(audio)
      } else {
        audio.src = track.link
      }
    } else {
      audio.src = track.link
    }

    audio.load()
    audio.volume = volume
    audio.play().catch(() => setIsPlaying(false))

    return () => {
      destroyHls()
      audio.removeAttribute('src')
    }
  }, [track, volume, destroyHls])

  useEffect(() => () => destroyHls(), [destroyHls])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.volume = volume
  }, [volume])

  useEffect(() => {
    if (!expanded) return
    document.body.classList.add('asmr-player-open')
    return () => document.body.classList.remove('asmr-player-open')
  }, [expanded])

  useEffect(() => {
    setImageIndex(0)
  }, [images])

  useEffect(() => {
    if (!expanded) return
    setShowControls(true)
  }, [expanded])

  useEffect(() => {
    if (showChapterPanel) setShowControls(true)
  }, [showChapterPanel])

  const sendAsmrPresence = useCallback(
    (playing: boolean) => {
      if (!title || tracks.length === 0) return
      const t = tracks[trackIndex]
      const trackLabel = t ? `${t.resolutionStr} (${trackIndex + 1}/${tracks.length})` : ''
      const audio = audioRef.current
      const cur = audio ? audio.currentTime : 0
      const dur = audio ? audio.duration || 0 : 0
      const poster = images[0] || ''
      fetch('/api/discord/asmr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          trackLabel,
          isPlaying: playing,
          thumbnail: poster,
          thumbnails: images,
          currentTime: cur,
          duration: dur,
          isAdult: !!isAdult,
          rjCode: rjCode || '',
          sessionId: sessionIdRef.current,
        }),
      }).catch(() => {})
      fetch('/api/discord/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      }).catch(() => {})
    },
    [title, tracks, trackIndex, images, isAdult, rjCode]
  )

  useEffect(() => {
    sendAsmrPresence(isPlaying)
  }, [sendAsmrPresence, isPlaying, trackIndex, title, expanded])

  useEffect(() => {
    if (!isPlaying) return
    const id = window.setInterval(() => sendAsmrPresence(true), 15000)
    return () => window.clearInterval(id)
  }, [isPlaying, sendAsmrPresence])

  useEffect(() => {
    const sid = sessionIdRef.current
    const clearAsmrPresence = () => {
      if (!sid) return
      const payload = JSON.stringify({ sessionId: sid })
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          '/api/discord/clear',
          new Blob([payload], { type: 'application/json' })
        )
        navigator.sendBeacon(
          '/api/discord/heartbeat',
          new Blob([JSON.stringify({ sessionId: sid, bye: true })], { type: 'application/json' })
        )
      } else {
        fetch('/api/discord/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {})
        fetch('/api/discord/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, bye: true }),
          keepalive: true,
        }).catch(() => {})
      }
    }

    const handlePageHide = () => clearAsmrPresence()
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') clearAsmrPresence()
    }
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('beforeunload', handlePageHide)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('beforeunload', handlePageHide)
      document.removeEventListener('visibilitychange', handleVisibility)
      clearAsmrPresence()
    }
  }, [])

  const handleImgLoad = useCallback((src: string) => {
    setLoadedImages((prev) => {
      if (prev.has(src)) return prev
      const next = new Set(prev)
      next.add(src)
      return next
    })
  }, [])

  const attachImgRef = useCallback(
    (el: HTMLImageElement | null, src: string) => {
      if (el && el.complete && el.naturalWidth > 0) handleImgLoad(src)
    },
    [handleImgLoad]
  )

  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showChapterPanel) setShowChapterPanel(false)
        else onExpandedChange(false)
        return
      }
      if (!showArt || images.length < 2) return
      if (e.key === 'ArrowLeft') setImageIndex((i) => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setImageIndex((i) => Math.min(images.length - 1, i + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, showArt, images.length, showChapterPanel, onExpandedChange])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    const time = parseFloat(e.target.value)
    audio.currentTime = time
    setCurrentTime(time)
  }

  const handleEnded = () => {
    if (trackIndex < tracks.length - 1) {
      onTrackChange(trackIndex + 1)
    }
  }

  const activeChapter = chapters.reduce((acc, c, i) => (currentTime >= c.time ? i : acc), -1)

  const seekTo = (time: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = time
    setCurrentTime(time)
  }

  const seekBy = (delta: number) => {
    const audio = audioRef.current
    if (!audio) return
    const base = Number.isFinite(audio.currentTime) ? audio.currentTime : currentTime
    const target = Math.max(0, Math.min(duration || Infinity, base + delta))
    audio.currentTime = target
    setCurrentTime(target)
    setShowControls(true)
  }

  const playedPct = duration ? Math.min(100, (currentTime / duration) * 100) : 0
  const bufferedPct = duration
    ? Math.min(100, Math.max(playedPct, (bufferedEnd / duration) * 100))
    : 0

  const transportRow = (
    <>
      <div className={styles.playerButtons}>
        <button
          className={styles.playerBtn}
          onClick={() => onTrackChange(Math.max(0, trackIndex - 1))}
          disabled={trackIndex === 0}
          aria-label="Previous track"
        >
          <FaStepBackward />
        </button>
        <button
          className={`${styles.playerBtn} ${styles.seekBtn}`}
          onClick={() => seekBy(-10)}
          aria-label="Seek back 10 seconds"
          title="Back 10s"
        >
          <FaUndo />
          <span className={styles.seekBtnLabel}>10</span>
        </button>
        <button
          className={`${styles.playerBtn} ${styles.playBtn}`}
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <FaPause /> : <FaPlay />}
        </button>
        <button
          className={`${styles.playerBtn} ${styles.seekBtn}`}
          onClick={() => seekBy(10)}
          aria-label="Seek forward 10 seconds"
          title="Forward 10s"
        >
          <FaRedo />
          <span className={styles.seekBtnLabel}>10</span>
        </button>
        <button
          className={styles.playerBtn}
          onClick={() => onTrackChange(Math.min(tracks.length - 1, trackIndex + 1))}
          disabled={trackIndex >= tracks.length - 1}
          aria-label="Next track"
        >
          <FaStepForward />
        </button>
      </div>

      <div className={styles.seekRow}>
        <span className={styles.timeLabel}>{formatTime(currentTime)}</span>
        <input
          className={styles.seekBar}
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={handleSeek}
          style={
            {
              '--played-percent': `${playedPct}%`,
              '--buffered-percent': `${bufferedPct}%`,
            } as React.CSSProperties
          }
          aria-label="Seek"
        />
        <span className={styles.timeLabel}>{formatTime(duration)}</span>
      </div>
    </>
  )

  const barContent = (
    <>
      <button
        className={`${styles.playerBtn} ${styles.playerToggle}`}
        onClick={() => onExpandedChange(!expanded)}
        aria-label={expanded ? 'Minimize player' : 'Expand player'}
        title={expanded ? 'Minimize to browse' : 'Expand'}
      >
        {expanded ? <FaChevronDown /> : <FaChevronUp />}
      </button>

      <div className={styles.playerInfo}>
        <p className={styles.playerTitle} title={title}>
          {t ? t(title) : title}
        </p>
        <p className={styles.playerTrack}>
          {track?.resolutionStr || ''}
          {tracks.length > 1 ? ` (${trackIndex + 1}/${tracks.length})` : ''}
        </p>
      </div>

      <div className={styles.playerControls}>{transportRow}</div>

      <div className={styles.playerRight}>
        <FaVolumeUp className={styles.volumeIcon} />
        <input
          className={styles.volumeBar}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setVolume(v)
            localStorage.setItem('asmrVolume', String(v))
          }}
          style={{ '--volume-percent': `${volume * 100}%` } as React.CSSProperties}
          aria-label="Volume"
        />
      </div>

      <div className={styles.playerActions}>
        {expanded && hasImages && (
          <button
            className={styles.playerBtn}
            onClick={() => setShowArt((v) => !v)}
            aria-label={showArt ? 'Hide images' : 'Show images'}
            title={showArt ? 'Hide images' : 'Show images'}
          >
            {showArt ? <FaEyeSlash /> : <FaImage />}
          </button>
        )}

        {expanded && chapters.length > 0 && (
          <button
            className={`${styles.playerBtn} ${showChapterPanel ? styles.playerBtnActive : ''}`}
            onClick={() => setShowChapterPanel((v) => !v)}
            aria-label={showChapterPanel ? 'Hide bookmarks' : 'Show bookmarks'}
            title="Timestamps"
          >
            <FaListOl />
          </button>
        )}

        <button className={styles.playerBtn} onClick={onClose} aria-label="Close player">
          <FaTimes />
        </button>
      </div>
    </>
  )

  const audioEl = (
    <audio
      ref={audioRef}
      preload="metadata"
      onPlay={() => setIsPlaying(true)}
      onPause={() => setIsPlaying(false)}
      onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
      onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      onProgress={(e) => {
        const a = e.currentTarget
        if (a.buffered.length > 0) setBufferedEnd(a.buffered.end(a.buffered.length - 1))
      }}
      onEnded={handleEnded}
    />
  )

  if (!expanded) {
    return createPortal(
      <>
        {audioEl}
        <div className={styles.playerBar}>{barContent}</div>
      </>,
      document.body
    )
  }

  const safeIndex = Math.min(imageIndex, Math.max(0, images.length - 1))
  const currentSrc = images[safeIndex]
  const currentPending = showArt && hasImages && !!currentSrc && !loadedImages.has(currentSrc)

  return createPortal(
    <>
      {audioEl}
      <div className={`${styles.npOverlay} ${!showControls ? styles.npOverlayControlsHidden : ''}`}>
        <div
          className={`${styles.npStage} ${!showArt || !hasImages ? styles.npStageBlank : ''}`}
          onClick={() => setShowControls((v) => !v)}
        >
          {showArt && hasImages && (
            <>
              <div className={styles.sliderViewport}>
                <div
                  className={styles.sliderTrack}
                  style={{ transform: `translateX(-${safeIndex * 100}%)` }}
                >
                  {images.map((src) => (
                    <div key={src} className={styles.slide}>
                      <img
                        ref={(el) => attachImgRef(el, src)}
                        src={src}
                        alt={`${t ? t(title) : title} — work image`}
                        draggable={false}
                        onLoad={() => handleImgLoad(src)}
                        onError={() => handleImgLoad(src)}
                        className={`${styles.slideImg} ${
                          loadedImages.has(src) ? styles.slideImgLoaded : ''
                        }`}
                      />
                    </div>
                  ))}
                </div>
                {currentPending && (
                  <span className={styles.slideSpinner} aria-label="Loading image" />
                )}
              </div>

              {images.length > 1 && (
                <>
                  <button
                    className={`${styles.npArrow} ${styles.npArrowLeft}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setImageIndex((i) => Math.max(0, i - 1))
                      setShowControls(true)
                    }}
                    disabled={safeIndex === 0}
                    aria-label="Previous image"
                  >
                    <FaChevronLeft />
                  </button>
                  <button
                    className={`${styles.npArrow} ${styles.npArrowRight}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setImageIndex((i) => Math.min(images.length - 1, i + 1))
                      setShowControls(true)
                    }}
                    disabled={safeIndex === images.length - 1}
                    aria-label="Next image"
                  >
                    <FaChevronRight />
                  </button>
                  <span className={styles.npImageCount} onClick={(e) => e.stopPropagation()}>
                    {safeIndex + 1} / {images.length}
                  </span>
                </>
              )}
            </>
          )}
        </div>

        <div
          className={`${styles.playerBar} ${styles.playerBarDocked} ${!showControls ? styles.playerBarDockedHidden : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          {barContent}

          {showChapterPanel && (
            <>
              <div className={styles.npBackdrop} onClick={() => setShowChapterPanel(false)} />
              <div className={styles.chapterPanel}>
                {chapters.map((chapter, i) => (
                  <button
                    key={`${chapter.time}-${i}`}
                    className={`${styles.chapterRow} ${
                      i === activeChapter ? styles.chapterRowActive : ''
                    }`}
                    title={t ? t(chapter.label) : chapter.label}
                    onClick={() => {
                      seekTo(chapter.time)
                      setShowChapterPanel(false)
                    }}
                  >
                    <span className={styles.chapterRowTime}>{formatTime(chapter.time)}</span>
                    <span
                      className={styles.chapterRowLabel}
                      title={t ? t(chapter.label) : chapter.label}
                    >
                      {t ? t(chapter.label) : chapter.label}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  )
}

export default AsmrPlayer
