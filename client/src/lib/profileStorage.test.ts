import { afterEach, expect, it, vi } from 'vitest'
import { profileStorage, setActiveProfileId } from './profileStorage'

afterEach(() => {
  setActiveProfileId('default')
  vi.unstubAllGlobals()
})

it('keeps legacy Default preferences, isolates other profiles, and shares device calibration', () => {
  const data = new Map([['preferredProvider', 'legacy']])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  })
  expect(profileStorage.getItem('preferredProvider')).toBe('legacy')
  setActiveProfileId('second')
  expect(profileStorage.getItem('preferredProvider')).toBeNull()
  profileStorage.setItem('preferredProvider', 'second-provider')
  profileStorage.setItem('playerVideoDelayMs', '100')
  setActiveProfileId('third')
  expect(profileStorage.getItem('preferredProvider')).toBeNull()
  expect(profileStorage.getItem('playerVideoDelayMs')).toBe('100')
  setActiveProfileId('second')
  expect(profileStorage.getItem('preferredProvider')).toBe('second-provider')
  profileStorage.removeItem('preferredProvider')
  expect(profileStorage.getItem('preferredProvider')).toBeNull()
  setActiveProfileId('default')
  expect(profileStorage.getItem('preferredProvider')).toBe('legacy')
})
