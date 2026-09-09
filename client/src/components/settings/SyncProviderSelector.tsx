import React, { useEffect, useState } from 'react'
import styles from '../../pages/Settings.module.css'
import { toast } from 'react-hot-toast'

interface SyncSettings {
  activeProvider: string
  actualActiveProvider: string
  authenticatedProviders: {
    github: boolean
    google: boolean
    rclone: boolean
  }
}

const SyncProviderSelector: React.FC = () => {
  const [settings, setSettings] = useState<SyncSettings | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/auth/settings/sync')
      const data = await res.json()
      setSettings(data)
    } catch (err) {
      console.error('Failed to fetch sync settings', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSettings()
  }, [])

  const handleProviderChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value
    try {
      const res = await fetch('/api/auth/settings/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: newProvider }),
      })
      if (res.ok) {
        const data = await res.json()
        setSettings((prev) =>
          prev
            ? {
                ...prev,
                activeProvider: data.activeProvider,
              }
            : null
        )
        await fetchSettings()
        toast.success(
          `Sync provider updated to ${newProvider === 'default' ? 'Default Order' : newProvider}`
        )
      } else {
        toast.error('Failed to update sync provider')
      }
    } catch {
      toast.error('Error updating sync provider')
    }
  }

  if (loading) return null
  if (!settings) return null

  const options = [{ value: 'default', label: 'Default (Priority Based)' }]

  if (settings.authenticatedProviders.github) {
    options.push({ value: 'github', label: 'GitHub' })
  }
  if (settings.authenticatedProviders.google) {
    options.push({ value: 'google', label: 'Google Drive' })
  }
  if (settings.authenticatedProviders.rclone) {
    options.push({ value: 'rclone', label: 'Rclone' })
  }

  options.push({ value: 'none', label: 'None (Local Only)' })

  const getStatusLabel = (provider: string) => {
    if (provider === 'none') return 'Local Only (No Sync)'
    if (provider === 'google') return 'Google Drive'
    if (provider === 'github') return 'GitHub'
    if (provider === 'rclone') return 'Rclone'
    return provider
  }

  return (
    <div className={styles.sectionCard}>
      <h3>Active Sync Provider</h3>
      <p>
        Choose which provider to use for synchronization. "Default" uses the first available
        provider you are logged into.
      </p>

      <div
        style={{
          marginBottom: '1.5rem',
          padding: '0.75rem',
          background: 'rgba(255, 255, 255, 0.03)',
          borderRadius: 'var(--radius-md)',
          borderLeft: '4px solid var(--accent)',
          fontSize: 'var(--font-size-sm)',
        }}
      >
        Current Status:{' '}
        <strong style={{ color: 'var(--accent-light)', textTransform: 'capitalize' }}>
          {getStatusLabel(settings.actualActiveProvider)}
        </strong>
      </div>

      <div className={styles.settingRow}>
        <label htmlFor="sync-provider-select">Selected Preference</label>
        <select
          id="sync-provider-select"
          value={settings.activeProvider}
          onChange={handleProviderChange}
          style={{
            padding: '0.5rem',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(255, 255, 255, 0.05)',
            color: 'var(--text-primary)',
            border: '1px solid var(--glass-border)',
            fontSize: 'var(--font-size-sm)',
            minWidth: '220px',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export default SyncProviderSelector
