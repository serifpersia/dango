import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../common/Button'
import StatusModal from '../common/StatusModal'
import styles from './GoogleAuthSettings.module.css'

interface GitHubUser {
  login: string
  name?: string | null
}

interface DeviceState {
  status: 'idle' | 'pending' | 'success' | 'error'
  verification?: {
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
  }
  error?: string
  user?: GitHubUser
}

interface GitHubStatus {
  authenticated: boolean
  user: GitHubUser | null
  device: DeviceState
  hasCustomClientId: boolean
}

const GitHubSyncSettings: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [user, setUser] = useState<GitHubUser | null>(null)
  const [device, setDevice] = useState<DeviceState>({ status: 'idle' })
  const [hasOverride, setHasOverride] = useState(false)
  const [customClientId, setCustomClientId] = useState('')
  const [saving, setSaving] = useState(false)
  const pollTimer = useRef<number | null>(null)

  const [statusModal, setStatusModal] = useState<{
    show: boolean
    message: string
    type: 'success' | 'error' | 'info'
  }>({
    show: false,
    message: '',
    type: 'info',
  })

  const stopPolling = () => {
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }

  const applyStatus = useCallback((data: GitHubStatus) => {
    setAuthenticated(data.authenticated)
    setUser(data.user || data.device.user || null)
    setDevice(data.device)
    setHasOverride(!!data.hasCustomClientId)
  }, [])

  const fetchStatus = useCallback(async () => {
    const res = await fetch('/api/auth/github/status')
    const data = await res.json()
    applyStatus(data)
  }, [applyStatus])

  const pollStatus = async () => {
    try {
      const res = await fetch('/api/auth/github/poll')
      const nextDevice: DeviceState = await res.json()
      setDevice(nextDevice)

      if (nextDevice.status === 'success') {
        stopPolling()
        await fetchStatus()
        setStatusModal({
          show: true,
          message: 'GitHub authentication complete. Sync has been initialized.',
          type: 'success',
        })
      } else if (nextDevice.status === 'error') {
        stopPolling()
        setStatusModal({
          show: true,
          message: nextDevice.error || 'GitHub authentication failed.',
          type: 'error',
        })
      }
    } catch {
      stopPolling()
      setStatusModal({
        show: true,
        message: 'Failed to poll GitHub authentication status.',
        type: 'error',
      })
    }
  }

  const startPolling = (intervalSeconds = 5) => {
    stopPolling()
    pollTimer.current = window.setInterval(pollStatus, Math.max(intervalSeconds, 5) * 1000)
  }

  useEffect(() => {
    fetchStatus()
      .catch(() => {
        setStatusModal({
          show: true,
          message: 'Failed to load GitHub sync status.',
          type: 'error',
        })
      })
      .finally(() => setLoading(false))

    return stopPolling
  }, [fetchStatus])

  const handleStart = async () => {
    setStarting(true)
    try {
      const res = await fetch('/api/auth/github/start', { method: 'POST' })
      const nextDevice: DeviceState = await res.json()

      if (!res.ok) {
        throw new Error('Failed to start GitHub authentication.')
      }

      setDevice(nextDevice)
      startPolling(nextDevice.verification?.interval)
    } catch (error) {
      setStatusModal({
        show: true,
        message: error instanceof Error ? error.message : 'Failed to start GitHub authentication.',
        type: 'error',
      })
    } finally {
      setStarting(false)
    }
  }

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/github/logout', { method: 'POST' })
      setAuthenticated(false)
      setUser(null)
      setDevice({ status: 'idle' })
      setStatusModal({ show: true, message: 'Signed out of GitHub sync.', type: 'success' })
    } catch {
      setStatusModal({ show: true, message: 'Failed to sign out of GitHub.', type: 'error' })
    }
  }

  const handleSaveOverride = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/auth/github/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: customClientId }),
      })
      if (!res.ok) throw new Error('save failed')
      setCustomClientId('')
      await fetchStatus()
      setStatusModal({
        show: true,
        message: 'Custom GitHub auth saved.',
        type: 'success',
      })
    } catch {
      setStatusModal({ show: true, message: 'Failed to save override.', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleClearOverride = async () => {
    setSaving(true)
    try {
      await fetch('/api/auth/github/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: '' }),
      })
      setCustomClientId('')
      await fetchStatus()
      setStatusModal({
        show: true,
        message: 'Custom auth cleared. Using dango defaults.',
        type: 'success',
      })
    } catch {
      setStatusModal({ show: true, message: 'Failed to clear override.', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div style={{ color: 'var(--text-secondary)', padding: '1.5rem' }}>Loading...</div>
  }

  return (
    <div className={styles.sectionCard}>
      <h3 className={styles.title}>GitHub Cloud Sync</h3>
      <p className={styles.signIn}>
        Sync local data through a private GitHub repository named dango-sync-data.
      </p>

      {authenticated && user ? (
        <div className={styles.userInfo}>
          <p>
            Signed in as: <strong>{user.name || user.login}</strong>
          </p>
          <Button variant="danger" onClick={handleSignOut}>
            Sign Out
          </Button>
        </div>
      ) : (
        <div className={styles.signIn}>
          <Button onClick={handleStart} disabled={starting || device.status === 'pending'}>
            {starting || device.status === 'pending'
              ? 'Waiting for GitHub...'
              : 'Sign in with GitHub'}
          </Button>
        </div>
      )}

      {device.status === 'pending' && device.verification && (
        <>
          <hr className={styles.hr} />
          <div className={styles.formGroup}>
            <label className={styles.label}>Verification URL</label>
            <div className={styles.inputWrapper}>
              <input
                className={styles.input}
                value={device.verification.verification_uri}
                readOnly
              />
              <Button onClick={() => window.open(device.verification?.verification_uri, '_blank')}>
                Open
              </Button>
            </div>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label}>Device Code</label>
            <input className={styles.input} value={device.verification.user_code} readOnly />
          </div>
        </>
      )}

      {device.status === 'error' && <p className={styles.warning}>{device.error}</p>}

      <details style={{ marginTop: '1rem', fontSize: 'var(--font-size-sm)' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>
          Advanced: use your own auth {hasOverride ? '(override active)' : ''}
        </summary>
        <div className={styles.formGroup} style={{ marginTop: '0.75rem' }}>
          <label className={styles.label}>Client ID (optional)</label>
          <input
            className={styles.input}
            value={customClientId}
            onChange={(e) => setCustomClientId(e.currentTarget.value)}
            placeholder="Your GitHub OAuth app ID"
          />
        </div>
        <div className={styles.actions}>
          <Button onClick={handleSaveOverride} disabled={saving}>
            Save override
          </Button>
          <Button variant="secondary" onClick={handleClearOverride} disabled={saving}>
            Use dango defaults
          </Button>
        </div>
      </details>

      <StatusModal
        show={statusModal.show}
        message={statusModal.message}
        type={statusModal.type}
        onClose={() => setStatusModal((prev) => ({ ...prev, show: false }))}
      />
    </div>
  )
}

export default GitHubSyncSettings
