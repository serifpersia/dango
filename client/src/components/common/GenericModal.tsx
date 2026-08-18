import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import styles from './GenericModal.module.css'

interface GenericModalProps {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
  title?: string
}

const GenericModal: React.FC<GenericModalProps> = ({ isOpen, onClose, children, title }) => {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content} aria-label={title}>
          {title && <Dialog.Title className={styles.title}>{title}</Dialog.Title>}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default GenericModal
