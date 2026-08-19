import type { PlayerState, VideoSource, VideoLink } from '../types/player'

export type Action =
  | { type: 'SET_STATE'; payload: Partial<PlayerState> }
  | { type: 'SET_MODE'; payload: 'sub' | 'dub' }
  | {
      type: 'SET_PROVIDER'
      payload:
        | 'animepahe'
        | '123anime'
        | 'animeya'
        | 'megaplay'
        | 'wh'
        | 'hn'
        | 'anilight'
        | 'anidb'
        | 'ht'
        | 'op'
    }
  | { type: 'SET_OVERRIDE_SOURCE'; payload: { source: VideoSource; link: VideoLink } | null }

const getPreferredMode = (): 'sub' | 'dub' => {
  return localStorage.getItem('preferredMode') === 'dub' ? 'dub' : 'sub'
}

const getPreferredProvider = (): PlayerState['selectedProvider'] => {
  const provider = localStorage.getItem('preferredProvider')
  const validProviders: string[] = [
    'anidb',
    'megaplay',
    'animeya',
    'animepahe',
    '123anime',
    'wh',
    'hn',
    'anilight',
    'ht',
    'op',
  ]
  if (provider && validProviders.includes(provider)) {
    return provider as PlayerState['selectedProvider']
  }
  return 'anidb'
}

export const createInitialState = (): PlayerState => ({
  showMeta: {},
  episodes: [],
  watchedEpisodes: [],
  watchlistStatus: null,
  showCombinedDetails: false,
  currentMode: getPreferredMode(),
  inWatchlist: false,
  videoSources: [],
  selectedSource: null,
  selectedLink: null,
  forceNativePlayer: localStorage.getItem('forceNativePlayer') === 'true',
  isAutoplayEnabled: localStorage.getItem('autoplayEnabled') === 'true',
  showResumeModal: true,
  resumeTime: 0,
  resumeDuration: 0,
  skipIntervals: [],
  selectedProvider: getPreferredProvider(),
  loadingShowData: true,
  loadingVideo: false,
  loadingDetails: false,
  error: null,
  detailsError: null,
  showCookieModal: false,
  cookieProvider: null,
})

export const initialState: PlayerState = createInitialState()

export function playerReducer(state: PlayerState, action: Action): PlayerState {
  switch (action.type) {
    case 'SET_STATE':
      return { ...state, ...action.payload }
    case 'SET_MODE':
      return {
        ...state,
        currentMode: action.payload,
        videoSources: [],
        selectedSource: null,
        selectedLink: null,
      }
    case 'SET_PROVIDER':
      return { ...state, selectedProvider: action.payload }
    case 'SET_OVERRIDE_SOURCE':
      return {
        ...state,
        selectedSource: action.payload?.source ?? null,
        selectedLink: action.payload?.link ?? null,
      }
    default:
      return state
  }
}
