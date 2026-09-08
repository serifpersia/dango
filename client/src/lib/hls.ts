let cachedHls: typeof import('hls.js').default | null = null
let loadPromise: Promise<typeof import('hls.js').default | null> | null = null

export async function loadHls(): Promise<typeof import('hls.js').default | null> {
  if (cachedHls) return cachedHls
  if (!loadPromise) {
    loadPromise = import('hls.js')
      .then((mod) => {
        cachedHls = mod.default
        return cachedHls
      })
      .catch(() => null)
  }
  return loadPromise
}

export function isHlsSupported(Hls: { isSupported: () => boolean } | null): boolean {
  try {
    return !!Hls && Hls.isSupported()
  } catch {
    return false
  }
}

export function canPlayHlsNatively(video: HTMLMediaElement): boolean {
  return (
    video.canPlayType('application/vnd.apple.mpegurl') !== '' ||
    video.canPlayType('application/x-mpegURL') !== ''
  )
}
