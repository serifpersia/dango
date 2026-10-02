import { useCallback, useRef, useState } from 'react'

const POPUP_CLOSE_DELAY_MS = 300

export function usePopup<T>() {
  const [popup, setPopup] = useState<{ data: T; rect: DOMRect } | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const openPopup = useCallback(
    (rect: DOMRect, data: T) => {
      cancelClose()
      setPopup({ data, rect })
    },
    [cancelClose]
  )

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      setPopup(null)
    }, POPUP_CLOSE_DELAY_MS)
  }, [cancelClose])

  const closePopup = useCallback(() => {
    cancelClose()
    setPopup(null)
  }, [cancelClose])

  return { popup, openPopup, scheduleClose, cancelClose, closePopup }
}
