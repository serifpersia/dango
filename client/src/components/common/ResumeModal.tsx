import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from './Button'
import styles from './ResumeModal.module.css'

interface ResumeModalProps {
  show: boolean
  resumeTime: string
  onResume: () => void
  onStartOver: () => void
  onNextEpisode?: () => void
  hasNextEpisode?: boolean
  isCompleted?: boolean
}

export default function ResumeModal({
  show,
  resumeTime,
  onResume,
  onStartOver,
  onNextEpisode,
  hasNextEpisode,
  isCompleted,
}: ResumeModalProps) {
  return (
    <Dialog.Root open={show} onOpenChange={(open) => !open && onStartOver()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content} onEscapeKeyDown={(e) => e.preventDefault()}>
          {isCompleted ? (
            <>
              <h3>Episode Completed!</h3>
              <p>
                {hasNextEpisode
                  ? 'You finished this episode. Ready for the next one?'
                  : 'You finished this episode. Want to watch again?'}
              </p>
              <div className={styles.buttonRow}>
                <Button variant="secondary" onClick={onStartOver} style={{ flex: 1 }}>
                  {hasNextEpisode ? 'Replay' : 'Start Over'}
                </Button>
                {hasNextEpisode && (
                  <Button onClick={onNextEpisode} style={{ flex: 1 }}>
                    Next Episode
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <h3>Resume Playback?</h3>
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
