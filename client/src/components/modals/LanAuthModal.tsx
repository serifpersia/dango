import React, { useState } from 'react'
import GenericModal from '../common/GenericModal'
import styles from './LanAuthModal.module.css'
import { Button } from '../common/Button'
import toast from 'react-hot-toast'

interface LanAuthModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const LanAuthModal: React.FC<LanAuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  React.useEffect(() => {
    if (isOpen) {
      setPassword('')
    }
  }, [isOpen])

  const handleSubmit = async () => {
    if (!password) {
      toast.error('Please enter your password')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch('/api/auth/app-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        toast.error(data.error || 'Login failed')
        return
      }

      toast.success('Authenticated successfully')
      onSuccess()
      onClose()
      window.location.reload()
    } catch {
      toast.error('Network error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <GenericModal isOpen={isOpen} onClose={onClose} title="LAN Authentication Required">
      <div className={styles.container}>
        <p>This instance is protected. Enter the password to access from this device.</p>
        <div className={styles.field}>
          <label htmlFor="lan-password">Password</label>
          <input
            id="lan-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password..."
            className={styles.input}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={isSubmitting}>
            Unlock
          </Button>
        </div>
      </div>
    </GenericModal>
  )
}

export default LanAuthModal
