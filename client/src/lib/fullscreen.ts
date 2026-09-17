type FullscreenContainer = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>
  webkitRequestFullScreen?: () => void | Promise<void>
}

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => void | Promise<void>
  webkitCancelFullScreen?: () => void
}

type FullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void | Promise<void>
  webkitExitFullscreen?: () => void
  webkitDisplayingFullscreen?: boolean
  webkitSupportsFullscreen?: boolean
}

function getDoc(): FullscreenDocument {
  return document as FullscreenDocument
}

export function getFullscreenElement(
  video?: HTMLVideoElement | null
): Element | HTMLVideoElement | null {
  const doc = getDoc()
  if (document.fullscreenElement) return document.fullscreenElement
  if (doc.webkitFullscreenElement) return doc.webkitFullscreenElement
  const v = video as FullscreenVideo | null | undefined
  if (v?.webkitDisplayingFullscreen) return v
  return null
}

export function isFullscreenActive(video?: HTMLVideoElement | null): boolean {
  return getFullscreenElement(video) !== null
}

export async function requestFullscreen(
  container: HTMLElement,
  video?: HTMLVideoElement | null
): Promise<void> {
  if (getFullscreenElement(video)) return
  const el = container as FullscreenContainer
  try {
    if (typeof container.requestFullscreen === 'function') {
      await container.requestFullscreen()
      return
    }
    if (typeof el.webkitRequestFullscreen === 'function') {
      await el.webkitRequestFullscreen()
      return
    }
    if (typeof el.webkitRequestFullScreen === 'function') {
      await el.webkitRequestFullScreen()
      return
    }
  } catch {
    // ignore
  }
  const v = video as FullscreenVideo | null | undefined
  if (v && typeof v.webkitEnterFullscreen === 'function') {
    if (v.webkitSupportsFullscreen === false) return
    try {
      await v.webkitEnterFullscreen()
    } catch {
      // ignore
    }
  }
}

export async function exitFullscreen(video?: HTMLVideoElement | null): Promise<void> {
  const doc = getDoc()
  try {
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      await document.exitFullscreen()
      return
    }
    if (doc.webkitFullscreenElement && typeof doc.webkitExitFullscreen === 'function') {
      await doc.webkitExitFullscreen()
      return
    }
  } catch {
    // ignore
  }
  const v = video as FullscreenVideo | null | undefined
  if (v?.webkitDisplayingFullscreen && typeof v.webkitExitFullscreen === 'function') {
    try {
      v.webkitExitFullscreen()
    } catch {
      // ignore
    }
    return
  }
  try {
    if (typeof doc.webkitCancelFullScreen === 'function') doc.webkitCancelFullScreen()
    else if (!document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      const active = document.fullscreenElement ?? doc.webkitFullscreenElement
      if (active) await document.exitFullscreen()
    }
  } catch {
    // ignore
  }
}

export async function toggleFullscreen(
  container: HTMLElement | null,
  video?: HTMLVideoElement | null
): Promise<void> {
  if (!container && !video) return
  if (isFullscreenActive(video)) {
    await exitFullscreen(video)
  } else if (container) {
    await requestFullscreen(container, video)
  }
}

export function subscribeFullscreen(
  getVideo: () => HTMLVideoElement | null,
  onChange: (active: boolean) => void
): () => void {
  const handle = () => {
    try {
      onChange(isFullscreenActive(getVideo()))
    } catch {
      // ignore
    }
  }
  const doc = getDoc()
  const captureHandler = handle as EventListener
  doc.addEventListener('fullscreenchange', handle)
  doc.addEventListener('webkitfullscreenchange', captureHandler)
  doc.addEventListener('webkitbeginfullscreen', captureHandler, true)
  doc.addEventListener('webkitendfullscreen', captureHandler, true)
  const video = getVideo() as FullscreenVideo | null
  video?.addEventListener('webkitbeginfullscreen', captureHandler)
  video?.addEventListener('webkitendfullscreen', captureHandler)
  return () => {
    doc.removeEventListener('fullscreenchange', handle)
    doc.removeEventListener('webkitfullscreenchange', captureHandler)
    doc.removeEventListener('webkitbeginfullscreen', captureHandler, true)
    doc.removeEventListener('webkitendfullscreen', captureHandler, true)
    video?.removeEventListener('webkitbeginfullscreen', captureHandler)
    video?.removeEventListener('webkitendfullscreen', captureHandler)
  }
}
