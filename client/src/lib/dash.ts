export interface DashHost {
  initialize(el: HTMLMediaElement, url: string): void
  on(event: string, callback: (...args: unknown[]) => void): void
  addRequestInterceptor(interceptor: (request: { url: string }) => { url: string }): void
  destroy(): void
}

export interface DashModule {
  MediaPlayer: () => { create: () => DashHost }
}

let cachedDash: DashModule | null = null
let loadPromise: Promise<DashModule | null> | null = null

export async function loadDash(): Promise<DashModule | null> {
  if (cachedDash) return cachedDash
  if (!loadPromise) {
    loadPromise = import(/* @vitePreload: false */ 'dashjs')
      .then((mod) => {
        cachedDash = resolveDashModule(mod)
        return cachedDash
      })
      .catch(() => null)
  }
  return loadPromise
}

export function resolveDashModule(mod: unknown): DashModule | null {
  const candidate = mod as {
    default?: { MediaPlayer?: unknown }
    MediaPlayer?: unknown
  }
  const MediaPlayer =
    candidate?.default?.MediaPlayer ?? candidate?.MediaPlayer ?? candidate?.default
  if (typeof MediaPlayer !== 'function') return null
  return { MediaPlayer: MediaPlayer as DashModule['MediaPlayer'] }
}
