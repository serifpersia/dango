import React, { useState, useEffect } from 'react'
import { Button } from '../common/Button'
import styles from './LanAuthSettings.module.css'

const LanAuthSettings: React.FC = () => {
  const [hasPassword, setHasPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/auth/app-status')
        const data = await res.json()
        setHasPassword(data.hasPassword)
      } catch {
        console.error('Failed to fetch LAN auth status')
      } finally {
        setIsLoading(false)
      }
    }
    checkStatus()
  }, [])

  const handleSetup = async () => {
    setStatus('')
    if (password !== confirmPassword) {
      setStatus('Passwords do not match')
      return
    }
    if (password.length < 4) {
      setStatus('Password must be at least 4 characters')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch('/api/auth/app-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setStatus(data.error || 'Failed to update password')
        return
      }

      setHasPassword(data.hasPassword)
      setPassword('')
      setConfirmPassword('')
      setStatus(data.hasPassword ? 'Password set successfully' : 'Password removed')
    } catch {
      setStatus('Network error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRemove = async () => {
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/auth/app-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '' }),
      })

      const data = await res.json()

      if (!res.ok) {
        setStatus(data.error || 'Failed to remove password')
        return
      }

      setHasPassword(false)
      setPassword('')
      setConfirmPassword('')
      setStatus('Password removed')
    } catch {
      setStatus('Network error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleLogout = async () => {
    setIsSubmitting(true)
    try {
      await fetch('/api/auth/app-logout', { method: 'POST' })
      setStatus('Logged out')
      window.location.reload()
    } catch {
      setStatus('Logout failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className={styles.sectionCard}>
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div className={styles.sectionCard}>
      <h3>LAN Lock</h3>
      <p>
        Require a password to access this instance from any device, including this one. Sessions
        persist across server restarts until logout or password change.
      </p>

      <div className={styles.settingItem}>
        <div className={styles.field}>
          <label htmlFor="lan-password">New Password</label>
          <input
            id="lan-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              hasPassword ? 'Leave empty to keep current password' : 'Enter a password...'
            }
            className={styles.input}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="lan-confirm-password">Confirm Password</label>
          <input
            id="lan-confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm password..."
            className={styles.input}
          />
        </div>
        <div className={styles.actions}>
          <Button
            variant="primary"
            onClick={handleSetup}
            loading={isSubmitting}
            disabled={isSubmitting}
          >
            {hasPassword ? 'Update Password' : 'Set Password'}
          </Button>
          {hasPassword && (
            <Button
              variant="danger"
              onClick={handleLogout}
              loading={isSubmitting}
              disabled={isSubmitting}
            >
              Logout
            </Button>
          )}
          {hasPassword && (
            <Button
              variant="secondary"
              onClick={handleRemove}
              loading={isSubmitting}
              disabled={isSubmitting}
            >
              Remove Password
            </Button>
          )}
        </div>
        {status && <p className={styles.status}>{status}</p>}
      </div>
    </div>
  )
}

export default LanAuthSettings
