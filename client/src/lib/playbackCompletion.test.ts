import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  COMPLETION_THRESHOLD,
  isProgressCompleted,
  hasResumableProgress,
  isShowFinale,
  loadAutoplayEnabled,
  storeAutoplayEnabled,
  decideEpisodeEnd,
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

describe('hasResumableProgress', () => {
  it('requires more than 5s and an unfinished episode', () => {
    expect(hasResumableProgress(0, 100)).toBe(false)
    expect(hasResumableProgress(5, 100)).toBe(false)
    expect(hasResumableProgress(6, 100)).toBe(true)
    expect(hasResumableProgress(90, 100)).toBe(false)
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
})

describe('isShowFinale', () => {
  it('requires the last episode plus a finished status', () => {
    expect(isShowFinale(['1', '2'], '2', 'FINISHED')).toBe(true)
    expect(isShowFinale(['1', '2'], '1', 'FINISHED')).toBe(false)
    expect(isShowFinale(['1', '2'], '2', 'RELEASING')).toBe(false)
    expect(isShowFinale([], undefined, 'FINISHED')).toBe(false)
    expect(isShowFinale(['1'], '1', 'Complete')).toBe(true)
    expect(isShowFinale(['1'], '1', 'ended')).toBe(true)
  })
})

describe('decideEpisodeEnd', () => {
  it('never acts on a seek-induced end', () => {
    expect(
      decideEpisodeEnd({ seekInduced: true, autoplayEnabled: true, hasNext: true, isFinal: false })
    ).toBe('none')
  })

  it('advances only with autoplay on and a next episode', () => {
    expect(
      decideEpisodeEnd({ seekInduced: false, autoplayEnabled: true, hasNext: true, isFinal: false })
    ).toBe('advance')
    expect(
      decideEpisodeEnd({
        seekInduced: false,
        autoplayEnabled: false,
        hasNext: true,
        isFinal: false,
      })
    ).toBe('prompt-next')
  })

  it('prompts completion for finals and does nothing otherwise', () => {
    expect(
      decideEpisodeEnd({ seekInduced: false, autoplayEnabled: true, hasNext: false, isFinal: true })
    ).toBe('prompt-complete')
    expect(
      decideEpisodeEnd({
        seekInduced: false,
        autoplayEnabled: true,
        hasNext: false,
        isFinal: false,
      })
    ).toBe('none')
  })
})
