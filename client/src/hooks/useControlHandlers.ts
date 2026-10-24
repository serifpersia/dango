import { profileStorage } from '../lib/profileStorage'
import { pickSubtitleIndex, subtitleKey } from '../lib/subtitles'
import type useVideoPlayer from './useVideoPlayer'

export function useControlHandlers(player: ReturnType<typeof useVideoPlayer>) {
  const { state, refs, actions } = player

  const handleSubtitleSelection = (trackId: string | null) => {
    if (!refs.videoRef.current) return
    actions.setActiveSubtitleTrack(trackId)
    try {
      if (trackId === null || trackId === 'off') {
        profileStorage.setItem('playerSubtitlesEnabled', 'false')
      } else {
        profileStorage.setItem('playerSubtitlesEnabled', 'true')
        const chosen = state.availableSubtitles.find(
          (t) => t.label === trackId || t.lang === trackId
        )
        if (chosen) profileStorage.setItem('playerLastSubtitle', subtitleKey(chosen))
        else profileStorage.setItem('playerLastSubtitle', trackId)
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
      lastKey = profileStorage.getItem('playerLastSubtitle')
    } catch {
      // ignore
    }
    const idx = pickSubtitleIndex(state.availableSubtitles, { lastKey, enabled: true })
    if (idx < 0) return
    const trackToActivate = state.availableSubtitles[idx]
    handleSubtitleSelection(trackToActivate.label || trackToActivate.lang)
  }

  return {
    handleSubtitleSelection,
    isSubtitleActive,
    handleCCToggle,
  }
}
