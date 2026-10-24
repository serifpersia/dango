import { profileStorage } from '../lib/profileStorage'
import { useEffect } from 'react'
import {
  buildOverlayCss,
  fitSubtitleSize,
  renderCueHtml,
  stripCueTags,
  subtitleBottomPx,
  type SubtitleStyleSettings,
} from '../lib/subtitleStyle'

interface UseSubtitleOverlayOptions {
  videoRef: { current: HTMLVideoElement | null }
  overlayRef: { current: HTMLDivElement | null }
  style: SubtitleStyleSettings
  activeSubtitleTrack: string | null
  delayMs: number
  enabled: boolean
}

// with the anime4k or the delay canvas the native cues are hidden, the cues
// are rendered into an overlay instead
export function useSubtitleOverlay({
  videoRef,
  overlayRef,
  style,
  activeSubtitleTrack,
  delayMs,
  enabled,
}: UseSubtitleOverlayOptions) {
  useEffect(() => {
    if (!enabled) return
    const video = videoRef.current
    const overlay = overlayRef.current
    if (!video || !overlay) return

    const subtitlesEnabled = profileStorage.getItem('playerSubtitlesEnabled') !== 'false'

    const renderCues = () => {
      overlay.innerHTML = ''
      if (!subtitlesEnabled || activeSubtitleTrack === 'off' || activeSubtitleTrack === null) {
        return
      }

      const track = Array.from(video.textTracks).find(
        (t) => t.language === activeSubtitleTrack || t.label === activeSubtitleTrack
      )
      if (!track || track.mode !== 'showing') return

      const delaySec = delayMs / 1000
      let cues: ArrayLike<TextTrackCue> | TextTrackCue[]
      if (delaySec > 0 && track.cues) {
        const t = video.currentTime - delaySec
        cues = Array.from(track.cues).filter((c) => c.startTime <= t && t <= c.endTime)
      } else {
        cues = Array.from(track.activeCues ?? [])
      }
      if (cues.length === 0) return

      const subtitleStyle: SubtitleStyleSettings = {
        ...style,
        fontSize: fitSubtitleSize(style.fontSize, video.clientHeight || 0),
      }
      const baseCss = buildOverlayCss(subtitleStyle)
      const baseBottomPx = subtitleBottomPx(video, subtitleStyle.position)
      const cueArray = Array.from(cues as ArrayLike<TextTrackCue>)

      cueArray.forEach((cue, index) => {
        const raw = String((cue as { text?: unknown }).text ?? '')
        if (!stripCueTags(raw).trim()) return
        const div = document.createElement('div')
        const stackOffset = (cueArray.length - 1 - index) * 1.7
        div.style.cssText = `${baseCss}\nbottom: calc(${baseBottomPx}px + ${stackOffset}em);`
        div.innerHTML = renderCueHtml(raw)
        overlay.appendChild(div)
      })
    }

    const handleCueChange = () => renderCues()
    const handleTimeUpdate = () => renderCues()

    Array.from(video.textTracks).forEach((t) => {
      t.addEventListener('cuechange', handleCueChange)
    })
    video.addEventListener('timeupdate', handleTimeUpdate)
    renderCues()

    return () => {
      Array.from(video.textTracks).forEach((t) => {
        t.removeEventListener('cuechange', handleCueChange)
      })
      video.removeEventListener('timeupdate', handleTimeUpdate)
      overlay.innerHTML = ''
    }
  }, [activeSubtitleTrack, delayMs, enabled, overlayRef, style, videoRef])
}
