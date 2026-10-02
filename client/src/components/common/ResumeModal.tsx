import React from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

interface ResumeModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  message: React.ReactNode
  resumeLabel?: string
  restartLabel?: string
  onResume: () => void
  onRestart: () => void
}

const ResumeModal: React.FC<ResumeModalProps> = ({
  isOpen,
  onClose,
  title,
  message,
  resumeLabel = 'Resume',
  restartLabel = 'Start Over',
  onResume,
  onRestart,
}) => (
  <Modal isOpen={isOpen} onClose={onClose} title={title} width="sm">
    <div style={{ padding: '1rem', textAlign: 'center' }}>
      <p>{message}</p>
      <div
        style={{
          marginTop: '1rem',
          display: 'flex',
          gap: '10px',
          justifyContent: 'center',
        }}
      >
        <Button variant="secondary" onClick={onRestart}>
          {restartLabel}
        </Button>
        <Button onClick={onResume}>{resumeLabel}</Button>
      </div>
    </div>
  </Modal>
)

export default ResumeModal
