import { profileStorage } from '../lib/profileStorage'
import { useEffect } from 'react'
import { pickSubtitleIndex } from '../lib/subtitles'
import type { SubtitleTrack } from '../types/player'

interface UseSubtitleTracksOptions {
  videoRef: { current: HTMLVideoElement | null }
  availableSubtitles: SubtitleTrack[]
  activeSubtitleTrack: string | null
  setAvailableSubtitles: (tracks: SubtitleTrack[]) => void
  setActiveSubtitleTrack: (track: string) => void
}

// the track list of the video element, the auto pick of the first track and
// the showing/hidden mode of every track
export function useSubtitleTracks({
  videoRef,
  availableSubtitles,
  activeSubtitleTrack,
  setAvailableSubtitles,
  setActiveSubtitleTrack,
}: UseSubtitleTracksOptions) {
  useEffect(() => {
    const videoElement = videoRef.current
    if (!videoElement) return
    const handleTracksChange = () => {
      const tracks: SubtitleTrack[] = Array.from(videoElement.textTracks).map((t) => ({
        label: t.label,
        lang: t.language,
        src: undefined,
        mode: t.mode as 'showing' | 'hidden' | 'disabled',
      }))
      setAvailableSubtitles(tracks)
    }
    videoElement.textTracks.addEventListener('addtrack', handleTracksChange)
    videoElement.textTracks.addEventListener('removetrack', handleTracksChange)
    handleTracksChange()
    return () => {
      videoElement.textTracks.removeEventListener('addtrack', handleTracksChange)
      videoElement.textTracks.removeEventListener('removetrack', handleTracksChange)
    }
  }, [videoRef, setAvailableSubtitles])

  useEffect(() => {
    if (
      activeSubtitleTrack === null &&
      availableSubtitles.length > 0 &&
      profileStorage.getItem('playerSubtitlesEnabled') !== 'false'
    ) {
      let lastKey: string | null = null
      try {
        lastKey = profileStorage.getItem('playerLastSubtitle')
      } catch {
        // ignore
      }
      const idx = pickSubtitleIndex(availableSubtitles, {
        lastKey,
        enabled: true,
      })
      if (idx < 0) {
        setActiveSubtitleTrack('off')
        return
      }
      const trackToActivate = availableSubtitles[idx]
      setActiveSubtitleTrack(trackToActivate.lang || trackToActivate.label)
    }
  }, [activeSubtitleTrack, availableSubtitles, setActiveSubtitleTrack])

  useEffect(() => {
    const video = videoRef.current
    if (!video || availableSubtitles.length === 0) return
    const active = activeSubtitleTrack
    const enabled = profileStorage.getItem('playerSubtitlesEnabled') !== 'false'
    if (!enabled || active === 'off' || active === null) {
      Array.from(video.textTracks).forEach((t) => {
        t.mode = 'hidden'
      })
      return
    }
    let matched = false
    Array.from(video.textTracks).forEach((t) => {
      const isMatch = t.language === active || t.label === active
      const shouldShow = isMatch && !matched
      t.mode = shouldShow ? 'showing' : 'hidden'
      if (shouldShow) matched = true
    })
    if (!matched && video.textTracks.length > 0) {
      const fallback =
        Array.from(video.textTracks).find((t) => t.language === 'en' || t.label === 'English') ||
        video.textTracks[0]
      if (fallback) fallback.mode = 'showing'
    }
  }, [activeSubtitleTrack, availableSubtitles, videoRef])
}
