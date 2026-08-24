import React from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

interface StatusModalProps {
  show: boolean
  message: string
  type: 'success' | 'error' | 'info'
  onClose: () => void
  showConfirmButton?: boolean
  onConfirm?: () => void
  confirmButtonText?: string
  cancelButtonText?: string
}

export default function StatusModal({
  show,
  message,
  type,
  onClose,
  showConfirmButton = false,
  onConfirm,
  confirmButtonText = 'Confirm',
  cancelButtonText = 'Cancel',
}: StatusModalProps) {
  return (
    <Modal isOpen={show} onClose={onClose} width="sm">
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>{message}</p>
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
        {showConfirmButton ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {cancelButtonText}
            </Button>
            <Button variant="danger" onClick={onConfirm}>
              {confirmButtonText}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>OK</Button>
        )}
      </div>
    </Modal>
  )
}
