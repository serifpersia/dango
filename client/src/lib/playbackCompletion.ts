import { profileStorage } from './profileStorage'
export const COMPLETION_THRESHOLD = 0.8

export const RESUME_MIN_TIME = 5

const AUTOPLAY_KEY = 'autoplayEnabled'

export const isProgressCompleted = (currentTime: number, duration: number): boolean =>
  duration > 0 && currentTime >= duration * COMPLETION_THRESHOLD

export const END_TOLERANCE_SECONDS = 0.25

export const isPlaybackEnded = (currentTime: number, duration: number): boolean =>
  duration > 0 && Number.isFinite(duration) && currentTime >= duration - END_TOLERANCE_SECONDS

export const hasResumableProgress = (currentTime: number): boolean => currentTime > RESUME_MIN_TIME

export const loadAutoplayEnabled = (): boolean => {
  try {
    return profileStorage.getItem(AUTOPLAY_KEY) === 'true'
  } catch {
    return false
  }
}

export const storeAutoplayEnabled = (value: boolean): void => {
  try {
    profileStorage.setItem(AUTOPLAY_KEY, String(value))
  } catch {
    // ignore
  }
}
