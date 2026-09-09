import React, { useState, useEffect } from 'react'
import { Button } from '../common/Button'
import { Modal } from '../common/Modal'
import styles from './GoogleAuthSettings.module.css'

const RcloneSettings: React.FC = () => {
  const [remote, setRemote] = useState('')
  const [availableRemotes, setAvailableRemotes] = useState<string[]>([])
  const [activeRemote, setActiveRemote] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [statusModal, setStatusModal] = useState<{
    show: boolean
    message: string
    type: 'success' | 'error' | 'info'
  }>({
    show: false,
    message: '',
    type: 'info',
  })

  const fetchSettings = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/auth/settings/rclone')
      const data = await res.json()
      setRemote(data.remote || '')
      setAvailableRemotes(data.availableRemotes || [])
      setActiveRemote(data.activeRemote || null)
    } catch (error) {
      console.error('Failed to fetch Rclone settings', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSettings()
  }, [])

  const handleSave = async () => {
    try {
      const res = await fetch('/api/auth/settings/rclone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remote }),
      })

      if (res.ok) {
        setStatusModal({
          show: true,
          message:
            'Rclone configuration saved successfully. You must restart the server for these changes to take effect.',
          type: 'success',
        })
        fetchSettings()
      } else {
        throw new Error('Failed to save')
      }
    } catch {
      setStatusModal({
        show: true,
        message: 'Failed to save Rclone configuration.',
        type: 'error',
      })
    }
  }

  if (loading)
    return <div style={{ color: 'var(--text-secondary)', padding: '1.5rem' }}>Loading...</div>

  return (
    <div className={styles.sectionCard}>
      <h3 className={styles.title}>Rclone Cloud Sync</h3>
      <p className={styles.signIn}>
        Configure which Rclone remote to use for database synchronization.
      </p>

      {activeRemote ? (
        <div className={styles.userInfo}>
          <p>
            Current Active Remote: <strong>{activeRemote}</strong>
          </p>
        </div>
      ) : (
        <p className={styles.warning} style={{ marginBottom: '1.5rem' }}>
          Rclone sync is not currently active. Ensure rclone is installed and a remote is
          configured.
        </p>
      )}

      <div className={styles.formGroup}>
        <label className={styles.label}>Remote Name</label>
        <div className={styles.inputWrapper}>
          <select
            className={styles.select}
            value={remote}
            onChange={(e) => setRemote(e.target.value)}
          >
            <option value="">(Disabled / None)</option>
            {availableRemotes.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            {remote && !availableRemotes.includes(remote) && (
              <option value={remote}>{remote} (Manual)</option>
            )}
          </select>
        </div>
        <p className={styles.warning} style={{ marginTop: '12px' }}>
          <strong>Note:</strong> You can choose which provider is active using the selector at the
          top of the page.
        </p>
      </div>

      <div className={styles.actions}>
        <Button onClick={handleSave}>Save Rclone Settings</Button>
      </div>

      <Modal
        isOpen={statusModal.show}
        onClose={() => setStatusModal((prev) => ({ ...prev, show: false }))}
        width="sm"
      >
        <Modal.Body>
          <p>{statusModal.message}</p>
        </Modal.Body>
        <Modal.Actions>
          <Button onClick={() => setStatusModal((prev) => ({ ...prev, show: false }))}>OK</Button>
        </Modal.Actions>
      </Modal>
    </div>
  )
}

export default RcloneSettings
