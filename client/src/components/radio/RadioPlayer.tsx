import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  FaPlay,
  FaPause,
  FaStepForward,
  FaStepBackward,
  FaVolumeUp,
  FaTimes,
  FaImage,
  FaEyeSlash,
  FaChevronDown,
  FaChevronUp,
  FaListOl,
  FaBroadcastTower,
} from 'react-icons/fa'
import type { RadioStation, ListenMoeNowPlaying } from '../../hooks/useRadio'
import { songArt, songArtist } from '../../hooks/useRadio'
import styles from '../asmr/Asmr.module.css'
import radioStyles from './Radio.module.css'

interface RadioPlayerProps {
  station: RadioStation
  nowPlaying: ListenMoeNowPlaying
  connected: boolean
  expanded: boolean
  onStationStep: (delta: number) => void
  onExpandedChange: (expanded: boolean) => void
  onClose: () => void
}

function formatElapsed(startTime: string | null): string {
  if (!startTime) return ''
  const delta = Math.max(0, Math.floor((Date.now() - new Date(startTime).getTime()) / 1000))
  const m = Math.floor(delta / 60)
  const s = delta % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const RadioPlayer: React.FC<RadioPlayerProps> = ({
  station,
  nowPlaying,
  connected,
  expanded,
  onStationStep,
  onExpandedChange,
  onClose,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [showArt, setShowArt] = useState(true)
  const [showHistoryPanel, setShowHistoryPanel] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [elapsed, setElapsed] = useState('')
  const [volume, setVolume] = useState(() => {
    const saved = parseFloat(localStorage.getItem('radioVolume') || '')
    return Number.isFinite(saved) ? saved : 1
  })
  const sessionIdRef = useRef<string>('')
  if (!sessionIdRef.current) {
    sessionIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `radio-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  const song = nowPlaying.song
  const cover = songArt(song) || station.favicon || null
  const hasImages = !!cover
  const headline = song ? `${songArtist(song)} — ${song.title}` : station.name

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    setIsPlaying(false)
    audio.src = station.streamUrl
    audio.load()
    audio.volume = volume
    audio.play().catch(() => setIsPlaying(false))
    return () => {
      audio.removeAttribute('src')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station.id])

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
    if (!expanded) return
    setShowControls(true)
  }, [expanded])

  const elapsedSeconds = (startTime: string | null): number => {
    if (!startTime) return 0
    return Math.max(0, Math.floor((Date.now() - new Date(startTime).getTime()) / 1000))
  }

  const sendRadioPresence = React.useCallback(
    (playing: boolean) => {
      if (!station) return
      fetch('/api/discord/radio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: headline,
          stationLabel: station.name,
          isPlaying: playing,
          thumbnail: cover || '',
          currentTime: elapsedSeconds(nowPlaying.startTime),
          sessionId: sessionIdRef.current,
        }),
      }).catch(() => {})
      fetch('/api/discord/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      }).catch(() => {})
    },
    [station, headline, cover, nowPlaying.startTime]
  )

  useEffect(() => {
    sendRadioPresence(isPlaying)
  }, [sendRadioPresence, isPlaying, station.id, headline, expanded])

  useEffect(() => {
    if (!isPlaying) return
    const id = window.setInterval(() => sendRadioPresence(true), 15000)
    return () => window.clearInterval(id)
  }, [isPlaying, sendRadioPresence])

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
    if (!nowPlaying.startTime) {
      setElapsed('')
      return
    }
    setElapsed(formatElapsed(nowPlaying.startTime))
    const id = window.setInterval(() => setElapsed(formatElapsed(nowPlaying.startTime)), 1000)
    return () => window.clearInterval(id)
  }, [nowPlaying.startTime, nowPlaying.song?.id])

  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showHistoryPanel) setShowHistoryPanel(false)
        else onExpandedChange(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, showHistoryPanel, onExpandedChange])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.load()
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }

  const transportRow = (
    <>
      <div className={styles.playerButtons}>
        <button
          className={styles.playerBtn}
          onClick={() => onStationStep(-1)}
          aria-label="Previous station"
        >
          <FaStepBackward />
        </button>
        <button
          className={`${styles.playerBtn} ${styles.playBtn}`}
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <FaPause /> : <FaPlay />}
        </button>
        <button
          className={styles.playerBtn}
          onClick={() => onStationStep(1)}
          aria-label="Next station"
        >
          <FaStepForward />
        </button>
      </div>

      <div className={styles.seekRow}>
        <span className={radioStyles.liveBadge}>
          <FaBroadcastTower size={10} /> LIVE
        </span>
        {elapsed && <span className={styles.timeLabel}>{elapsed}</span>}
        {connected && nowPlaying.listeners > 0 && (
          <span className={styles.timeLabel}>{nowPlaying.listeners} listening</span>
        )}
        {!connected && station.source === 'listen.moe' && (
          <span className={styles.timeLabel}>connecting…</span>
        )}
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
        <p className={styles.playerTitle} title={headline}>
          {headline}
        </p>
        <p className={styles.playerTrack}>{station.name}</p>
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
            localStorage.setItem('radioVolume', String(v))
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
            aria-label={showArt ? 'Hide art' : 'Show art'}
            title={showArt ? 'Hide art' : 'Show art'}
          >
            {showArt ? <FaEyeSlash /> : <FaImage />}
          </button>
        )}

        {expanded && nowPlaying.lastPlayed.length > 0 && (
          <button
            className={`${styles.playerBtn} ${showHistoryPanel ? styles.playerBtnActive : ''}`}
            onClick={() => setShowHistoryPanel((v) => !v)}
            aria-label={showHistoryPanel ? 'Hide history' : 'Show history'}
            title="Recently played"
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
      preload="none"
      onPlay={() => setIsPlaying(true)}
      onPause={() => setIsPlaying(false)}
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
          className={`${styles.npStage} ${!showArt || !hasImages ? styles.npStageBlank : ''}`}
          onClick={() => setShowControls((v) => !v)}
        >
          {showArt && hasImages && cover && (
            <div className={radioStyles.coverWrap}>
              <img src={cover} alt={headline} draggable={false} className={radioStyles.cover} />
            </div>
          )}
        </div>

        <div
          className={`${styles.playerBar} ${styles.playerBarDocked} ${!showControls ? styles.playerBarDockedHidden : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          {barContent}

          {showHistoryPanel && (
            <>
              <div className={styles.npBackdrop} onClick={() => setShowHistoryPanel(false)} />
              <div className={styles.chapterPanel}>
                {nowPlaying.lastPlayed.map((s) => (
                  <div key={s.id} className={styles.chapterRow}>
                    <span
                      className={styles.chapterRowLabel}
                      title={`${songArtist(s)} — ${s.title}`}
                    >
                      {songArtist(s)} — {s.title}
                    </span>
                  </div>
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

export default RadioPlayer
