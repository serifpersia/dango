import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import styles from './Modal.module.css'

interface Props {
  isOpen: boolean
  onClose?: () => void
  title?: string
  children?: React.ReactNode
  footer?: React.ReactNode
  width?: 'sm' | 'md' | 'lg'
}

export function Modal({ isOpen, onClose, title, children, footer, width = 'md' }: Props) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose?.()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={`${styles.content} ${styles[width]}`}>
          {title && <Dialog.Title className={styles.title}>{title}</Dialog.Title>}
          <div className={styles.body}>{children}</div>
          {footer && <div className={styles.footer}>{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
