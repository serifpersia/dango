import { profileStorage } from '../lib/profileStorage'
import { useEffect, useRef } from 'react'
import { pickSubtitleIndex } from '../lib/subtitles'
import { isProgressCompleted } from '../lib/playbackCompletion'
import type { PlayerEngine } from '../lib/player/engine'
import type { SubtitleTrack, VideoLink, VideoSource } from '../types/player'

interface UseMediaSourceOptions {
  engine: PlayerEngine
  videoRef: { current: HTMLVideoElement | null }
  selectedSource: VideoSource | null
  selectedLink: VideoLink | null
  loadingVideo: boolean
  testClipActive: boolean
  resumeTime: number
  resumeDuration?: number
  showResumeModal: boolean
  calibReturnRef: { current: number | null }
  setAvailableSubtitles: (tracks: SubtitleTrack[]) => void
  setActiveSubtitleTrack: (track: string) => void
  onFatalError: () => void
}

// attaches the stream to the video element: the hls config, the subtitle
// tracks, the resume seek and the saved volume
export function useMediaSource({
  engine,
  videoRef,
  selectedSource,
  selectedLink,
  loadingVideo,
  testClipActive,
  resumeTime,
  resumeDuration = 0,
  showResumeModal,
  calibReturnRef,
  setAvailableSubtitles,
  setActiveSubtitleTrack,
  onFatalError,
}: UseMediaSourceOptions) {
  const seekToTimeRef = useRef<number | null>(null)
  const resumeTimeRef = useRef(resumeTime)
  const resumeDurationRef = useRef(resumeDuration)
  const showResumeModalRef = useRef(showResumeModal)
  const onFatalErrorRef = useRef(onFatalError)
  onFatalErrorRef.current = onFatalError

  useEffect(() => {
    resumeTimeRef.current = resumeTime
    resumeDurationRef.current = resumeDuration
    showResumeModalRef.current = showResumeModal
  }, [resumeTime, resumeDuration, showResumeModal])

  useEffect(() => {
    const videoElement = videoRef.current
    if (!videoElement) return

    while (videoElement.firstChild) videoElement.removeChild(videoElement.firstChild)
    if (testClipActive) {
      return engine.loadSource({ url: '/av-sync-test.mp4' }, { autoPlay: true })
    }
    if (loadingVideo || !selectedSource || !selectedLink || selectedSource.type === 'iframe') {
      engine.unload()
      return
    }

    if (calibReturnRef.current != null) {
      seekToTimeRef.current = calibReturnRef.current
      calibReturnRef.current = null
    } else if (
      seekToTimeRef.current === null &&
      resumeTimeRef.current > 5 &&
      !showResumeModalRef.current &&
      !isProgressCompleted(resumeTimeRef.current, resumeDurationRef.current)
    ) {
      seekToTimeRef.current = resumeTimeRef.current
    } else if (seekToTimeRef.current === null && showResumeModalRef.current) {
      seekToTimeRef.current = 0
    }

    let proxiedUrl = selectedLink.link
    if (!proxiedUrl.startsWith('/api/proxy')) {
      proxiedUrl = `/api/proxy?url=${encodeURIComponent(proxiedUrl)}`
      if (selectedLink.headers?.Referer) {
        proxiedUrl += `&referer=${encodeURIComponent(selectedLink.headers.Referer)}`
      }
    }

    if (selectedSource.subtitles) {
      const subtitlesEnabled = profileStorage.getItem('playerSubtitlesEnabled') !== 'false'
      let lastKey: string | null = null
      try {
        lastKey = profileStorage.getItem('playerLastSubtitle')
      } catch {
        // ignore
      }
      const pickedIdx = pickSubtitleIndex(selectedSource.subtitles, {
        lastKey,
        enabled: subtitlesEnabled,
      })
      const pickedTrack = pickedIdx >= 0 ? selectedSource.subtitles[pickedIdx] : null
      selectedSource.subtitles.forEach((sub) => {
        const track = document.createElement('track')
        track.kind = 'subtitles'
        track.label = sub.label
        track.srclang = sub.lang

        const subSrc = sub.src ?? sub.url
        if (subSrc) {
          let subUrl = `/api/subtitle-proxy?url=${encodeURIComponent(subSrc)}`
          const subReferer = selectedLink.headers?.Referer
          if (subReferer) {
            subUrl += `&referer=${encodeURIComponent(subReferer)}`
          }
          track.src = subUrl
        }

        if (pickedTrack && sub.label === pickedTrack.label && sub.lang === pickedTrack.lang) {
          track.default = true
        }
        videoElement.appendChild(track)
      })
      if (!subtitlesEnabled) {
        setActiveSubtitleTrack('off')
      }
      setAvailableSubtitles(selectedSource.subtitles)
    }

    const targetTime = seekToTimeRef.current ?? 0
    seekToTimeRef.current = null

    const isLowEnd = document.body.classList.contains('low-end')
    return engine.loadSource(
      { url: proxiedUrl, hls: selectedLink.hls },
      {
        initialTime: targetTime,
        autoPlay:
          !(showResumeModalRef.current && resumeTimeRef.current > 5) &&
          !isProgressCompleted(resumeTimeRef.current, resumeDurationRef.current),
        hlsConfig: {
          maxBufferLength: isLowEnd ? 15 : 30,
          maxMaxBufferLength: isLowEnd ? 30 : 60,
          maxBufferSize: (isLowEnd ? 25 : 60) * 1000 * 1000,
          startLevel: -1,
        },
        onHls: (hls, HlsClass) => {
          if (!selectedSource.subtitles?.length) return
          const disableEmbeddedSubs = () => {
            if (hls.subtitleTrack !== -1) hls.subtitleTrack = -1
          }
          hls.on(HlsClass.Events.SUBTITLE_TRACK_SWITCH, disableEmbeddedSubs)
          disableEmbeddedSubs()
        },
        onError: () => onFatalErrorRef.current(),
      }
    )
  }, [
    engine,
    selectedSource,
    selectedLink,
    videoRef,
    calibReturnRef,
    loadingVideo,
    testClipActive,
    setActiveSubtitleTrack,
    setAvailableSubtitles,
  ])

  // the page keeps the position when the user picks another source
  return { seekToTimeRef }
}
