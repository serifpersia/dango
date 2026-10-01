import type { PlayerState } from '../types/player'
import { loadAutoplayEnabled } from '../lib/playbackCompletion'

export type Action =
  | { type: 'SET_STATE'; payload: Partial<PlayerState> }
  | { type: 'SET_MODE'; payload: 'sub' | 'dub' }
  | {
      type: 'SET_PROVIDER'
      payload: string
    }

const getPreferredMode = (): 'sub' | 'dub' => {
  return localStorage.getItem('preferredMode') === 'dub' ? 'dub' : 'sub'
}

const getPreferredProvider = (): PlayerState['selectedProvider'] => {
  const provider = localStorage.getItem('preferredProvider')
  if (provider && /^[a-z0-9-]+$/i.test(provider)) {
    return provider
  }
  return 'megaplay'
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
  isAutoplayEnabled: loadAutoplayEnabled(),
  showResumeModal: true,
  resumeTime: 0,
  resumeDuration: 0,
  skipIntervals: [],
  selectedProvider: getPreferredProvider(),
  loadingShowData: true,
  loadingVideo: false,
  error: null,
  showCookieModal: false,
  cookieProvider: null,
})

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
    default:
      return state
  }
}
