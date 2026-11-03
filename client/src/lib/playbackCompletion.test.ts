import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  COMPLETION_THRESHOLD,
  isProgressCompleted,
  hasResumableProgress,
  isPlaybackEnded,
  isShowFinishedStatus,
  loadAutoplayEnabled,
  loadWatchedOverlayEnabled,
  storeAutoplayEnabled,
  storeWatchedOverlayEnabled,
} from './playbackCompletion'

describe('isProgressCompleted', () => {
  it('uses the shared 80% threshold', () => {
    expect(COMPLETION_THRESHOLD).toBe(0.8)
    expect(isProgressCompleted(80, 100)).toBe(true)
    expect(isProgressCompleted(79.9, 100)).toBe(false)
    expect(isProgressCompleted(0, 0)).toBe(false)
    expect(isProgressCompleted(10, 0)).toBe(false)
  })
})

describe('isPlaybackEnded', () => {
  it('tolerates a stream that stops just short of the duration', () => {
    expect(isPlaybackEnded(100, 100)).toBe(true)
    expect(isPlaybackEnded(99.8, 100)).toBe(true)
    expect(isPlaybackEnded(99.5, 100)).toBe(false)
    expect(isPlaybackEnded(0, 0)).toBe(false)
    expect(isPlaybackEnded(10, Infinity)).toBe(false)
  })
})

describe('isShowFinishedStatus', () => {
  it('only treats known finished statuses as finished', () => {
    expect(isShowFinishedStatus('FINISHED')).toBe(true)
    expect(isShowFinishedStatus('Ended')).toBe(true)
    expect(isShowFinishedStatus('Completed')).toBe(true)
    expect(isShowFinishedStatus('Canceled')).toBe(true)
    expect(isShowFinishedStatus('Returning Series')).toBe(false)
    expect(isShowFinishedStatus('RELEASING')).toBe(false)
    expect(isShowFinishedStatus(undefined)).toBe(false)
    expect(isShowFinishedStatus(null)).toBe(false)
  })
})

describe('hasResumableProgress', () => {
  it('requires more than 5s, finished episodes included', () => {
    expect(hasResumableProgress(0)).toBe(false)
    expect(hasResumableProgress(5)).toBe(false)
    expect(hasResumableProgress(6)).toBe(true)
    expect(hasResumableProgress(90)).toBe(true)
  })
})

describe('autoplay setting', () => {
  const store = new Map<string, string>()
  const localStorageStub = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    clear: () => store.clear(),
  }

  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', localStorageStub)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('defaults to off and round-trips', () => {
    expect(loadAutoplayEnabled()).toBe(false)
    storeAutoplayEnabled(true)
    expect(loadAutoplayEnabled()).toBe(true)
  })

  it('defaults the watched overlay to on and round-trips', () => {
    expect(loadWatchedOverlayEnabled()).toBe(true)
    storeWatchedOverlayEnabled(false)
    expect(loadWatchedOverlayEnabled()).toBe(false)
    storeWatchedOverlayEnabled(true)
    expect(loadWatchedOverlayEnabled()).toBe(true)
  })
})
