import { PlayerAudio } from '../player/PlayerMedia'
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
import { trpcClient } from '../../lib/trpc'
import { clearDiscordPresence } from '../../lib/trpcBeacon'
import { formatTime } from '../../lib/utils'
import { usePlayerCore, usePlayerState, usePlayerTimeline } from '../../lib/player/usePlayerCore'
import { usePlayerInput } from '../../lib/player/usePlayerInput'
import { usePlayer } from '../player/PlayerContext'
import { PlayerProvider } from '../player/PlayerProvider'
import {
  PlayPauseButton,
  SeekButton,
  SeekSlider,
  VolumeSlider,
  PlayerTime,
  PlayerStatus,
} from '../player/PlaybackControls'
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

const AsmrPlayer: React.FC<AsmrPlayerProps> = (props) => {
  const { engine } = usePlayerCore<HTMLAudioElement>({
    volumeKey: 'asmrVolume',
    mutedKey: 'asmrMuted',
  })
  return (
    <PlayerProvider engine={engine}>
      <AsmrPlayerContent {...props} />
    </PlayerProvider>
  )
}

const AsmrPlayerContent: React.FC<AsmrPlayerProps> = ({
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
  const engine = usePlayer()
  const audioRef = engine.mediaRef as { current: HTMLAudioElement | null }
  const { duration, volume, isPlaying } = usePlayerState(engine)
  const { currentTime } = usePlayerTimeline(engine)
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
  const navigate = useNavigate()
  const workId = React.useMemo(() => (rjCode ? buildAsmrId(rjCode) : ''), [rjCode])
  const saveProgress = useSaveAsmrProgress()
  const addBookmark = useAddAsmrBookmark()
  const { data: progressData } = useAsmrProgress(workId || undefined)
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
  const progressDataRef = useRef(progressData)
  progressDataRef.current = progressData
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
      saveTrackRef.current(
        metaAtLoad,
        engine.getTimeline().currentTime,
        engine.getState().duration || durationRef.current,
        true
      )
    }

    timeRef.current = 0
    durationRef.current = 0
    lastSavedTimeRef.current = 0

    const knownRow = progressDataRef.current?.progress?.find((r) => r.trackIndex === trackIndex)
    const knownCt = knownRow?.currentTime || 0
    const knownDur = knownRow?.duration || 0
    const holdForResume = knownCt >= 10 && knownDur - knownCt >= 15

    const disposeSource = engine.loadSource(
      { url: trackLink, hls: trackIsHls },
      { autoPlay: !holdForResume }
    )
    return () => {
      saveAtUnload()
      disposeSource()
    }
  }, [engine, trackLink, trackIsHls, workId, trackIndex, trackLabel, audioRef])
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
    hasResumedRef.current = trackKey
    if (!(ct >= 10 && dur - ct >= 15 && timeRef.current < ct)) return
    const audio = audioRef.current
    if (!audio) return
    engine.seek(ct)
    timeRef.current = ct
    void engine.play()
  }, [engine, audioRef, savedRow, duration, trackKey])

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
      trpcClient.discord.asmrPresence
        .mutate({
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
        })
        .catch(() => {})
      trpcClient.discord.heartbeat.mutate({ sessionId: sessionIdRef.current }).catch(() => {})
    },
    [audioRef, title, tracks, trackIndex, images, isAdult, rjCode]
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
    const clearAsmrPresence = () => clearDiscordPresence(sid)

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
      if (
        e.defaultPrevented ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target instanceof Element &&
          e.target.closest(
            'input, textarea, select, button, [role="slider"], [contenteditable="true"]'
          ))
      )
        return
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

  const handleEnded = () => {
    flushSave(true)
    if (trackIndex < tracks.length - 1) {
      onTrackChange(trackIndex + 1)
    } else {
      setShowCompleteModal(true)
    }
  }

  const handleTimeUpdate = (e: React.TargetedEvent<HTMLAudioElement>) => {
    const t = e.currentTarget.currentTime
    timeRef.current = t
    if (progressSaveTimerRef.current) clearTimeout(progressSaveTimerRef.current)
    progressSaveTimerRef.current = setTimeout(() => flushSaveRef.current(), 5000)
  }

  const handlePause = () => {
    flushSaveRef.current()
  }

  const handleLoadedMetadata = (e: React.TargetedEvent<HTMLAudioElement>) => {
    const d = e.currentTarget.duration
    durationRef.current = Number.isFinite(d) ? d : 0
  }

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

  const seekTo = (time: number) => engine.seek(time)
  usePlayerInput(engine, () => setShowControls(true), !expanded || (!showArt && !showChapterPanel))
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
        <SeekButton seconds={-10} className={`${styles.playerBtn} ${styles.seekBtn}`} />
        <PlayPauseButton className={`${styles.playerBtn} ${styles.playBtn}`} />
        <SeekButton seconds={10} className={`${styles.playerBtn} ${styles.seekBtn}`} />
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
        <PlayerTime className={styles.timeLabel} />
        <SeekSlider className={styles.seekBar} />
        <PlayerTime className={styles.timeLabel} durationOnly />
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
        <PlayerStatus />
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
        <VolumeSlider className={styles.volumeBar} />
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
    <PlayerAudio
      preload="metadata"
      onPause={handlePause}
      onTimeUpdate={handleTimeUpdate}
      onLoadedMetadata={handleLoadedMetadata}
      onEnded={handleEnded}
    />
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
        <div ref={engine.containerRef} data-player-root="true" className={styles.playerBar}>
          {barContent}
        </div>
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
      {completeModal}
      <div
        ref={engine.containerRef}
        data-player-root="true"
        className={`${styles.npOverlay} ${!showControls ? styles.npOverlayControlsHidden : ''}`}
      >
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
                        alt={`${t ? t(title) : title} - work image`}
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
