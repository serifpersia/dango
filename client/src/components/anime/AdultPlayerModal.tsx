import { createPortal } from 'preact/compat'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../lib/trpc'
import { usePlayerCore, usePlayerState } from '../../lib/player/usePlayerCore'
import PlayerSurface from '../player/PlayerSurface'
import CenterControls from '../player/CenterControls'
import { PlayerVideo } from '../player/PlayerMedia'
import {
  PlayerTimeline,
  PlayPauseButton,
  PlayerVolume,
  FullscreenButton,
} from '../player/PlaybackControls'
import SettingsShell from '../player/SettingsShell'
import Icon from '../common/Icon'
import { formatTime } from '../../lib/utils'
import modalStyles from './AdultPlayerModal.module.css'
import styles from '../player/PlayerControls.module.css'

type Props = {
  item: { id: string; name: string; provider: string } | null
  onClose: () => void
}

export default function AdultPlayerModal({ item, onClose }: Props) {
  const trpc = useTRPC()
  const { engine } = usePlayerCore()
  const { duration, showControls, isScrubbing, isPlaying } = usePlayerState(engine)
  const [quality, setQuality] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const timeLabelRef = useRef<HTMLSpanElement>(null)
  const controlsVisible = showControls || isScrubbing || showSettings || !isPlaying

  const {
    data: streams,
    isLoading,
    error,
  } = useQuery({
    ...trpc.data.matureStream.queryOptions({
      provider: item?.provider || '',
      nativeId: item?.id || '',
      episode: '1',
    }),
    enabled: !!item,
  })

  const links = useMemo(
    () =>
      (streams ?? []).flatMap(
        (s: { links?: { resolutionStr: string; link: string; hls: boolean }[] }) => s.links || []
      ),
    [streams]
  )

  useEffect(() => {
    setQuality(0)
    setShowSettings(false)
  }, [item?.id, item?.provider, links.length])

  const selected = links[quality] || links[0]
  const source = selected?.link ? { url: selected.link, hls: !!selected.hls } : undefined

  useEffect(() => {
    if (!item) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, onClose])

  useEffect(() => {
    if (!item) return
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
    }
  }, [item])

  if (!item) return null

  const bottomBar = (
    <div
      className={`${styles.controlsOverlay} ${!controlsVisible ? styles.hidden : ''}`}
      style={{ background: 'none', justifyContent: 'flex-end' }}
    >
      <div
        className={styles.bottomControls}
        data-speed-boost-ignore="true"
        onClick={(e) => e.stopPropagation()}
      >
        <PlayerTimeline
          classes={{
            container: styles.progressBarContainer,
            scrubbing: styles.scrubbing,
            timeBubble: styles.timeBubble,
            bar: styles.progressBar,
            buffered: styles.bufferedBar,
            watched: styles.watchedBar,
            thumb: styles.thumb,
          }}
          timeLabelRef={timeLabelRef}
        />
        <div className={styles.bottomControlsRow}>
          <div className={styles.leftControls}>
            <PlayPauseButton className={styles.controlBtn} />
            <PlayerVolume buttonClassName={styles.controlBtn} />
            <span className={styles.timeDisplay} ref={timeLabelRef}>
              {formatTime(0)} / {formatTime(duration)}
            </span>
          </div>
          <div className={styles.rightControls}>
            <button
              className={`${styles.controlBtn} ${showSettings ? styles.active : ''}`}
              onClick={() => setShowSettings((v) => !v)}
              aria-label="Settings"
            >
              <Icon name="cog" />
            </button>
            <FullscreenButton className={styles.controlBtn} />
          </div>
        </div>
      </div>
    </div>
  )

  const settingsPanel = showSettings ? (
    <div
      data-player-ui="true"
      data-speed-boost-ignore="true"
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'absolute', right: 12, bottom: 64, zIndex: 60 }}
    >
      <SettingsShell
        classes={{
          panel: modalStyles.settingsPanel,
          header: modalStyles.settingsHeader,
          backBtn: modalStyles.settingsBack,
          title: modalStyles.settingsTitle,
          content: modalStyles.settingsContent,
        }}
        title="Quality"
        showBack={false}
        onBack={() => setShowSettings(false)}
      >
        {links.length === 0 ? (
          <div className={modalStyles.settingsEmpty}>No qualities</div>
        ) : (
          links.map((l, i) => (
            <button
              key={`${l.resolutionStr}-${i}`}
              className={`${modalStyles.qualityOption} ${i === quality ? modalStyles.qualityActive : ''}`}
              onClick={() => {
                setQuality(i)
                setShowSettings(false)
              }}
            >
              {l.resolutionStr}
            </button>
          ))
        )}
      </SettingsShell>
    </div>
  ) : null

  return createPortal(
    <div className={modalStyles.backdrop} onClick={onClose} role="presentation">
      <div className={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={modalStyles.header}>
          <div className={modalStyles.title} title={item.name}>
            {item.name}
          </div>
          <div className={modalStyles.actions}>
            <button
              type="button"
              className={modalStyles.close}
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>
        <div className={modalStyles.playerWrap}>
          {isLoading && <div className={modalStyles.status}>Loading stream...</div>}
          {!isLoading && (error || links.length === 0) && (
            <div className={modalStyles.status}>
              {error ? 'Failed to load stream' : 'No stream available'}
            </div>
          )}
          <PlayerSurface
            engine={engine}
            centerControls={!isLoading && source ? <CenterControls /> : null}
            bottomBar={!isLoading && source ? bottomBar : null}
            settingsPanel={settingsPanel}
            isInteracting={showSettings}
            className={modalStyles.surface}
          >
            {source ? (
              <PlayerVideo source={source} className={modalStyles.video} playsInline />
            ) : (
              <video className={modalStyles.video} disablePictureInPicture />
            )}
          </PlayerSurface>
        </div>
      </div>
    </div>,
    document.body
  )
}
