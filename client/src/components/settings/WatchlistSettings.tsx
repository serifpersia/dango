import React, { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import ToggleSwitch from '../common/ToggleSwitch'
import styles from './WatchlistSettings.module.css'

const parseBool = (value: unknown, defaultValue: boolean) => {
  if (value === null || value === undefined) return defaultValue
  const str = String(value)
  if (str === 'true' || str === '1') return true
  if (str === 'false' || str === '0') return false
  return defaultValue
}

const useServerToggle = (key: string, defaultValue: boolean) => {
  const [value, setValue] = useState(defaultValue)
  const [isUpdating, setIsUpdating] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    const fetchSetting = async () => {
      try {
        const response = await fetch(`/api/settings?key=${key}`)
        const data = await response.json()
        setValue(parseBool(data.value, defaultValue))
      } catch (error) {
        console.error('Failed to fetch setting', error)
      }
    }
    fetchSetting()
  }, [key, defaultValue])

  const toggle = async () => {
    if (isUpdating) return
    setIsUpdating(true)
    const newValue = !value
    setValue(newValue)
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: newValue }),
      })
      queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
    } catch (err) {
      console.error('Error saving setting:', err)
      setValue(!newValue)
    } finally {
      setIsUpdating(false)
    }
  }

  return { value, setValue, isUpdating, toggle }
}

const WatchlistSettings: React.FC = () => {
  const [skipConfirmation, setSkipConfirmation] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isUpdating, setIsUpdating] = useState(false)
  const ignoreAdult = useServerToggle('ignoreAdultContent', true)
  const watchlistOnly = useServerToggle('cwWatchlistOnly', false)
  const [purgeCount, setPurgeCount] = useState<number | null>(null)
  const [isPurging, setIsPurging] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    const fetchSetting = async () => {
      try {
        const response = await fetch('/api/settings?key=skipRemoveConfirmation')
        const data = await response.json()
        if (String(data.value) === 'true' || String(data.value) === '1') {
          setSkipConfirmation(true)
        } else {
          setSkipConfirmation(false)
        }
      } catch (error) {
        console.error('Failed to fetch setting', error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchSetting()
  }, [])

  const handleToggle = async () => {
    if (isUpdating) return
    setIsUpdating(true)

    const newValue = !skipConfirmation
    setSkipConfirmation(newValue)

    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'skipRemoveConfirmation', value: newValue }),
      })
    } catch (err) {
      console.error('Error saving setting:', err)
      setSkipConfirmation(!newValue)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleIgnoreAdultToggle = async () => {
    if (ignoreAdult.isUpdating) return
    if (ignoreAdult.value) {
      try {
        const response = await fetch('/api/continue-watching/adult-count')
        const data = await response.json()
        if (typeof data.count === 'number' && data.count > 0) {
          setPurgeCount(data.count)
          return
        }
      } catch (error) {
        console.error('Failed to fetch adult count', error)
      }
    }
    ignoreAdult.toggle()
  }

  const handleShowAdults = () => {
    setPurgeCount(null)
    ignoreAdult.toggle()
  }

  const handlePurgeAdults = async () => {
    if (isPurging) return
    setIsPurging(true)
    try {
      const response = await fetch('/api/continue-watching/purge-adult', {
        method: 'POST',
      })
      const data = await response.json()
      toast.success(`Removed ${data.removed ?? 0} entries from continue watching`)
      queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
    } catch (error) {
      console.error('Failed to purge adult entries', error)
      toast.error('Failed to remove adult entries')
    } finally {
      setIsPurging(false)
      setPurgeCount(null)
    }
    ignoreAdult.toggle()
  }

  if (isLoading) {
    return <div>Loading settings...</div>
  }

  return (
    <div className={styles.sectionCard}>
      <h3>Watchlist Preferences</h3>
      <p>Customize your experience when managing your watchlist and series entries.</p>
      <div className={styles.settingItem}>
        <div className={styles.settingRow}>
          <label htmlFor="skip-confirmation-toggle">
            Skip confirmation when removing from watchlist
          </label>
          <ToggleSwitch
            isChecked={skipConfirmation}
            onChange={handleToggle}
            id="skip-confirmation-toggle"
            disabled={isUpdating}
          />
        </div>
      </div>
      <div className={styles.settingItem}>
        <div className={styles.settingRow}>
          <label htmlFor="ignore-adult-toggle">Hide adult content from continue watching</label>
          <ToggleSwitch
            isChecked={ignoreAdult.value}
            onChange={handleIgnoreAdultToggle}
            id="ignore-adult-toggle"
            disabled={ignoreAdult.isUpdating}
          />
        </div>
      </div>
      <div className={styles.settingItem}>
        <div className={styles.settingRow}>
          <label htmlFor="cw-watchlist-only-toggle">
            Only show continue watching for shows in watchlist
          </label>
          <ToggleSwitch
            isChecked={watchlistOnly.value}
            onChange={watchlistOnly.toggle}
            id="cw-watchlist-only-toggle"
            disabled={watchlistOnly.isUpdating}
          />
        </div>
      </div>
      {purgeCount !== null && (
        <div className={styles.modalOverlay} onClick={() => setPurgeCount(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h4>Show adult entries?</h4>
            <p>
              {purgeCount} adult {purgeCount === 1 ? 'entry' : 'entries'} not in your watchlist{' '}
              {purgeCount === 1 ? 'is' : 'are'} currently hidden from continue watching. You can
              purge {purgeCount === 1 ? 'it' : 'them'} from the database instead of showing{' '}
              {purgeCount === 1 ? 'it' : 'them'}.
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalSecondary}
                onClick={handleShowAdults}
                disabled={isPurging}
              >
                Show them
              </button>
              <button
                type="button"
                className={styles.modalPrimary}
                onClick={handlePurgeAdults}
                disabled={isPurging}
              >
                {isPurging ? 'Purging...' : `Purge ${purgeCount}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default WatchlistSettings
