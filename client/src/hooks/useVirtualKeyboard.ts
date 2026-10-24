import { profileStorage } from '../lib/profileStorage'
import { useEffect, useRef, useState } from 'react'

export const VIRTUAL_KEYBOARD_HIDE_EVENT = 'virtual-keyboard:hide'
export const VIRTUAL_KEYBOARD_ENABLED_CHANGE_EVENT = 'virtual-keyboard:enabled-change'
export const VIRTUAL_KEYBOARD_ENABLED_KEY = 'virtual_keyboard_enabled'
export const VIRTUAL_KEYBOARD_DEFAULT_ENABLED = false

export function getVirtualKeyboardEnabled() {
  const saved = profileStorage.getItem(VIRTUAL_KEYBOARD_ENABLED_KEY)
  return saved === null ? VIRTUAL_KEYBOARD_DEFAULT_ENABLED : saved === 'true'
}

const isTextInput = (target: EventTarget | null): target is HTMLInputElement => {
  return (
    target instanceof HTMLInputElement &&
    target.type === 'text' &&
    !target.disabled &&
    !target.readOnly
  )
}

export function hideVirtualKeyboard() {
  window.dispatchEvent(new CustomEvent(VIRTUAL_KEYBOARD_HIDE_EVENT))
}

export function useVirtualKeyboard() {
  const [isVisible, setIsVisible] = useState(false)
  const [isEnabled, setIsEnabled] = useState(getVirtualKeyboardEnabled)
  const activeInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      if (!isEnabled) return
      if (!isTextInput(event.target)) return

      activeInputRef.current = event.target
      setIsVisible(true)
    }

    const handleFocusOut = (event: FocusEvent) => {
      if (event.target !== activeInputRef.current) return

      window.setTimeout(() => {
        if (isTextInput(document.activeElement)) {
          activeInputRef.current = document.activeElement
          setIsVisible(true)
          return
        }

        activeInputRef.current = null
        setIsVisible(false)
      }, 0)
    }

    const handleHide = () => {
      activeInputRef.current = null
      setIsVisible(false)
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== VIRTUAL_KEYBOARD_ENABLED_KEY) return

      const nextEnabled = event.newValue === 'true'
      setIsEnabled(nextEnabled)
      if (!nextEnabled) handleHide()
    }

    const handleEnabledChange = () => {
      const nextEnabled = getVirtualKeyboardEnabled()
      setIsEnabled(nextEnabled)
      if (!nextEnabled) handleHide()
    }

    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)
    window.addEventListener(VIRTUAL_KEYBOARD_HIDE_EVENT, handleHide)
    window.addEventListener('storage', handleStorage)
    window.addEventListener(VIRTUAL_KEYBOARD_ENABLED_CHANGE_EVENT, handleEnabledChange)

    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
      window.removeEventListener(VIRTUAL_KEYBOARD_HIDE_EVENT, handleHide)
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(VIRTUAL_KEYBOARD_ENABLED_CHANGE_EVENT, handleEnabledChange)
    }
  }, [isEnabled])

  return {
    activeInputRef,
    isVisible: isEnabled && isVisible,
    hide: () => setIsVisible(false),
  }
}
