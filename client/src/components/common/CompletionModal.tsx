import React from 'react'
import { Modal } from './Modal'
import Icon from './Icon'
import styles from './Modal.module.css'

interface CompletionModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  heading: string
  message: string
  children?: React.ReactNode
}

const CompletionModal: React.FC<CompletionModalProps> = ({
  isOpen,
  onClose,
  title,
  heading,
  message,
  children,
}) => (
  <Modal isOpen={isOpen} onClose={onClose} title={title} width="sm">
    <div style={{ padding: '1rem', textAlign: 'center' }}>
      <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
        <Icon name="times" size={16} />
      </button>
      <Icon
        name="check-circle"
        size={48}
        style={{ color: 'var(--accent-lighter)', marginBottom: '0.5rem' }}
      />
      <p style={{ fontSize: '1.1rem', fontWeight: 600 }}>{heading}</p>
      <p style={{ color: 'var(--text-secondary)' }}>{message}</p>
      {children && (
        <div
          style={{
            marginTop: '1rem',
            display: 'flex',
            gap: '10px',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          {children}
        </div>
      )}
    </div>
  </Modal>
)

export default CompletionModal
