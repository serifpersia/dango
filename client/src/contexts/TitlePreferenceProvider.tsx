import React, { useState, useEffect, useMemo } from 'react'
import { TitlePreferenceContext } from './TitlePreferenceContext'
import { trpcClient } from '../lib/trpc'

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
        const data = await trpcClient.settings.getByKey.query({ key: 'titlePreference' })
        if (data.value) {
          setTitlePreference(data.value as 'name' | 'nativeName' | 'englishName')
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
