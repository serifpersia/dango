import { useCallback, useRef, useState } from 'react'

export interface MangaPopupData {
  provider: string
  mangaId: string
  title: string
  altTitle?: string | null
  cover: string
  contentRating?: string
  readTarget: string
  progressLabel?: string
  rating?: string
  mature?: boolean
}

const POPUP_CLOSE_DELAY_MS = 300

export function useMangaPopup() {
  const [popup, setPopup] = useState<{ data: MangaPopupData; rect: DOMRect } | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const openPopup = useCallback(
    (rect: DOMRect, data: MangaPopupData) => {
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
