import React, { useState, useEffect, useMemo } from 'react'
import { TitlePreferenceContext } from './TitlePreferenceContext'

interface TitlePreferenceProviderProps {
  children: React.ReactNode
}

export const TitlePreferenceProvider: React.FC<TitlePreferenceProviderProps> = ({ children }) => {
  const [titlePreference, setTitlePreference] = useState<'name' | 'nativeName' | 'englishName'>(
    'englishName'
  )
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchPreference = async () => {
      try {
        const response = await fetch('/api/settings?key=titlePreference')
        if (response.ok) {
          const data = await response.json()
          if (data.value) {
            setTitlePreference(data.value as 'name' | 'nativeName' | 'englishName')
          }
        }
      } catch (err) {
        console.error('Error fetching title preference in context:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchPreference()
  }, [])

  const value = useMemo(
    () => ({ titlePreference, setTitlePreference, loading }),
    [titlePreference, loading]
  )

  return <TitlePreferenceContext.Provider value={value}>{children}</TitlePreferenceContext.Provider>
}
