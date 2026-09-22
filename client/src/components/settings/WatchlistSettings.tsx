import React, { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import ToggleSwitch from '../common/ToggleSwitch'
import { useContentType, type ContentType } from '../../contexts/ContentTypeContext'
import styles from './WatchlistSettings.module.css'

interface ListSettingsConfig {
  heading: string
  blurb: string
  skipKey: string
  ignoreKey: string
  listOnlyKey: string
  skipLabel: string
  ignoreLabel: string
  listOnlyLabel: string
  listNoun: string
  continueNoun: string
  adultCountUrl: string
  purgeUrl: string
  purgeDoneText: (removed: number) => string
  invalidateKeys: string[][]
}

const CONFIG: Record<ContentType, ListSettingsConfig> = {
  anime: {
    heading: 'Watchlist Preferences',
    blurb: 'Customize your experience when managing your watchlist and series entries.',
    skipKey: 'skipRemoveConfirmation',
    ignoreKey: 'ignoreAdultContent',
    listOnlyKey: 'cwWatchlistOnly',
    skipLabel: 'Skip confirmation when removing from watchlist',
    ignoreLabel: 'Hide adult content from continue watching',
    listOnlyLabel: 'Only show continue watching for shows in watchlist',
    listNoun: 'watchlist',
    continueNoun: 'continue watching',
    adultCountUrl: '/api/continue-watching/adult-count',
    purgeUrl: '/api/continue-watching/purge-adult',
    purgeDoneText: (removed) => `Removed ${removed ?? 0} entries from continue watching`,
    invalidateKeys: [['allContinueWatching']],
  },
  manga: {
    heading: 'Reading List Preferences',
    blurb: 'Customize your experience when managing your reading list and manga entries.',
    skipKey: 'mangaSkipRemoveConfirmation',
    ignoreKey: 'mangaIgnoreAdultContent',
    listOnlyKey: 'mangaCwWatchlistOnly',
    skipLabel: 'Skip confirmation when removing from reading list',
    ignoreLabel: 'Hide adult content from continue reading',
    listOnlyLabel: 'Only show continue reading for manga in reading list',
    listNoun: 'reading list',
    continueNoun: 'continue reading',
    adultCountUrl: '/api/manga/continue-reading/adult-count',
    purgeUrl: '/api/manga/continue-reading/purge-adult',
    purgeDoneText: (removed) => `Removed ${removed ?? 0} entries from continue reading`,
    invalidateKeys: [['manga-continue-reading']],
  },
  tv: {
    heading: 'TV Watchlist Preferences',
    blurb: 'Customize your experience when managing your TV watchlist and series entries.',
    skipKey: 'tvSkipRemoveConfirmation',
    ignoreKey: 'tvIgnoreAdultContent',
    listOnlyKey: 'tvCwWatchlistOnly',
    skipLabel: 'Skip confirmation when removing from TV watchlist',
    ignoreLabel: 'Hide adult content from continue watching',
    listOnlyLabel: 'Only show continue watching for shows in TV watchlist',
    listNoun: 'TV watchlist',
    continueNoun: 'continue watching',
    adultCountUrl: '/api/tv/continue-watching/adult-count',
    purgeUrl: '/api/tv/continue-watching/purge-adult',
    purgeDoneText: (removed) => `Removed ${removed ?? 0} entries from continue watching`,
    invalidateKeys: [['tv-continue-watching']],
  },
  asmr: {
    heading: 'Listening List Preferences',
    blurb: 'Customize your experience when managing your listening list and work entries.',
    skipKey: 'asmrSkipRemoveConfirmation',
    ignoreKey: 'asmrIgnoreAdultContent',
    listOnlyKey: 'asmrCwWatchlistOnly',
    skipLabel: 'Skip confirmation when removing from listening list',
    ignoreLabel: 'Hide adult content from continue listening',
    listOnlyLabel: 'Only show continue listening for works in listening list',
    listNoun: 'listening list',
    continueNoun: 'continue listening',
    adultCountUrl: '/api/asmr/continue-listening/adult-count',
    purgeUrl: '/api/asmr/continue-listening/purge-adult',
    purgeDoneText: (removed) => `Removed ${removed ?? 0} entries from continue listening`,
    invalidateKeys: [['asmr-continue-listening']],
  },
}

const parseBool = (value: unknown, defaultValue: boolean) => {
  if (value === null || value === undefined) return defaultValue
  const str = String(value)
  if (str === 'true' || str === '1') return true
  if (str === 'false' || str === '0') return false
  return defaultValue
}

const useServerToggle = (key: string, defaultValue: boolean, invalidateKeys: string[][]) => {
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
      for (const queryKey of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey })
      }
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
  const { contentType } = useContentType()
  const config = CONFIG[contentType]
  const [skipConfirmation, setSkipConfirmation] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isUpdating, setIsUpdating] = useState(false)
  const ignoreAdult = useServerToggle(config.ignoreKey, true, config.invalidateKeys)
  const watchlistOnly = useServerToggle(config.listOnlyKey, false, config.invalidateKeys)
  const [purgeCount, setPurgeCount] = useState<number | null>(null)
  const [isPurging, setIsPurging] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    setIsLoading(true)
    const fetchSetting = async () => {
      try {
        const response = await fetch(`/api/settings?key=${config.skipKey}`)
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
  }, [config.skipKey])

  const handleToggle = async () => {
    if (isUpdating) return
    setIsUpdating(true)

    const newValue = !skipConfirmation
    setSkipConfirmation(newValue)

    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: config.skipKey, value: newValue }),
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
        const response = await fetch(config.adultCountUrl)
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
      const response = await fetch(config.purgeUrl, {
        method: 'POST',
      })
      const data = await response.json()
      toast.success(config.purgeDoneText(data.removed))
      for (const queryKey of config.invalidateKeys) {
        queryClient.invalidateQueries({ queryKey })
      }
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
      <h3>{config.heading}</h3>
      <p>{config.blurb}</p>
      <div className={styles.settingItem}>
        <div className={styles.settingRow}>
          <label htmlFor="skip-confirmation-toggle">{config.skipLabel}</label>
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
          <label htmlFor="ignore-adult-toggle">{config.ignoreLabel}</label>
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
          <label htmlFor="cw-watchlist-only-toggle">{config.listOnlyLabel}</label>
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
              {purgeCount} adult {purgeCount === 1 ? 'entry' : 'entries'} not in your{' '}
              {config.listNoun} {purgeCount === 1 ? 'is' : 'are'} currently hidden from{' '}
              {config.continueNoun}. You can purge {purgeCount === 1 ? 'it' : 'them'} from the
              database instead of showing {purgeCount === 1 ? 'it' : 'them'}.
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
