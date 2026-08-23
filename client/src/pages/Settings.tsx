import React, { useState, useRef, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router'
import { Button } from '../components/common/Button'
import TitlePreferenceToggle from '../components/common/TitlePreferenceToggle'
import styles from './Settings.module.css'
import GitHubSyncSettings from '../components/settings/GitHubSyncSettings'
import GoogleAuthSettings from '../components/settings/GoogleAuthSettings'
import WatchlistSettings from '../components/settings/WatchlistSettings'
import RcloneSettings from '../components/settings/RcloneSettings'
import SyncProviderSelector from '../components/settings/SyncProviderSelector'
import { FaCog, FaCloud, FaDatabase, FaList } from 'react-icons/fa'
import { useLowEndMode } from '../contexts/LowEndModeContext'
import ToggleSwitch from '../components/common/ToggleSwitch'
import packageJson from '../../../package.json'
import { deleteTelemetryData } from '../hooks/useTelemetry'
import {
  getVirtualKeyboardEnabled,
  VIRTUAL_KEYBOARD_ENABLED_CHANGE_EVENT,
  VIRTUAL_KEYBOARD_ENABLED_KEY,
} from '../hooks/useVirtualKeyboard'
import { useSetting, useUpdateSetting } from '../hooks/useSettings'

type SettingsTab = 'general' | 'sync' | 'watchlist' | 'database'

const Settings: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const initialTab = searchParams.get('tab') as SettingsTab | null
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    initialTab && ['general', 'sync', 'watchlist', 'database'].includes(initialTab)
      ? initialTab
      : 'general'
  )
  const [statusMessage, setStatusMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { lowEndMode, setLowEndMode } = useLowEndMode()
  const [telemetryEnabled, setTelemetryEnabled] = useState(
    localStorage.getItem('telemetry_enabled') !== 'false'
  )
  const [installationId, setInstallationId] = useState<string>(
    localStorage.getItem('installation_id') || ''
  )

  useEffect(() => {
    fetch('/api/installation-id')
      .then((res) => res.json())
      .then((data) => {
        if (data.id) {
          setInstallationId(data.id)
          localStorage.setItem('installation_id', data.id)
        }
      })
      .catch(() => {
        // fallback: keep whatever is in localStorage
      })
  }, [])
  const [virtualKeyboardEnabled, setVirtualKeyboardEnabled] = useState(getVirtualKeyboardEnabled)

  const [discordEnabled, setDiscordEnabled] = useState(true)
  const { data: discordSetting } = useSetting('discordRPCEnabled')
  const updateSetting = useUpdateSetting()

  const [discordHideMature, setDiscordHideMature] = useState(true)
  const { data: discordHideMatureSetting } = useSetting('discordRPCHideMature')

  useEffect(() => {
    if (discordSetting !== undefined) {
      setDiscordEnabled(
        discordSetting === 'true' || discordSetting === true || discordSetting === null
      )
    }
  }, [discordSetting])

  useEffect(() => {
    if (discordHideMatureSetting !== undefined) {
      setDiscordHideMature(
        discordHideMatureSetting === 'true' ||
          discordHideMatureSetting === true ||
          discordHideMatureSetting === null
      )
    }
  }, [discordHideMatureSetting])

  const toggleDiscord = (enabled: boolean) => {
    setDiscordEnabled(enabled)
    updateSetting.mutate({ key: 'discordRPCEnabled', value: String(enabled) })
  }

  const toggleDiscordHideMature = (enabled: boolean) => {
    setDiscordHideMature(enabled)
    updateSetting.mutate({ key: 'discordRPCHideMature', value: String(enabled) })
  }

  const toggleTelemetry = (enabled: boolean) => {
    setTelemetryEnabled(enabled)
    localStorage.setItem('telemetry_enabled', String(enabled))
    if (!enabled) {
      deleteTelemetryData()
    }
  }

  const toggleVirtualKeyboard = (enabled: boolean) => {
    setVirtualKeyboardEnabled(enabled)
    localStorage.setItem(VIRTUAL_KEYBOARD_ENABLED_KEY, String(enabled))
    window.dispatchEvent(new CustomEvent(VIRTUAL_KEYBOARD_ENABLED_CHANGE_EVENT))
  }

  React.useEffect(() => {
    document.title = 'Settings - dango'
  }, [])

  React.useEffect(() => {
    const tab = searchParams.get('tab') as SettingsTab | null
    if (tab && ['general', 'sync', 'watchlist', 'database'].includes(tab)) {
      setActiveTab(tab)
    }
  }, [searchParams])

  const selectTab = (tab: SettingsTab) => {
    setActiveTab(tab)
    setSearchParams(tab === 'general' ? {} : { tab })
  }

  const handleBackup = () => {
    setStatusMessage('Downloading database backup...')
    const a = document.createElement('a')
    a.href = '/api/backup-db'
    a.download = 'dango-backup.db'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => {
      setStatusMessage('Database backup downloaded!')
    }, 1500)
  }

  const handleRestore = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setStatusMessage('Restoring database...')
    const formData = new FormData()
    formData.append('dbfile', file)

    try {
      const response = await fetch('/api/restore-db', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (response.ok) {
        setStatusMessage(result.message || 'Database restored successfully!')
        setTimeout(() => window.location.reload(), 2000)
      } else {
        setStatusMessage(`Restore failed: ${result.error}`)
      }
    } catch (_error) {
      setStatusMessage('Restore failed: An unexpected error occurred.')
    }
  }

  const triggerFileSelect = () => {
    fileInputRef.current?.click()
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <div className={styles.tabContent}>
            <div className={styles.sectionCard}>
              <h3>Appearance & Preferences</h3>
              <p>Configure how titles are displayed and other general preferences.</p>
              <div className={styles.settingItem}>
                <TitlePreferenceToggle />
              </div>
              <div className={styles.settingItem} style={{ marginTop: '1.5rem' }}>
                <div className={styles.settingRow}>
                  <div style={{ minWidth: 0 }}>
                    <h4 style={{ margin: 0, fontSize: '1rem' }}>Low End Mode</h4>
                    <p
                      style={{
                        margin: '0.25rem 0 0',
                        fontSize: '0.85rem',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      Disables animations and heavy visual effects for better performance on older
                      hardware.
                    </p>
                  </div>
                  <ToggleSwitch
                    isChecked={lowEndMode}
                    onChange={(e) => setLowEndMode(e.target.checked)}
                    id="low-end-mode"
                  />
                </div>
              </div>

              <div className={styles.settingItem} style={{ marginTop: '1.5rem' }}>
                <div className={styles.settingRow}>
                  <div style={{ minWidth: 0 }}>
                    <h4 style={{ margin: 0, fontSize: '1rem' }}>Virtual Keyboard</h4>
                    <p
                      style={{
                        margin: '0.25rem 0 0',
                        fontSize: '0.85rem',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      Shows an on-screen keyboard when text search fields are focused.
                    </p>
                  </div>
                  <ToggleSwitch
                    isChecked={virtualKeyboardEnabled}
                    onChange={(e) => toggleVirtualKeyboard(e.target.checked)}
                    id="virtual-keyboard-enabled"
                  />
                </div>
              </div>

              <div className={styles.settingItem} style={{ marginTop: '1.5rem' }}>
                <div className={styles.settingRow}>
                  <div style={{ minWidth: 0 }}>
                    <h4 style={{ margin: 0, fontSize: '1rem' }}>Discord Rich Presence</h4>
                    <p
                      style={{
                        margin: '0.25rem 0 0',
                        fontSize: '0.85rem',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      Show your current anime and watch progress on your Discord profile status.
                    </p>
                  </div>
                  <ToggleSwitch
                    isChecked={discordEnabled}
                    onChange={(e) => toggleDiscord(e.target.checked)}
                    id="discord-rpc-enabled"
                  />
                </div>
              </div>

              {discordEnabled && (
                <div className={styles.settingItem} style={{ marginTop: '1rem' }}>
                  <div className={styles.settingRow}>
                    <div style={{ minWidth: 0 }}>
                      <h4 style={{ margin: 0, fontSize: '1rem' }}>Hide Mature Content</h4>
                      <p
                        style={{
                          margin: '0.25rem 0 0',
                          fontSize: '0.85rem',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        Hide mature content (18+) from Discord Rich Presence.
                      </p>
                    </div>
                    <ToggleSwitch
                      isChecked={discordHideMature}
                      onChange={(e) => toggleDiscordHideMature(e.target.checked)}
                      id="discord-hide-mature"
                    />
                  </div>
                </div>
              )}

              <div className={styles.settingItem} style={{ marginTop: '1.5rem' }}>
                <div className={styles.settingRow}>
                  <div style={{ minWidth: 0 }}>
                    <h4 style={{ margin: 0, fontSize: '1rem' }}>Telemetry Tracking</h4>
                    <p
                      style={{
                        margin: '0.25rem 0 0',
                        fontSize: '0.85rem',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      Share anonymous installation data to help track active users and timezone.
                      Collected: Hardware-based Anonymous ID, App Version, First Seen/Last Seen
                      timestamps, User Agent string, and timezone (e.g. 'Europe/Berlin'). No other
                      personal information or usage habits are collected.
                    </p>
                  </div>
                  <ToggleSwitch
                    isChecked={telemetryEnabled}
                    onChange={(e) => toggleTelemetry(e.target.checked)}
                    id="telemetry-enabled"
                  />
                </div>
                {telemetryEnabled && (
                  <div
                    style={{
                      marginTop: '0.75rem',
                      fontSize: '0.8rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <p style={{ margin: '0 0 0.5rem 0', fontWeight: 'bold' }}>
                      Data currently being shared:
                    </p>
                    <div
                      style={{
                        background: '#1a1a1a',
                        padding: '0.5rem',
                        borderRadius: '4px',
                        wordBreak: 'break-all',
                        fontFamily: 'monospace',
                      }}
                    >
                      <p style={{ margin: '0' }}>
                        <strong>ID:</strong> {installationId || 'Loading...'}
                      </p>
                      <p style={{ margin: '0' }}>
                        <strong>Version:</strong> {packageJson.version}
                      </p>
                      <p style={{ margin: '0' }}>
                        <strong>Browser:</strong> {navigator.userAgent.substring(0, 60)}...
                      </p>
                      <p style={{ margin: '0' }}>
                        <strong>Timezone:</strong>{' '}
                        {Intl.DateTimeFormat().resolvedOptions().timeZone}
                      </p>
                    </div>
                  </div>
                )}
                <div style={{ marginTop: '1rem' }}>
                  <Button variant="secondary" size="sm" onClick={() => navigate('/map')}>
                    View User Map
                  </Button>
                </div>
              </div>

              {localStorage.getItem('agreedToViewMature') === 'true' && (
                <div className={styles.settingItem} style={{ marginTop: '1.5rem' }}>
                  <div className={styles.settingRow}>
                    <div style={{ minWidth: 0 }}>
                      <h4 style={{ margin: 0, fontSize: '1rem' }}>Mature Content</h4>
                      <p
                        style={{
                          margin: '0.25rem 0 0',
                          fontSize: '0.85rem',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        You have previously agreed to view 18+ content. Toggle this off to re-enable
                        the blur gate and filtering.
                      </p>
                    </div>
                    <ToggleSwitch
                      isChecked={true}
                      onChange={(e) => {
                        if (!e.target.checked) {
                          localStorage.removeItem('agreedToViewMature')
                          window.location.reload()
                        }
                      }}
                      id="mature-content-enabled"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      case 'sync':
        return (
          <div className={styles.tabContent}>
            <SyncProviderSelector />
            <GitHubSyncSettings />
            <GoogleAuthSettings />
            <RcloneSettings />
          </div>
        )
      case 'watchlist':
        return (
          <div className={styles.tabContent}>
            <WatchlistSettings />
          </div>
        )
      case 'database':
        return (
          <div className={styles.tabContent}>
            <div className={styles.sectionCard}>
              <h3>Database Management</h3>
              <p>Download a backup of your current database or restore from an existing file.</p>
              <div className={styles.controls}>
                <Button onClick={handleBackup}>Backup Database</Button>
                <Button variant="secondary" onClick={triggerFileSelect}>
                  Restore Database
                </Button>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleRestore}
                style={{ display: 'none' }}
                accept=".db"
              />
              {statusMessage && <p className={styles.status}>{statusMessage}</p>}
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="page-container">
      <div className={styles.settingsHeader}>
        <h1 className={styles.pageTitle}>Settings</h1>
        <p className={styles.pageSubtitle}>Manage your preferences and data synchronization</p>
      </div>

      <div className={styles.settingsLayout}>
        <aside className={styles.sidebar}>
          <button
            className={`${styles.sidebarItem} ${activeTab === 'general' ? styles.active : ''}`}
            onClick={() => selectTab('general')}
          >
            <FaCog /> <span>General</span>
          </button>
          <button
            className={`${styles.sidebarItem} ${activeTab === 'sync' ? styles.active : ''}`}
            onClick={() => selectTab('sync')}
          >
            <FaCloud /> <span>Synchronization</span>
          </button>
          <button
            className={`${styles.sidebarItem} ${activeTab === 'watchlist' ? styles.active : ''}`}
            onClick={() => selectTab('watchlist')}
          >
            <FaList /> <span>Watchlist</span>
          </button>
          <button
            className={`${styles.sidebarItem} ${activeTab === 'database' ? styles.active : ''}`}
            onClick={() => selectTab('database')}
          >
            <FaDatabase /> <span>Database</span>
          </button>
        </aside>

        <main className={styles.mainContent}>{renderTabContent()}</main>
      </div>
    </div>
  )
}

export default Settings
