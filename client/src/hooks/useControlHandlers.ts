import { pickSubtitleIndex, subtitleKey } from '../lib/subtitles'
import type useVideoPlayer from './useVideoPlayer'

export function useControlHandlers(player: ReturnType<typeof useVideoPlayer>) {
  const { state, refs, actions } = player

  const handleVolumeChange = (newVolume: number) => {
    if (!refs.videoRef.current) return
    refs.videoRef.current.volume = newVolume
    refs.videoRef.current.muted = newVolume === 0
  }

  const handleSeek = (percent: number) => {
    if (!refs.videoRef.current || isNaN(state.duration) || state.duration === 0) return
    refs.videoRef.current.currentTime = percent * state.duration
    actions.sendProgressUpdate(false, true)
  }

  const handleScrubStart = () => {
    if (!refs.videoRef.current) return
    actions.setIsScrubbing(true)
    actions.wasPlayingBeforeScrub.current = !refs.videoRef.current.paused
    refs.videoRef.current.pause()
  }

  const handleScrubMove = (percent: number) => {
    if (!refs.videoRef.current || !state.duration) return
    refs.videoRef.current.currentTime = percent * state.duration
  }

  const handleScrubEnd = () => {
    actions.setIsScrubbing(false)
    if (actions.wasPlayingBeforeScrub.current) {
      refs.videoRef.current?.play()
    }
  }

  const handleSubtitleSelection = (trackId: string | null) => {
    if (!refs.videoRef.current) return
    actions.setActiveSubtitleTrack(trackId)
    try {
      if (trackId === null || trackId === 'off') {
        localStorage.setItem('playerSubtitlesEnabled', 'false')
      } else {
        localStorage.setItem('playerSubtitlesEnabled', 'true')
        const chosen = state.availableSubtitles.find(
          (t) => t.label === trackId || t.lang === trackId
        )
        if (chosen) localStorage.setItem('playerLastSubtitle', subtitleKey(chosen))
        else localStorage.setItem('playerLastSubtitle', trackId)
      }
    } catch {
      // ignore
    }
    let matched = false
    Array.from(refs.videoRef.current.textTracks).forEach((track) => {
      const isMatch =
        trackId !== null &&
        trackId !== 'off' &&
        (track.language === trackId || track.label === trackId)
      const shouldShow = isMatch && !matched
      track.mode = shouldShow ? 'showing' : 'hidden'
      if (shouldShow) matched = true
    })
  }

  const isSubtitleActive = state.activeSubtitleTrack !== null && state.activeSubtitleTrack !== 'off'

  const handleCCToggle = () => {
    if (!refs.videoRef.current) return
    if (isSubtitleActive) {
      handleSubtitleSelection('off')
      return
    }
    if (state.availableSubtitles.length === 0) return
    let lastKey: string | null = null
    try {
      lastKey = localStorage.getItem('playerLastSubtitle')
    } catch {
      // ignore
    }
    const idx = pickSubtitleIndex(state.availableSubtitles, { lastKey, enabled: true })
    if (idx < 0) return
    const trackToActivate = state.availableSubtitles[idx]
    handleSubtitleSelection(trackToActivate.label || trackToActivate.lang)
  }

  return {
    handleVolumeChange,
    handleSeek,
    handleScrubStart,
    handleScrubMove,
    handleScrubEnd,
    handleSubtitleSelection,
    isSubtitleActive,
    handleCCToggle,
  }
}
