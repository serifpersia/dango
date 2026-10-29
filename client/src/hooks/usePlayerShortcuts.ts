import { useEffect } from 'react'

interface UsePlayerShortcutsOptions {
  onPrevious: () => void
  onNext: () => void
  onToggleTheater: () => void
  flashControls: () => void
}

export function usePlayerShortcuts({
  onPrevious,
  onNext,
  onToggleTheater,
  flashControls,
}: UsePlayerShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const target = e.target as HTMLElement
      if (
        target.closest(
          'input, textarea, button, select, a, [role="button"], [role="slider"], [contenteditable="true"]'
        )
      )
        return

      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
        flashControls()
      }

      if (e.key.toLowerCase() === 'n') {
        onNext()
      }

      if (e.key.toLowerCase() === 'p') {
        onPrevious()
      }

      if (e.key.toLowerCase() === 't') {
        onToggleTheater()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [flashControls, onNext, onPrevious, onToggleTheater])
}
