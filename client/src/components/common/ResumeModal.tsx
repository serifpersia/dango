import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from './Button'

interface ResumeModalProps {
  show: boolean
  resumeTime: string
  onResume: () => void
  onStartOver: () => void
  onNextEpisode?: () => void
  hasNextEpisode?: boolean
  isCompleted?: boolean
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.6)',
  zIndex: 9999,
  backdropFilter: 'blur(3px)',
}

const contentStyle: React.CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  zIndex: 10000,
  backgroundColor: 'var(--bg-secondary)',
  padding: '1.5rem',
  borderRadius: 'var(--radius-lg)',
  maxWidth: '420px',
  width: '100%',
  boxShadow: 'var(--shadow-xl)',
  border: '1px solid var(--border-primary)',
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
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content style={contentStyle} onEscapeKeyDown={(e) => e.preventDefault()}>
          {isCompleted ? (
            <>
              <h3 style={{ margin: '0 0 0.75rem', color: 'var(--text-primary)' }}>
                Episode Completed!
              </h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                {hasNextEpisode
                  ? 'You finished this episode. Ready for the next one?'
                  : 'You finished this episode. Want to watch again?'}
              </p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
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
              <h3 style={{ margin: '0 0 0.75rem', color: 'var(--text-primary)' }}>
                Resume Playback?
              </h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                You were watching at{' '}
                <strong style={{ color: 'var(--accent)' }}>{resumeTime}</strong>. Would you like to
                continue?
              </p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
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
