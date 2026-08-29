import { useCallback, useState } from 'react'

const MATURE_CONSENT_KEY = 'agreedToViewMature'

export function useMatureConsent() {
  const [hasConsent, setHasConsent] = useState(
    () => localStorage.getItem(MATURE_CONSENT_KEY) === 'true'
  )

  const grant = useCallback(() => {
    localStorage.setItem(MATURE_CONSENT_KEY, 'true')
    setHasConsent(true)
  }, [])

  return { hasConsent, grant }
}
