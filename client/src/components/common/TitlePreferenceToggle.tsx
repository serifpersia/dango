import React, { useState, useEffect, useRef } from 'react'
import styles from './TitlePreferenceToggle.module.css'
import { useTitlePreference } from '../../contexts/TitlePreferenceContext'
import type { TitlePreferenceContextType as TitlePreference } from '../../contexts/TitlePreferenceContext'
import { trpcClient } from '../../lib/trpc'

const preferences: readonly TitlePreference[] = ['name', 'nativeName', 'englishName']
const preferenceLabels: Record<TitlePreference, string> = {
  name: 'Default (Romaji)',
  nativeName: 'Native',
  englishName: 'English',
}

const TitlePreferenceToggle: React.FC = () => {
  const { titlePreference: selectedPreference, setTitlePreference, loading } = useTitlePreference()
  const [currentLabel, setCurrentLabel] = useState(preferenceLabels[selectedPreference])
  const [isAnimating, setIsAnimating] = useState(false)
  const labelRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!loading) {
      setCurrentLabel(preferenceLabels[selectedPreference])
    }
  }, [selectedPreference, loading])

  const handleToggle = async () => {
    if (isAnimating) return

    setIsAnimating(true)

    const currentIndex = preferences.indexOf(selectedPreference)
    const nextIndex = (currentIndex + 1) % preferences.length
    const newPreference = preferences[nextIndex]
    const newLabel = preferenceLabels[newPreference]

    if (labelRef.current) {
      labelRef.current.style.transform = 'translateX(-100%)'
      labelRef.current.style.opacity = '0'
    }

    setTimeout(async () => {
      setCurrentLabel(newLabel)
      setTitlePreference(newPreference)

      if (labelRef.current) {
        labelRef.current.style.transition = 'none'
        labelRef.current.style.transform = 'translateX(100%)'
        labelRef.current.style.opacity = '0'

        void labelRef.current.offsetWidth
        labelRef.current.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out'
        labelRef.current.style.transform = 'translateX(0)'
        labelRef.current.style.opacity = '1'
      }
      try {
        await trpcClient.settings.set.mutate({ key: 'titlePreference', value: newPreference })
      } catch (err) {
        console.error('Error saving title preference:', err)
      } finally {
        setIsAnimating(false)
      }
    }, 300)
  }

  if (loading) {
    return <p>Loading title preference...</p>
  }

  return (
    <div className={styles['title-preference-container']}>
      <h4>Anime Title Display Preference</h4>
      <button onClick={handleToggle} className={styles['toggle-button']} disabled={isAnimating}>
        <span ref={labelRef} className={styles['toggle-label']}>
          {currentLabel}
        </span>
      </button>
    </div>
  )
}

export default TitlePreferenceToggle
