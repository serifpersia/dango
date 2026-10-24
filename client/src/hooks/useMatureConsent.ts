import { profileStorage } from '../lib/profileStorage'
import { useCallback, useEffect, useState } from 'react'

const MATURE_CONSENT_KEY = 'agreedToViewMature'

function readConsent(): boolean {
  try {
    return profileStorage.getItem(MATURE_CONSENT_KEY) === 'true'
  } catch {
    return false
  }
}

// one window listener for every consumer, not one per consumer
const subscribers = new Set<(value: boolean) => void>()

function notify(value: boolean) {
  for (const subscriber of subscribers) subscriber(value)
}

function sync() {
  notify(readConsent())
}

function write(consented: boolean) {
  try {
    if (consented) profileStorage.setItem(MATURE_CONSENT_KEY, 'true')
    else profileStorage.removeItem(MATURE_CONSENT_KEY)
  } catch {
    // ignore
  }
  notify(consented)
}

export function useMatureConsent() {
  const [hasConsent, setHasConsent] = useState(readConsent)

  useEffect(() => {
    subscribers.add(setHasConsent)
    if (subscribers.size === 1) {
      window.addEventListener('storage', sync)
      window.addEventListener('focus', sync)
    }
    setHasConsent(readConsent())
    return () => {
      subscribers.delete(setHasConsent)
      if (subscribers.size === 0) {
        window.removeEventListener('storage', sync)
        window.removeEventListener('focus', sync)
      }
    }
  }, [])

  const grant = useCallback(() => write(true), [])
  const revoke = useCallback(() => write(false), [])

  return { hasConsent, grant, revoke }
}
