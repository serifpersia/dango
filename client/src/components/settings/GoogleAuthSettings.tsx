import React, { useState, useEffect } from 'react'
import { Button } from '../common/Button'
import StatusModal from '../common/StatusModal'
import styles from './GoogleAuthSettings.module.css'

interface User {
  name: string
  email: string
}

const GoogleAuthSettings: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [hasAuthConfig, setHasAuthConfig] = useState(false)
  const [hasOverride, setHasOverride] = useState(false)
  const [workerUrl, setWorkerUrl] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)

  const [statusModal, setStatusModal] = useState<{
    show: boolean
    message: string
    type: 'success' | 'error' | 'info'
  }>({
    show: false,
    message: '',
    type: 'info',
  })

  const fetchUser = async () => {
    try {
      const res = await fetch('/api/auth/user')
      const userData = await res.json()
      setUser(userData?.email ? userData : null)
    } catch {
      setUser(null)
    }
  }

  const fetchStatus = async () => {
    try {
      const [configRes, authRes] = await Promise.all([
        fetch('/api/auth/config-status'),
        fetch('/api/auth/google-auth'),
      ])
      const config = await configRes.json()
      const auth = await authRes.json()
      setHasAuthConfig(!!config.hasConfig)
      setHasOverride(
        !!(auth.hasCustomWorkerUrl || auth.hasCustomClientId || auth.hasClientSecret)
      )
    } catch (error) {
      console.error('Failed to fetch config status', error)
    }
  }

  useEffect(() => {
    const fetchInitialData = async () => {
      setLoading(true)
      await Promise.all([fetchUser(), fetchStatus()])
      setLoading(false)
    }

    fetchInitialData()

    const handleAuthMessage = (event: MessageEvent) => {
      if (event.data.type === 'GOOGLE_AUTH_SUCCESS') {
        setUser(event.data.user)
        window.location.reload()
      }
    }

    window.addEventListener('message', handleAuthMessage)
    return () => window.removeEventListener('message', handleAuthMessage)
  }, [])

  const handleSignIn = async () => {
    try {
      const res = await fetch('/api/auth/google/login', { method: 'POST' })
      const data = await res.json()

      if (data.authenticated) {
        window.location.reload()
        return
      }

      if (data.url) {
        const width = 600
        const height = 700
        const left = window.innerWidth / 2 - width / 2
        const top = window.innerHeight / 2 - height / 2
        window.open(
          data.url,
          'GoogleAuth',
          `width=${width},height=${height},top=${top},left=${left}`
        )
      } else {
        throw new Error('Auth URL not available')
      }
    } catch (error) {
      setStatusModal({
        show: true,
        message: 'Authentication failed. Ensure server is configured correctly.',
        type: 'error',
      })
    }
  }

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      setUser(null)
      setStatusModal({ show: true, message: 'Successfully signed out.', type: 'success' })
      window.location.reload()
    } catch (error) {
      console.error('Sign out failed', error)
      setStatusModal({ show: true, message: 'Failed to sign out.', type: 'error' })
    }
  }

  const handleSaveOverride = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/auth/google-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerUrl, clientId, clientSecret }),
      })
      if (!res.ok) throw new Error('save failed')
      setWorkerUrl('')
      setClientId('')
      setClientSecret('')
      await fetchStatus()
      setStatusModal({
        show: true,
        message: 'Custom auth saved. Restart may be required.',
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
      await fetch('/api/auth/google-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerUrl: '', clientId: '', clientSecret: '' }),
      })
      setWorkerUrl('')
      setClientId('')
      setClientSecret('')
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

  if (loading)
    return <div style={{ color: 'var(--text-secondary)', padding: '1.5rem' }}>Loading...</div>

  return (
    <div className={styles.sectionCard}>
      <h3 className={styles.title}>Google Drive Sync</h3>

      {user ? (
        <div className={styles.userInfo}>
          <p>
            Signed in as: <strong>{user.name}</strong> ({user.email})
          </p>
          <Button variant="danger" onClick={handleSignOut}>
            Sign Out
          </Button>
        </div>
      ) : (
        <div className={styles.signIn}>
          <p>Sign in with your Google account to enable synchronization features.</p>
          <Button onClick={handleSignIn} disabled={!hasAuthConfig}>
            Sign in with Google
          </Button>
          {!hasAuthConfig && (
            <p className={styles.warning}>Google sync is not configured on the server.</p>
          )}
        </div>
      )}

      <details style={{ marginTop: '1rem', fontSize: 'var(--font-size-sm)' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>
          Advanced: use your own auth {hasOverride ? '(override active)' : ''}
        </summary>
        <div className={styles.formGroup} style={{ marginTop: '0.75rem' }}>
          <label className={styles.label}>Worker URL (optional)</label>
          <input
            className={styles.input}
            value={workerUrl}
            onChange={(e) => setWorkerUrl(e.currentTarget.value)}
            placeholder="https://your-worker.workers.dev"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>Client ID (optional)</label>
          <input
            className={styles.input}
            value={clientId}
            onChange={(e) => setClientId(e.currentTarget.value)}
            placeholder="Your Google OAuth client ID"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>Client Secret (optional)</label>
          <input
            type="password"
            className={styles.input}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.currentTarget.value)}
            placeholder="Your Google OAuth secret"
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

export default GoogleAuthSettings
