import { useCallback, useRef } from 'react'

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE_PX = 20
const POPUP_CLOSE_DELAY_MS = 300

export function useCardInteraction(onOpenPopup: (rect: DOMRect, viaHold?: boolean) => void) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFiredRef = useRef(false)
  const longPressStartRef = useRef({ x: 0, y: 0 })
  const activePointerTypeRef = useRef<string | null>(null)

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const clearPopupTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const schedulePopupClose = useCallback((close: () => void) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(close, POPUP_CLOSE_DELAY_MS)
  }, [])

  const openViaHold = useCallback(
    (rect: DOMRect, viaHold = false) => {
      longPressFiredRef.current = viaHold
      onOpenPopup(rect, viaHold)
    },
    [onOpenPopup]
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, shouldBlur: boolean) => {
      if (shouldBlur || e.pointerType === 'mouse') return
      activePointerTypeRef.current = e.pointerType
      longPressFiredRef.current = false
      longPressStartRef.current = { x: e.clientX, y: e.clientY }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      cancelLongPress()
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null
        openViaHold(rect, true)
      }, LONG_PRESS_MS)
    },
    [cancelLongPress, openViaHold]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!longPressTimerRef.current) return
      const dx = Math.abs(e.clientX - longPressStartRef.current.x)
      const dy = Math.abs(e.clientY - longPressStartRef.current.y)
      if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) cancelLongPress()
    },
    [cancelLongPress]
  )

  const handlePointerUpOrCancel = useCallback(() => {
    cancelLongPress()
    activePointerTypeRef.current = null
  }, [cancelLongPress])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLElement>, shouldBlur: boolean) => {
      e.preventDefault()
      e.stopPropagation()
      if (activePointerTypeRef.current === 'touch') {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current)
          longPressTimerRef.current = null
          openViaHold((e.currentTarget as HTMLElement).getBoundingClientRect(), true)
        }
      } else if (!shouldBlur && !longPressFiredRef.current) {
        openViaHold((e.currentTarget as HTMLElement).getBoundingClientRect())
      }
    },
    [openViaHold]
  )

  const consumeLongPressClick = useCallback((): boolean => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false
      return true
    }
    return false
  }, [])

  return {
    longPressFiredRef,
    cancelLongPress,
    clearPopupTimeout,
    schedulePopupClose,
    openViaHold,
    handlePointerDown,
    handlePointerMove,
    handlePointerUpOrCancel,
    handleContextMenu,
    consumeLongPressClick,
  }
}
