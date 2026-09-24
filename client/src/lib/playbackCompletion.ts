export const COMPLETION_THRESHOLD = 0.8

export const RESUME_MIN_TIME = 5

export const SEEK_END_GRACE_MS = 2000

const AUTOPLAY_KEY = 'autoplayEnabled'

export const isProgressCompleted = (currentTime: number, duration: number): boolean =>
  duration > 0 && currentTime >= duration * COMPLETION_THRESHOLD

export const hasResumableProgress = (currentTime: number, duration: number): boolean =>
  currentTime > RESUME_MIN_TIME && !isProgressCompleted(currentTime, duration)

export const loadAutoplayEnabled = (): boolean => {
  try {
    return localStorage.getItem(AUTOPLAY_KEY) === 'true'
  } catch {
    return false
  }
}

export const storeAutoplayEnabled = (value: boolean): void => {
  try {
    localStorage.setItem(AUTOPLAY_KEY, String(value))
  } catch {
    // ignore
  }
}

export type EpisodeEndAction = 'advance' | 'prompt-next' | 'prompt-complete' | 'none'

export const decideEpisodeEnd = (options: {
  seekInduced: boolean
  autoplayEnabled: boolean
  hasNext: boolean
  isFinal: boolean
}): EpisodeEndAction => {
  if (options.seekInduced) return 'none'
  if (options.autoplayEnabled && options.hasNext) return 'advance'
  if (options.hasNext) return 'prompt-next'
  if (options.isFinal) return 'prompt-complete'
  return 'none'
}
