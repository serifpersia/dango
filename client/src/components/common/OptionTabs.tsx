import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from './Button'
import styles from './OptionTabs.module.css'

export interface TabOption<T extends string> {
  value: T
  label: string
}

interface OptionTabsProps<T extends string> {
  options: TabOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
}

function OptionTabsInner<T extends string>(
  { options, value, onChange, ariaLabel }: OptionTabsProps<T>,
  ref?: React.Ref<HTMLDivElement>
) {
  const barRef = useRef<HTMLDivElement | null>(null)
  const btnRefs = useRef(new Map<string, HTMLButtonElement>())
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  const updateIndicator = useCallback((activeKey: string) => {
    const el = btnRefs.current.get(activeKey)
    const bar = barRef.current
    if (el && bar) {
      const barRect = bar.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      setIndicator({
        left: elRect.left - barRect.left + bar.scrollLeft,
        width: elRect.width,
      })
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [])

  useLayoutEffect(() => {
    updateIndicator(value)
  }, [value, options.length, updateIndicator])

  useEffect(() => {
    updateIndicator(value)
    if (typeof ResizeObserver === 'undefined') return
    let raf = 0
    const bar = barRef.current
    if (!bar) return
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => updateIndicator(value))
    })
    ro.observe(bar)
    let cancelled = false
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) updateIndicator(value)
      })
    }
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [value, options.length, updateIndicator])

  return (
    <div
      className={styles.tabBar}
      ref={(el) => {
        barRef.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el
      }}
      aria-label={ariaLabel}
    >
      <div
        className={styles.tabIndicator}
        style={{ left: indicator.left, width: indicator.width }}
      />
      {options.map((opt) => (
        <Button
          key={opt.value}
          ref={(el) => {
            if (el) btnRefs.current.set(opt.value, el)
          }}
          variant="secondary"
          size="sm"
          className={`${styles.tabButton} ${value === opt.value ? styles.tabActive : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  )
}

const OptionTabs = React.forwardRef(OptionTabsInner) as <T extends string>(
  props: OptionTabsProps<T> & { ref?: React.Ref<HTMLDivElement> }
) => React.ReactElement

export default OptionTabs
