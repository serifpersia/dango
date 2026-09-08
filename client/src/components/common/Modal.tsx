import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'preact/compat'
import styles from './Modal.module.css'

interface ModalProps {
  isOpen: boolean
  onClose?: () => void
  title?: string
  children?: ReactNode
  footer?: ReactNode
  width?: 'sm' | 'md' | 'lg'
}

function Header({ children }: { children: ReactNode }) {
  return <h2 className={styles.title}>{children}</h2>
}

function Body({ children }: { children: ReactNode }) {
  return <div className={styles.body}>{children}</div>
}

function Actions({ children }: { children: ReactNode }) {
  return <div className={styles.footer}>{children}</div>
}

export function Modal({ isOpen, onClose, title, children, footer, width = 'md' }: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    contentRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div role="presentation" onMouseDown={(e) => e.stopPropagation()}>
      <div className={styles.overlay} onClick={() => onClose?.()} aria-hidden="true" />
      <div
        ref={contentRef}
        className={`${styles.content} ${styles[width]}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        {title && <Header>{title}</Header>}
        <Body>{children}</Body>
        {footer && <Actions>{footer}</Actions>}
      </div>
    </div>,
    document.body
  )
}

Modal.Header = Header
Modal.Body = Body
Modal.Actions = Actions

export default Modal
