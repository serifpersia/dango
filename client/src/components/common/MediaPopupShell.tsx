import React, { useState } from 'react'
import { createPortal } from 'preact/compat'
import { useFloating, flip, shift, autoUpdate } from '@floating-ui/react'
import styles from './MediaPopup.module.css'

interface MediaPopupShellProps {
  anchorRect: DOMRect
  onMouseEnter: () => void
  onMouseLeave: () => void
  onRequestClose?: () => void
  children: React.ReactNode
}

const MediaPopupShell: React.FC<MediaPopupShellProps> = ({
  anchorRect,
  onMouseEnter,
  onMouseLeave,
  onRequestClose,
  children,
}) => {
  const [isTouch] = useState(() => window.matchMedia('(pointer: coarse)').matches)

  const virtualEl = React.useMemo(
    () => ({
      getBoundingClientRect: () => anchorRect,
    }),
    [anchorRect]
  )

  const { refs, floatingStyles } = useFloating({
    placement: 'right-start',
    middleware: [flip({ fallbackAxisSideDirection: 'start' }), shift({ padding: 20 })],
    whileElementsMounted: autoUpdate,
  })

  React.useEffect(() => {
    refs.setPositionReference(virtualEl)
  }, [refs, virtualEl])

  React.useEffect(() => {
    if (!isTouch) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isTouch])

  const content = (
    <>
      {isTouch && <div className={styles.popupBackdrop} onClick={() => onRequestClose?.()} />}
      <div
        ref={isTouch ? undefined : refs.setFloating}
        className={`${styles.popupPortal} ${isTouch ? styles.mobile : ''}`}
        style={isTouch ? undefined : floatingStyles}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className={styles.popupContent}>{children}</div>
      </div>
    </>
  )

  return createPortal(content, document.body)
}

export default MediaPopupShell
