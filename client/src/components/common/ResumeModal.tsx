import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { FaTimes } from 'react-icons/fa'
import { Button } from './Button'
import styles from './ResumeModal.module.css'

interface ResumeModalProps {
  show: boolean
  resumeTime: string
  onResume: () => void
  onStartOver: () => void
  onClose?: () => void
  isShowCompleted?: boolean
  onMoveToCompleted?: () => void
  isMovingToCompleted?: boolean
}

export default function ResumeModal({
  show,
  resumeTime,
  onResume,
  onStartOver,
  onClose,
  isShowCompleted,
  onMoveToCompleted,
  isMovingToCompleted,
}: ResumeModalProps) {
  const handleDismiss = React.useCallback(() => {
    if (onClose) onClose()
    else onStartOver()
  }, [onClose, onStartOver])

  return (
    <Dialog.Root open={show} onOpenChange={(open) => !open && handleDismiss()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Close asChild>
            <button className={styles.closeButton} aria-label="Close modal" type="button">
              <FaTimes />
            </button>
          </Dialog.Close>
          {isShowCompleted ? (
            <>
              <Dialog.Title asChild>
                <h3>Show Completed!</h3>
              </Dialog.Title>
              <p>Congratulations! You&apos;ve finished the final episode of this series.</p>
              <div className={styles.buttonRow}>
                <Button
                  onClick={onMoveToCompleted}
                  disabled={isMovingToCompleted}
                  style={{ flex: 1 }}
                >
                  {isMovingToCompleted ? 'Saving...' : 'Move to Completed'}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Dialog.Title asChild>
                <h3>Resume Playback?</h3>
              </Dialog.Title>
              <p>
                You were watching at{' '}
                <strong style={{ color: 'var(--accent)' }}>{resumeTime}</strong>. Would you like to
                continue?
              </p>
              <div className={styles.buttonRow}>
                <Button variant="secondary" onClick={onStartOver} style={{ flex: 1 }}>
                  Start Over
                </Button>
                <Button onClick={onResume} style={{ flex: 1 }}>
                  Resume
                </Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
