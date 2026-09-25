import React, { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import styles from './Pagination.module.css'

interface PaginationProps {
  page: number
  totalPages?: number
  canGoNext: boolean
  onChange: (page: number) => void
  isLoading?: boolean
  variant?: 'compact' | 'labeled'
}

const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  canGoNext,
  onChange,
  isLoading = false,
  variant = 'compact',
}) => {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [shift, setShift] = useState(0)
  const [flipDown, setFlipDown] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    setShift(0)
    setFlipDown(false)
    const frame = requestAnimationFrame(() => {
      const dd = dropdownRef.current?.getBoundingClientRect()
      const picker = pickerRef.current?.getBoundingClientRect()
      if (!dd) return
      let s = 0
      if (dd.right > window.innerWidth - 8) s = window.innerWidth - 8 - dd.right
      else if (dd.left < 8) s = 8 - dd.left
      setShift(Math.round(s))
      if (picker && picker.top < dd.height + 24) setFlipDown(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  const maxPage = totalPages
  const options = useMemo(() => {
    if (maxPage !== undefined) {
      if (maxPage <= 100) {
        return Array.from({ length: maxPage }, (_, i) => i + 1)
      }
      const set = new Set<number>([1, maxPage])
      for (let p = page - 10; p <= page + 10; p++) {
        if (p >= 1 && p <= maxPage) set.add(p)
      }
      return [...set].sort((a, b) => a - b)
    }
    const end = canGoNext ? page + 1 : page
    return Array.from({ length: end }, (_, i) => i + 1)
  }, [maxPage, page, canGoNext])

  const go = (p: number) => {
    const target = maxPage !== undefined ? Math.min(Math.max(1, p), maxPage) : Math.max(1, p)
    setOpen(false)
    setDraft('')
    if (target !== page) onChange(target)
  }

  const submitDraft = () => {
    const p = parseInt(draft, 10)
    if (!Number.isNaN(p)) go(p)
  }

  const nextDisabled = isLoading || (maxPage !== undefined ? page >= maxPage : !canGoNext)

  return (
    <div className={styles.pagination} ref={rootRef}>
      <button
        className={styles.pageBtn}
        onClick={() => onChange(page - 1)}
        disabled={page <= 1 || isLoading}
        aria-label="Previous page"
      >
        <Icon name="chevron-left" size={14} />
        {variant === 'labeled' && <span>Previous</span>}
      </button>
      <div className={styles.pagePicker} ref={pickerRef}>
        <button
          className={styles.pageBtn}
          onClick={() => {
            setDraft('')
            setOpen((o) => !o)
          }}
          disabled={isLoading}
          aria-label="Jump to page"
          aria-expanded={open}
        >
          <span className={styles.pageInfo}>
            Page <strong>{page}</strong>
            {maxPage !== undefined && ` of ${maxPage}`}
          </span>
        </button>
        {open && (
          <div
            ref={dropdownRef}
            className={`${styles.dropdown} ${flipDown ? styles.flipDown : ''}`}
            style={shift !== 0 ? { marginLeft: shift } : undefined}
          >
            <div className={styles.jumpRow}>
              <input
                className={styles.jumpInput}
                type="number"
                inputMode="numeric"
                min={1}
                max={maxPage}
                value={draft}
                placeholder="Page #"
                onChange={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitDraft()
                }}
              />
              <button className={styles.jumpGo} onClick={submitDraft}>
                Go
              </button>
            </div>
            <div className={styles.optionList}>
              {options.map((p) => (
                <button
                  key={p}
                  className={`${styles.optionBtn} ${p === page ? styles.current : ''}`}
                  onClick={() => go(p)}
                  disabled={p === page}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <button
        className={styles.pageBtn}
        onClick={() => onChange(page + 1)}
        disabled={nextDisabled}
        aria-label="Next page"
      >
        {variant === 'labeled' && <span>Next</span>}
        <Icon name="chevron-right" size={14} />
      </button>
    </div>
  )
}

export default Pagination
