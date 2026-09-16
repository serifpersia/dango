export interface HlsAudioHost {
  audioTracks?: unknown[] | null
  audioTrack: number
  on: (event: string, cb: (...args: never[]) => void) => void
  off: (event: string, cb: (...args: never[]) => void) => void
}

export interface HlsAudioEvents {
  MANIFEST_PARSED: string
  AUDIO_TRACK_SWITCHED: string
}

export interface HlsAudioBinding {
  getWant: () => number
  onResolve: (id: number) => void
}

export function bindHlsAudioTracks(
  hls: HlsAudioHost,
  events: HlsAudioEvents,
  binding: HlsAudioBinding
): () => void {
  const onManifest = () => {
    const count = Array.isArray(hls.audioTracks) ? hls.audioTracks.length : 0
    const want = binding.getWant()
    const target = count > 0 ? Math.min(Math.max(0, want), count - 1) : want
    hls.audioTrack = target
    if (target !== want) binding.onResolve(target)
  }
  const onSwitched = (_event: unknown, data: { id: number }) => {
    const want = binding.getWant()
    const count = Array.isArray(hls.audioTracks) ? hls.audioTracks.length : 0
    if (data.id !== want && want >= 0 && want < count) {
      if (hls.audioTrack !== want) hls.audioTrack = want
      return
    }
    binding.onResolve(data.id)
  }
  hls.on(events.MANIFEST_PARSED, onManifest)
  hls.on(events.AUDIO_TRACK_SWITCHED, onSwitched)
  return () => {
    hls.off(events.MANIFEST_PARSED, onManifest)
    hls.off(events.AUDIO_TRACK_SWITCHED, onSwitched)
  }
}
