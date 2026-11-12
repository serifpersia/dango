import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from './Button'
import Icon, { type IconName } from './Icon'
import styles from './OptionTabs.module.css'

export interface TabOption<T extends string> {
  value: T
  label: string
  icon?: IconName
}

const DANGO_BODY =
  'm 7,0 c -3.9372984,0 -7.10030437,2.4883888 -7,6 0.13572675,4.751733 5.0802847,4.156395 7,4.156395 1.2538994,0 6.530451,0.392468 6.584946,-4.168088 C 13.622023,2.8853946 10.937298,0 7,0 Z'
const DANGO_EYE_L =
  'm 4.9623825,3.416 c -0.5858889,0 -0.6520292,2.3368563 -0.024765,2.3368563 0.6604959,0 0.6704653,-2.3368563 0.024765,-2.3368563 z'
const DANGO_EYE_R =
  'M 8.588001,3.416 C 8.0021121,3.416 7.9359718,5.7528563 8.563236,5.7528563 9.2237319,5.7528563 9.2337013,3.416 8.588001,3.416 Z'
const DANGO_FACES = {
  pet: 'M 4.85,5.15 Q 5.285,4.0 5.72,5.15 M 8.25,5.15 Q 8.618,4.0 8.99,5.15',
  squint: 'M 4.82,3.9 L 5.6,4.62 L 4.82,5.34 M 9.08,3.9 L 8.3,4.62 L 9.08,5.34',
  sleep: 'M 4.9,4.72 Q 5.285,5.28 5.67,4.72 M 8.25,4.72 Q 8.618,5.28 9.0,4.72',
} as const
const DANGO_HEARTS = [
  { x: 7, y: 4.2, delay: 0, drift: '0px' },
  { x: 9.6, y: 6.4, delay: -0.3, drift: '-0.9px' },
  { x: 4.6, y: 6.1, delay: -0.6, drift: '0.8px' },
  { x: 8.2, y: 3.4, delay: -0.9, drift: '-0.4px' },
] as const

interface OptionTabsProps<T extends string> {
  options: TabOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
  variant?: 'pill' | 'underline' | 'dango'
}

function OptionTabsInner<T extends string>(
  { options, value, onChange, ariaLabel, variant = 'pill' }: OptionTabsProps<T>,
  ref?: React.Ref<HTMLDivElement>
) {
  const barRef = useRef<HTMLDivElement | null>(null)
  const btnRefs = useRef(new Map<string, HTMLButtonElement>())
  const prevValueRef = useRef<T | null>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  const updateIndicator = useCallback(
    (activeKey: string, scroll: boolean) => {
      if (variant === 'dango') return
      const el = btnRefs.current.get(activeKey)
      const bar = barRef.current
      if (el && bar) {
        const barRect = bar.getBoundingClientRect()
        const elRect = el.getBoundingClientRect()
        setIndicator({
          left: elRect.left - barRect.left + bar.scrollLeft,
          width: elRect.width,
        })
        if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    },
    [variant]
  )

  useLayoutEffect(() => {
    const changed = prevValueRef.current !== null && prevValueRef.current !== value
    prevValueRef.current = value
    updateIndicator(value, changed)
  }, [value, options.length, updateIndicator])

  useEffect(() => {
    updateIndicator(value, false)
    if (typeof ResizeObserver === 'undefined') return
    let raf = 0
    const bar = barRef.current
    if (!bar) return
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => updateIndicator(value, false))
    })
    ro.observe(bar)
    let cancelled = false
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) updateIndicator(value, false)
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
      className={
        variant === 'dango'
          ? styles.dangoBar
          : variant === 'underline'
            ? styles.underlineBar
            : styles.tabBar
      }
      ref={(el) => {
        barRef.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el
      }}
      aria-label={ariaLabel}
      role={variant === 'pill' ? undefined : 'group'}
      {...(variant === 'dango' ? { 'data-dango-origin': '' } : {})}
    >
      {variant === 'dango' ? (
        <span className={styles.dangoStick} aria-hidden="true" />
      ) : (
        <div
          className={variant === 'underline' ? styles.underlineIndicator : styles.tabIndicator}
          style={{ left: indicator.left, width: indicator.width }}
          aria-hidden="true"
        />
      )}
      {options.map((opt, index) =>
        variant === 'dango' ? (
          <button
            key={opt.value}
            ref={(el) => {
              if (el) btnRefs.current.set(opt.value, el)
            }}
            type="button"
            data-dango-slot={index}
            data-dango-face="normal"
            className={`${styles.dangoButton} ${value === opt.value ? styles.dangoActive : ''}`}
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
          >
            <span className={styles.dangoBall} aria-hidden="true">
              <svg viewBox="0 0 13.6 10.2" className={styles.dangoSvg} focusable="false">
                <path className={styles.dangoBody} d={DANGO_BODY} />
                <g className={styles.dangoGaze} data-dango-eye={index}>
                  <g className={`${styles.face} ${styles.faceNormal}`}>
                    <path className={styles.dangoEye} d={DANGO_EYE_L} />
                    <path className={styles.dangoEye} d={DANGO_EYE_R} />
                  </g>
                  <g className={`${styles.face} ${styles.facePet}`}>
                    <path className={styles.dangoLine} d={DANGO_FACES.pet} />
                  </g>
                  <g className={`${styles.face} ${styles.faceSquint}`}>
                    <path className={styles.dangoLine} d={DANGO_FACES.squint} />
                  </g>
                  <g className={`${styles.face} ${styles.faceSleep}`}>
                    <path className={styles.dangoLine} d={DANGO_FACES.sleep} />
                  </g>
                </g>
                <g className={styles.hearts}>
                  {DANGO_HEARTS.map((h) => (
                    <text
                      key={h.x}
                      className={styles.heart}
                      x={h.x}
                      y={h.y}
                      style={
                        {
                          '--drift': h.drift,
                          animationDelay: `${h.delay}s`,
                        } as React.CSSProperties
                      }
                    >
                      &#9829;
                    </text>
                  ))}
                </g>
              </svg>
            </span>
            <span className={styles.dangoLabel}>{opt.label}</span>
          </button>
        ) : (
          <Button
            key={opt.value}
            ref={(el: HTMLButtonElement | null) => {
              if (el) btnRefs.current.set(opt.value, el)
            }}
            variant={variant === 'underline' ? 'ghost' : 'secondary'}
            size="sm"
            type="button"
            className={
              variant === 'underline'
                ? `${styles.underlineButton} ${value === opt.value ? styles.underlineActive : ''}`
                : `${styles.tabButton} ${value === opt.value ? styles.tabActive : ''}`
            }
            aria-pressed={variant === 'underline' ? value === opt.value : undefined}
            onClick={() => onChange(opt.value)}
          >
            {opt.icon && <Icon name={opt.icon} size={18} />}
            <span>{opt.label}</span>
          </Button>
        )
      )}
    </div>
  )
}

const OptionTabs = React.forwardRef(OptionTabsInner) as <T extends string>(
  props: OptionTabsProps<T> & { ref?: React.Ref<HTMLDivElement> }
) => React.ReactElement

export default OptionTabs
