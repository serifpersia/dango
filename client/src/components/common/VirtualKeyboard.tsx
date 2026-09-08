import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'preact/compat'
import styles from './VirtualKeyboard.module.css'

type KeyboardSize = 'small' | 'medium' | 'large'

interface Position {
  x: number
  y: number
}

interface VirtualKeyboardProps {
  activeInputRef: { current: HTMLInputElement | null }
  isVisible: boolean
  onClose: () => void
}

const STORAGE_KEY = 'virtual-keyboard-state'
const sizeOrder: KeyboardSize[] = ['small', 'medium', 'large']
const numberKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
const symbolKeys = ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')']
const letterRows = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
]

const getInitialState = (): { position: Position; size: KeyboardSize } => {
  const fallback = {
    position: {
      x: Math.max(12, window.innerWidth - 690),
      y: Math.max(90, window.innerHeight - 330),
    },
    size: 'medium' as KeyboardSize,
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return fallback

    const parsed = JSON.parse(saved) as { position?: Position; size?: KeyboardSize }
    return {
      position:
        parsed.position && Number.isFinite(parsed.position.x) && Number.isFinite(parsed.position.y)
          ? parsed.position
          : fallback.position,
      size: parsed.size && sizeOrder.includes(parsed.size) ? parsed.size : fallback.size,
    }
  } catch {
    return fallback
  }
}

const clampPosition = (position: Position, element: HTMLDivElement | null): Position => {
  const width = element?.offsetWidth ?? 650
  const height = element?.offsetHeight ?? 270
  return {
    x: Math.min(Math.max(8, position.x), Math.max(8, window.innerWidth - width - 8)),
    y: Math.min(Math.max(8, position.y), Math.max(8, window.innerHeight - height - 8)),
  }
}

export default function VirtualKeyboard({
  activeInputRef,
  isVisible,
  onClose,
}: VirtualKeyboardProps) {
  const [{ position, size }, setStoredState] = useState(getInitialState)
  const [shiftEnabled, setShiftEnabled] = useState(false)
  const [symbolsEnabled, setSymbolsEnabled] = useState(false)
  const keyboardRef = useRef<HTMLDivElement>(null)
  const dragOffsetRef = useRef<Position | null>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ position, size }))
  }, [position, size])

  useEffect(() => {
    const handleResize = () => {
      setStoredState((current) => ({
        ...current,
        position: clampPosition(current.position, keyboardRef.current),
      }))
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const getTargetInput = () => {
    if (activeInputRef.current && document.contains(activeInputRef.current)) {
      return activeInputRef.current
    }

    return document.activeElement instanceof HTMLInputElement ? document.activeElement : null
  }

  const typeValue = (value: string) => {
    const input = getTargetInput()
    if (!input) return

    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? input.value.length
    input.setRangeText(value, start, end, 'end')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus()
  }

  const handleBackspace = () => {
    const input = getTargetInput()
    if (!input) return

    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? input.value.length
    if (start === end && start === 0) return

    input.setRangeText('', start === end ? start - 1 : start, end, 'end')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus()
  }

  const handleEnter = () => {
    const input = getTargetInput()
    if (!input) {
      onClose()
      return
    }

    const form = input.form
    if (form) {
      form.requestSubmit()
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    }

    onClose()
  }

  const handleMouseDown = (event: React.MouseEvent) => {
    event.preventDefault()
  }

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!dragOffsetRef.current) return

    const nextPosition = {
      x: event.clientX - dragOffsetRef.current.x,
      y: event.clientY - dragOffsetRef.current.y,
    }

    setStoredState((current) => ({
      ...current,
      position: clampPosition(nextPosition, keyboardRef.current),
    }))
  }, [])

  const handleMouseUp = useCallback(() => {
    dragOffsetRef.current = null
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseMove])

  const startDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragOffsetRef.current = {
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  if (!isVisible) return null

  const topKeys = symbolsEnabled ? symbolKeys : numberKeys
  const cycleSize = () => {
    setStoredState((current) => {
      const nextSize = sizeOrder[(sizeOrder.indexOf(current.size) + 1) % sizeOrder.length]
      return { ...current, size: nextSize }
    })
  }

  return createPortal(
    <div
      ref={keyboardRef}
      className={`${styles.keyboard} ${styles[size]}`}
      style={{ left: position.x, top: position.y }}
      onMouseDown={handleMouseDown}
      data-virtual-keyboard-root
    >
      <div className={styles.topBar}>
        <div
          className={styles.dragHandle}
          onMouseDown={startDrag}
          aria-label="Move virtual keyboard"
        >
          <span className={styles.grip} aria-hidden="true" />
          <span>Virtual Keyboard</span>
        </div>
        <button type="button" className={styles.topButton} onClick={cycleSize}>
          Size: {size[0].toUpperCase() + size.slice(1)}
        </button>
        <button
          type="button"
          className={`${styles.topButton} ${styles.closeButton}`}
          onClick={onClose}
        >
          X
        </button>
      </div>

      <div className={styles.keys}>
        <div className={styles.row}>
          {topKeys.map((key) => (
            <button key={key} type="button" className={styles.key} onClick={() => typeValue(key)}>
              {key}
            </button>
          ))}
          <button
            type="button"
            className={`${styles.key} ${styles.wideKey}`}
            onClick={handleBackspace}
            aria-label="Backspace"
          >
            ⟵
          </button>
        </div>

        {letterRows.map((row, rowIndex) => (
          <div className={styles.row} key={row.join('')}>
            {row.map((key) => {
              const value = shiftEnabled ? key.toUpperCase() : key
              return (
                <button
                  key={key}
                  type="button"
                  className={styles.key}
                  onClick={() => typeValue(value)}
                >
                  {value}
                </button>
              )
            })}
            {rowIndex === 1 && (
              <button
                type="button"
                className={`${styles.key} ${styles.wideKey}`}
                onClick={handleEnter}
              >
                Enter
              </button>
            )}
          </div>
        ))}

        <div className={styles.row}>
          <button
            type="button"
            className={`${styles.key} ${styles.wideKey} ${symbolsEnabled ? styles.activeKey : ''}`}
            onClick={() => setSymbolsEnabled((enabled) => !enabled)}
          >
            Ctrl
          </button>
          <button
            type="button"
            className={`${styles.key} ${styles.wideKey} ${shiftEnabled ? styles.activeKey : ''}`}
            onClick={() => setShiftEnabled((enabled) => !enabled)}
          >
            Shift
          </button>
          <button
            type="button"
            className={`${styles.key} ${styles.spaceKey}`}
            onClick={() => typeValue(' ')}
            aria-label="Space"
          >
            <span className={styles.spaceIcon} />
          </button>
          <button type="button" className={styles.key} onClick={() => typeValue('.')}>
            .
          </button>
          <button type="button" className={styles.key} onClick={() => typeValue('-')}>
            -
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
