import { useCallback, useEffect, useState } from 'react'

const MATURE_CONSENT_KEY = 'agreedToViewMature'

function readConsent(): boolean {
  try {
    return localStorage.getItem(MATURE_CONSENT_KEY) === 'true'
  } catch {
    return false
  }
}

export function useMatureConsent() {
  const [hasConsent, setHasConsent] = useState(readConsent)

  useEffect(() => {
    const sync = () => setHasConsent(readConsent())
    window.addEventListener('storage', sync)
    window.addEventListener('focus', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('focus', sync)
    }
  }, [])

  const grant = useCallback(() => {
    try {
      localStorage.setItem(MATURE_CONSENT_KEY, 'true')
    } catch {
      // ignore
    }
    setHasConsent(true)
  }, [])

  const revoke = useCallback(() => {
    try {
      localStorage.removeItem(MATURE_CONSENT_KEY)
    } catch {
      // ignore
    }
    setHasConsent(false)
  }, [])

  return { hasConsent, grant, revoke }
}
