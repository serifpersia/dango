import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import './Modal.css'

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
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={`modal-content modal-${width}`}>
          {title && <Dialog.Title className="modal-title">{title}</Dialog.Title>}
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
