export type FallbackChoice = 'ask' | 'iframe' | 'retry'

export const FALLBACK_CHOICE_KEY = 'fallbackChoice'

export function getStoredFallbackAction(): 'iframe' | 'retry' | null {
  try {
    const value = localStorage.getItem(FALLBACK_CHOICE_KEY)
    return value === 'iframe' || value === 'retry' ? value : null
  } catch {
    return null
  }
}

export function storeFallbackAction(value: 'iframe' | 'retry' | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(FALLBACK_CHOICE_KEY)
    } else {
      localStorage.setItem(FALLBACK_CHOICE_KEY, value)
    }
  } catch {
    // ignore
  }
}
