import { useCallback, useRef, useState } from 'react'

export interface AsmrPopupData {
  rjCode: string
  title: string
  thumbnail?: string
  isAdult?: boolean
  rating?: string
  listenTarget: string
  progressLabel?: string
}

const POPUP_CLOSE_DELAY_MS = 300

export function useAsmrPopup() {
  const [popup, setPopup] = useState<{ data: AsmrPopupData; rect: DOMRect } | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const openPopup = useCallback(
    (rect: DOMRect, data: AsmrPopupData) => {
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
