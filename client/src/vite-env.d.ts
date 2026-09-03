interface ImportMetaEnv {
  readonly VITE_TELEMETRY_URL: string
  readonly VITE_ANILIST_CLIENT_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
declare class Hls {
  static isSupported(): boolean
  static Events: {
    ERROR: string
    MANIFEST_PARSED: string
    KEY_LOADED: string
    LEVEL_LOADED: string
  }
  constructor(config?: Record<string, unknown>)
  loadSource(src: string): void
  attachMedia(media: HTMLMediaElement): void
  on(event: string, listener: (event: string, data: unknown) => void): void
  destroy(): void
}

interface Window {
  Hls?: typeof Hls
}
