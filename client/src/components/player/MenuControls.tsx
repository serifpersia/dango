import React from 'react'
import { FaCheck } from 'react-icons/fa'
import styles from './menu-controls.module.css'

interface MenuSliderProps {
  label: string
  display: string
  min: number
  max: number
  step: number
  value: number
  percent: number
  onChange: (value: number) => void
  onCommit?: () => void
}

export const MenuSlider: React.FC<MenuSliderProps> = ({
  label,
  display,
  min,
  max,
  step,
  value,
  percent,
  onChange,
  onCommit,
}) => (
  <div className={styles.row}>
    <div className={styles.rowHeader}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{display}</span>
    </div>
    <input
      type="range"
      className={styles.slider}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
      onPointerUp={onCommit}
      onTouchEnd={onCommit}
      onKeyUp={onCommit}
      onBlur={onCommit}
      style={{ '--slider-percent': `${percent}%` } as React.CSSProperties}
    />
  </div>
)

interface SwatchRowProps {
  label: string
  colors: string[]
  value: string
  onChange: (color: string) => void
}

export const SwatchRow: React.FC<SwatchRowProps> = ({ label, colors, value, onChange }) => (
  <div className={styles.row}>
    <div className={styles.rowHeader}>
      <span className={styles.rowLabel}>{label}</span>
    </div>
    <div className={styles.swatches}>
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${label} ${c}`}
          aria-pressed={value.toLowerCase() === c.toLowerCase()}
          onClick={() => onChange(c)}
          className={`${styles.swatch} ${value.toLowerCase() === c.toLowerCase() ? styles.swatchPicked : ''}`}
          style={{ backgroundColor: c }}
        />
      ))}
      <input
        type="color"
        aria-label={`Custom ${label.toLowerCase()}`}
        className={styles.colorInput}
        value={value}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
      />
    </div>
  </div>
)

interface SegmentedRowProps<T extends string> {
  label: string
  options: readonly T[]
  value: T
  onChange: (option: T) => void
}

export function SegmentedRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedRowProps<T>): React.ReactElement {
  return (
    <div className={styles.row}>
      <div className={styles.rowHeader}>
        <span className={styles.rowLabel}>{label}</span>
      </div>
      <div className={styles.segmented} role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            <span>{option}</span>
            {value === option && <FaCheck size={10} />}
          </button>
        ))}
      </div>
    </div>
  )
}
