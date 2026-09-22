import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'preact/compat'
import Icon from '../common/Icon'
import type { MusicTrack } from '../../hooks/useMusic'
import styles from '../asmr/Asmr.module.css'
import radioStyles from '../radio/Radio.module.css'

interface MusicPlayerProps {
  track: MusicTrack
  queue: MusicTrack[]
  onTrackStep: (delta: number) => void
  onClose: () => void
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const MusicPlayer: React.FC<MusicPlayerProps> = ({ track, onTrackStep, onClose }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const seekingRef = useRef(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [showControls, setShowControls] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(() => {
    const saved = parseFloat(localStorage.getItem('musicVolume') || '')
    return Number.isFinite(saved) ? saved : 1
  })
  const [autoplay, setAutoplay] = useState(() => {
    return localStorage.getItem('musicAutoplay') !== 'false'
  })
  const volumeRef = useRef(volume)
  volumeRef.current = volume
  const autoplayRef = useRef(autoplay)
  autoplayRef.current = autoplay
  const posRef = useRef(0)
  const attemptsRef = useRef(0)
  const retryTimerRef = useRef<number | null>(null)
  const sessionIdRef = useRef<string>('')
  if (!sessionIdRef.current) {
    sessionIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `music-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  const src = `/api/music/audio?videoId=${encodeURIComponent(track.id)}`

  const cancelRetry = () => {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }

  const loadSrc = (resumePos: number) => {
    const audio = audioRef.current
    if (!audio) return
    cancelRetry()
    setLoading(true)
    setFailed(false)
    const onMeta = () => {
      audio.removeEventListener('loadedmetadata', onMeta)
      if (resumePos > 5 && Number.isFinite(audio.duration) && resumePos < audio.duration - 5) {
        try {
          audio.currentTime = resumePos
        } catch {
          // ignore
        }
      }
    }
    audio.addEventListener('loadedmetadata', onMeta)
    audio.src = src
    audio.load()
    audio.volume = volumeRef.current
    audio.play().catch(() => {})
  }

  const giveUp = () => {
    setLoading(false)
    setFailed(true)
    if (autoplayRef.current) onTrackStep(1)
  }

  const scheduleRetry = () => {
    if (retryTimerRef.current) return
    if (attemptsRef.current >= 3) {
      giveUp()
      return
    }
    attemptsRef.current += 1
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null
      loadSrc(posRef.current)
    }, 5000)
  }

  const retry = () => {
    attemptsRef.current = 0
    loadSrc(posRef.current)
  }

  useEffect(() => {
    posRef.current = 0
    attemptsRef.current = 0
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    const audio = audioRef.current
    loadSrc(posRef.current)
    return () => {
      cancelRetry()
      if (audio) audio.removeAttribute('src')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.volume = volume
  }, [volume])

  useEffect(() => {
    document.body.classList.add('asmr-player-open')
    return () => document.body.classList.remove('asmr-player-open')
  }, [])

  const cover = track.thumbnails?.[track.thumbnails.length - 1]?.url ?? null

  const sendMusicPresence = React.useCallback(
    (playing: boolean) => {
      const audio = audioRef.current
      fetch('/api/discord/music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: track.title,
          artistLabel: track.artists,
          isPlaying: playing,
          thumbnail: cover || '',
          currentTime: audio?.currentTime ?? 0,
          duration: Number.isFinite(audio?.duration ?? NaN) ? audio?.duration : 0,
          sessionId: sessionIdRef.current,
        }),
      }).catch(() => {})
      fetch('/api/discord/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      }).catch(() => {})
    },
    [track, cover]
  )

  useEffect(() => {
    sendMusicPresence(isPlaying)
  }, [sendMusicPresence, isPlaying, track.id, expanded])

  useEffect(() => {
    if (!isPlaying) return
    const id = window.setInterval(() => sendMusicPresence(true), 15000)
    return () => window.clearInterval(id)
  }, [isPlaying, sendMusicPresence])

  useEffect(() => {
    const sid = sessionIdRef.current
    const clearPresence = () => {
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

    const handlePageHide = () => clearPresence()
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') clearPresence()
    }
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('beforeunload', handlePageHide)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('beforeunload', handlePageHide)
      document.removeEventListener('visibilitychange', handleVisibility)
      clearPresence()
    }
  }, [])

  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }

  const [artFailed, setArtFailed] = useState(false)
  useEffect(() => {
    setArtFailed(false)
  }, [cover])
  const effectiveCover = artFailed ? null : cover
  const headline = `${track.title} — ${track.artists}`

  const transportRow = (
    <>
      <div className={styles.playerButtons}>
        <button
          className={styles.playerBtn}
          onClick={() => onTrackStep(-1)}
          aria-label="Previous track"
        >
          <Icon name="step-backward" />
        </button>
        <button
          className={`${styles.playerBtn} ${styles.playBtn}`}
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Icon name="pause" /> : <Icon name="play" />}
        </button>
        <button className={styles.playerBtn} onClick={() => onTrackStep(1)} aria-label="Next track">
          <Icon name="step-forward" />
        </button>
        {failed && (
          <button
            className={styles.playerBtn}
            onClick={retry}
            title="Retry playback"
            aria-label="Retry playback"
          >
            <Icon name="redo" />
          </button>
        )}
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
          onChange={(e) => {
            const audio = audioRef.current
            if (!audio || !Number.isFinite(audio.duration)) return
            audio.currentTime = parseFloat(e.target.value)
            setCurrentTime(audio.currentTime)
          }}
          onPointerDown={() => {
            seekingRef.current = true
          }}
          onPointerUp={() => {
            seekingRef.current = false
          }}
          style={
            {
              '--played-percent': `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
            } as React.CSSProperties
          }
          aria-label="Seek"
        />
        <span className={styles.timeLabel}>{formatTime(duration)}</span>
        {loading && !failed && <span className={styles.timeLabel}>loading…</span>}
      </div>
    </>
  )

  const barContent = (
    <>
      <button
        className={`${styles.playerBtn} ${styles.playerToggle}`}
        onClick={() => setExpanded(!expanded)}
        aria-label={expanded ? 'Minimize player' : 'Expand player'}
        title={expanded ? 'Minimize to browse' : 'Expand'}
      >
        {expanded ? <Icon name="chevron-down" /> : <Icon name="chevron-up" />}
      </button>

      <div className={styles.playerInfo}>
        <p className={styles.playerTitle} title={headline}>
          {headline}
        </p>
        <p className={styles.playerTrack}>{track.artists}</p>
      </div>

      <div className={styles.playerControls}>{transportRow}</div>

      <div className={styles.playerRight}>
        <Icon name="volume-up" className={styles.volumeIcon} />
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
            localStorage.setItem('musicVolume', String(v))
          }}
          style={{ '--volume-percent': `${volume * 100}%` } as React.CSSProperties}
          aria-label="Volume"
        />
      </div>

      <div className={styles.playerActions}>
        <button
          className={`${styles.playerBtn} ${autoplay ? styles.playerBtnActive : ''}`}
          onClick={() => {
            setAutoplay((v) => {
              localStorage.setItem('musicAutoplay', String(!v))
              return !v
            })
          }}
          title={autoplay ? 'Autoplay on: next track plays automatically' : 'Autoplay off'}
          aria-label="Toggle autoplay"
          aria-pressed={autoplay}
        >
          <Icon name="forward" />
        </button>
        <a
          href={`https://music.youtube.com/watch?v=${encodeURIComponent(track.id)}`}
          target="_blank"
          rel="noreferrer"
          title="Open in YouTube Music"
          aria-label="Open in YouTube Music"
          className={styles.playerBtn}
          style={{ display: 'inline-flex', alignItems: 'center' }}
        >
          <Icon name="external-link-alt" />
        </a>
        <button className={styles.playerBtn} onClick={onClose} aria-label="Close player">
          <Icon name="times" />
        </button>
      </div>
    </>
  )

  const audioEl = (
    <audio
      ref={audioRef}
      preload="none"
      onPlay={() => {
        setIsPlaying(true)
        setLoading(false)
        setFailed(false)
        attemptsRef.current = 0
        cancelRetry()
      }}
      onPause={() => setIsPlaying(false)}
      onWaiting={() => {
        if (!failed) setLoading(true)
      }}
      onPlaying={() => {
        setLoading(false)
        attemptsRef.current = 0
        cancelRetry()
      }}
      onTimeUpdate={(e) => {
        const t = (e.target as HTMLAudioElement).currentTime
        posRef.current = t
        cancelRetry()
        if (!seekingRef.current) setCurrentTime(t)
      }}
      onStalled={() => {
        scheduleRetry()
      }}
      onLoadedMetadata={(e) => {
        const d = (e.target as HTMLAudioElement).duration
        if (Number.isFinite(d)) setDuration(d)
      }}
      onDurationChange={(e) => {
        const d = (e.target as HTMLAudioElement).duration
        if (Number.isFinite(d)) setDuration(d)
      }}
      onError={() => {
        scheduleRetry()
      }}
      onEnded={() => {
        if (autoplayRef.current) onTrackStep(1)
      }}
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

  return createPortal(
    <>
      {audioEl}
      <div className={`${styles.npOverlay} ${!showControls ? styles.npOverlayControlsHidden : ''}`}>
        <div
          className={`${styles.npStage} ${!effectiveCover ? styles.npStageBlank : ''}`}
          onClick={() => setShowControls((v) => !v)}
        >
          {effectiveCover && (
            <div className={radioStyles.coverWrap}>
              <img
                src={effectiveCover}
                alt={headline}
                loading="lazy"
                decoding="async"
                draggable={false}
                className={radioStyles.cover}
                onError={() => setArtFailed(true)}
              />
            </div>
          )}
        </div>

        <div
          className={`${styles.playerBar} ${styles.playerBarDocked} ${!showControls ? styles.playerBarDockedHidden : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          {barContent}
        </div>
      </div>
    </>,
    document.body
  )
}

export default MusicPlayer
