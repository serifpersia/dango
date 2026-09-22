import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'preact/compat'
import { useNavigate } from 'react-router'
import Icon from '../common/Icon'
import { Modal } from '../common/Modal'
import { Button } from '../common/Button'
import type { AsmrChapter, AsmrTrack } from '../../hooks/useAsmr'
import {
  useAsmrProgress,
  useSaveAsmrProgress,
  useAddAsmrBookmark,
} from '../../hooks/useAsmrLibrary'
import { buildAsmrId } from '../../lib/asmr'
import { formatTime } from '../../lib/utils'
import { loadHls } from '../../lib/hls'
import type Hls from 'hls.js'
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
  const volumeRef = useRef(volume)
  useEffect(() => {
    volumeRef.current = volume
  }, [volume])

  const navigate = useNavigate()
  const workId = React.useMemo(() => (rjCode ? buildAsmrId(rjCode) : ''), [rjCode])
  const saveProgress = useSaveAsmrProgress()
  const addBookmark = useAddAsmrBookmark()
  const { data: progressData } = useAsmrProgress(workId || undefined)
  const [showResumeModal, setShowResumeModal] = useState(false)
  const [resumeTime, setResumeTime] = useState(0)
  const [showCompleteModal, setShowCompleteModal] = useState(false)
  const hasResumedRef = useRef('')
  const progressSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedTimeRef = useRef(0)
  const timeRef = useRef(0)
  const durationRef = useRef(0)

  const track = tracks[trackIndex]
  const trackLink = track?.link
  const trackIsHls = track?.hls
  const trackLabel = track?.resolutionStr || ''
  const hasImages = images.length > 0
  const trackKey = `${workId}:${trackIndex}`

  const savedRow = React.useMemo(() => {
    const rows = progressData?.progress ?? []
    return rows.find((r) => r.trackIndex === trackIndex) ?? null
  }, [progressData, trackIndex])

  const trackMetaRef = useRef({ workId: '', trackIndex: 0, trackLabel: '' })
  trackMetaRef.current = {
    workId,
    trackIndex,
    trackLabel,
  }

  const saveTrack = useCallback(
    (
      meta: { workId: string; trackIndex: number; trackLabel: string },
      time: number,
      dur: number,
      force = false
    ) => {
      if (!meta.workId || !dur || dur < 10) return
      if (!force && Math.abs(time - lastSavedTimeRef.current) < 5) return
      lastSavedTimeRef.current = time
      saveProgress.mutate({
        workId: meta.workId,
        trackIndex: meta.trackIndex,
        trackLabel: meta.trackLabel,
        currentTime: Math.floor(time),
        duration: Math.floor(dur),
        title,
        thumbnail: images[0] || '',
        rjCode: meta.workId,
        isAdult: isAdult ? 1 : 0,
      })
    },
    [saveProgress, title, images, isAdult]
  )

  const flushSave = useCallback(
    (force = false) => {
      if (progressSaveTimerRef.current) {
        clearTimeout(progressSaveTimerRef.current)
        progressSaveTimerRef.current = null
      }
      saveTrack(trackMetaRef.current, timeRef.current, durationRef.current, force)
    },
    [saveTrack]
  )
  const flushSaveRef = useRef(flushSave)
  flushSaveRef.current = flushSave
  const saveTrackRef = useRef(saveTrack)
  saveTrackRef.current = saveTrack

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !trackLink) return

    const metaAtLoad = {
      workId,
      trackIndex,
      trackLabel,
    }
    const saveAtUnload = () => {
      if (progressSaveTimerRef.current) {
        clearTimeout(progressSaveTimerRef.current)
        progressSaveTimerRef.current = null
      }
      saveTrackRef.current(metaAtLoad, timeRef.current, durationRef.current, true)
    }

    setCurrentTime(0)
    setDuration(0)
    setBufferedEnd(0)
    setIsPlaying(false)
    timeRef.current = 0
    durationRef.current = 0
    lastSavedTimeRef.current = 0
    destroyHls()

    if (trackIsHls) {
      let cancelled = false
      void (async () => {
        const HlsClass = await loadHls()
        if (cancelled) return
        if (HlsClass && HlsClass.isSupported()) {
          const hls = new HlsClass({ enableWorker: true })
          hlsRef.current = hls
          hls.loadSource(trackLink)
          hls.attachMedia(audio)
          audio.play().catch(() => setIsPlaying(false))
        } else {
          audio.src = trackLink
          audio.load()
          audio.volume = volumeRef.current
          audio.play().catch(() => setIsPlaying(false))
        }
      })()
      return () => {
        cancelled = true
        destroyHls()
        audio.removeAttribute('src')
        saveAtUnload()
      }
    } else {
      audio.src = trackLink
    }

    audio.load()
    audio.volume = volumeRef.current
    audio.play().catch(() => setIsPlaying(false))

    return () => {
      destroyHls()
      audio.removeAttribute('src')
      saveAtUnload()
    }
  }, [trackLink, trackIsHls, destroyHls, workId, trackIndex, trackLabel])

  useEffect(() => () => destroyHls(), [destroyHls])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushSaveRef.current()
    }
    const onPageHide = () => flushSaveRef.current()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])

  useEffect(() => {
    if (!savedRow || hasResumedRef.current === trackKey) return
    if (!(duration > 0)) return
    const ct = savedRow.currentTime || 0
    const dur = savedRow.duration || duration
    if (ct >= 10 && dur - ct >= 15 && timeRef.current < ct) {
      hasResumedRef.current = trackKey
      setResumeTime(ct)
      setShowResumeModal(true)
    } else {
      hasResumedRef.current = trackKey
    }
  }, [savedRow, duration, trackKey])

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
    flushSave(true)
    if (trackIndex < tracks.length - 1) {
      onTrackChange(trackIndex + 1)
    } else {
      setShowCompleteModal(true)
    }
  }

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const t = e.currentTarget.currentTime
    timeRef.current = t
    setCurrentTime(t)
    if (progressSaveTimerRef.current) clearTimeout(progressSaveTimerRef.current)
    progressSaveTimerRef.current = setTimeout(() => flushSaveRef.current(), 5000)
  }

  const handlePause = () => {
    setIsPlaying(false)
    flushSaveRef.current()
  }

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const d = e.currentTarget.duration
    durationRef.current = Number.isFinite(d) ? d : 0
    setDuration(e.currentTarget.duration)
  }

  const handleResume = useCallback(() => {
    const audio = audioRef.current
    if (audio && resumeTime > 0) {
      audio.currentTime = resumeTime
      timeRef.current = resumeTime
      audio.play().catch(() => {})
    }
    setShowResumeModal(false)
  }, [resumeTime])

  const handleSkipResume = useCallback(() => {
    setShowResumeModal(false)
  }, [])

  const handleCompleteAndHome = useCallback(() => {
    if (workId) {
      addBookmark.mutate({
        rjCode: workId,
        title,
        thumbnail: images[0] || '',
        status: 'Completed',
        isAdult: !!isAdult,
        silent: true,
      })
    }
    setShowCompleteModal(false)
    onClose()
    navigate('/')
  }, [workId, addBookmark, title, images, isAdult, onClose, navigate])

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
          <Icon name="step-backward" />
        </button>
        <button
          className={`${styles.playerBtn} ${styles.seekBtn}`}
          onClick={() => seekBy(-10)}
          aria-label="Seek back 10 seconds"
          title="Back 10s"
        >
          <Icon name="undo" />
          <span className={styles.seekBtnLabel}>10</span>
        </button>
        <button
          className={`${styles.playerBtn} ${styles.playBtn}`}
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Icon name="pause" /> : <Icon name="play" />}
        </button>
        <button
          className={`${styles.playerBtn} ${styles.seekBtn}`}
          onClick={() => seekBy(10)}
          aria-label="Seek forward 10 seconds"
          title="Forward 10s"
        >
          <Icon name="redo" />
          <span className={styles.seekBtnLabel}>10</span>
        </button>
        <button
          className={styles.playerBtn}
          onClick={() => onTrackChange(Math.min(tracks.length - 1, trackIndex + 1))}
          disabled={trackIndex >= tracks.length - 1}
          aria-label="Next track"
        >
          <Icon name="step-forward" />
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
        {expanded ? <Icon name="chevron-down" /> : <Icon name="chevron-up" />}
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
        {volume === 0 ? (
          <Icon name="volume-mute" className={styles.volumeIcon} />
        ) : volume < 0.5 ? (
          <Icon name="volume-down" className={styles.volumeIcon} />
        ) : (
          <Icon name="volume-up" className={styles.volumeIcon} />
        )}
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
            {showArt ? <Icon name="eye-slash" /> : <Icon name="image" />}
          </button>
        )}

        {expanded && chapters.length > 0 && (
          <button
            className={`${styles.playerBtn} ${showChapterPanel ? styles.playerBtnActive : ''}`}
            onClick={() => setShowChapterPanel((v) => !v)}
            aria-label={showChapterPanel ? 'Hide bookmarks' : 'Show bookmarks'}
            title="Timestamps"
          >
            <Icon name="list-ol" />
          </button>
        )}

        <button className={styles.playerBtn} onClick={onClose} aria-label="Close player">
          <Icon name="times" />
        </button>
      </div>
    </>
  )

  const audioEl = (
    <audio
      ref={audioRef}
      preload="metadata"
      onPlay={() => setIsPlaying(true)}
      onPause={handlePause}
      onTimeUpdate={handleTimeUpdate}
      onLoadedMetadata={handleLoadedMetadata}
      onProgress={(e) => {
        const a = e.currentTarget
        if (a.buffered.length > 0) setBufferedEnd(a.buffered.end(a.buffered.length - 1))
      }}
      onEnded={handleEnded}
    />
  )

  const resumeModal = (
    <Modal isOpen={showResumeModal} onClose={handleSkipResume} title="Resume Listening">
      <div style={{ padding: '1rem', textAlign: 'center' }}>
        <p>
          You were at <strong>{formatTime(resumeTime)}</strong>
          {track?.resolutionStr ? ` in ${track.resolutionStr}` : ''}
        </p>
        <div
          style={{
            marginTop: '1rem',
            display: 'flex',
            gap: '10px',
            justifyContent: 'center',
          }}
        >
          <Button variant="secondary" onClick={handleSkipResume}>
            Start from Beginning
          </Button>
          <Button onClick={handleResume}>Resume</Button>
        </div>
      </div>
    </Modal>
  )

  const completeModal = (
    <Modal isOpen={showCompleteModal} onClose={() => setShowCompleteModal(false)} title="Finished!">
      <div style={{ padding: '1rem', textAlign: 'center' }}>
        <Icon
          name="check-circle"
          size={48}
          style={{ color: 'var(--accent-lighter)', marginBottom: '0.5rem' }}
        />
        <p style={{ fontSize: '1.1rem', fontWeight: 600 }}>{t ? t(title) : title}</p>
        <p style={{ color: 'var(--text-secondary)' }}>You finished this work!</p>
        <div
          style={{
            marginTop: '1rem',
            display: 'flex',
            gap: '10px',
            justifyContent: 'center',
          }}
        >
          <Button variant="secondary" onClick={() => setShowCompleteModal(false)}>
            Close
          </Button>
          <Button onClick={handleCompleteAndHome}>Mark Completed & Back to Home</Button>
        </div>
      </div>
    </Modal>
  )

  if (!expanded) {
    return createPortal(
      <>
        {audioEl}
        <div className={styles.playerBar}>{barContent}</div>
        {resumeModal}
        {completeModal}
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
      {resumeModal}
      {completeModal}
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
                        loading="lazy"
                        decoding="async"
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
                    <Icon name="chevron-left" />
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
                    <Icon name="chevron-right" />
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
