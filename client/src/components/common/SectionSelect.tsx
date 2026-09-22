import React from 'react'
import styles from './SectionSelect.module.css'

interface SectionSelectOption {
  value: string
  label: string
}

interface SectionSelectProps {
  value: string
  options: SectionSelectOption[]
  onChange: (value: string) => void
  ariaLabel?: string
  width?: string | number
}

const SectionSelect: React.FC<SectionSelectProps> = ({
  value,
  options,
  onChange,
  ariaLabel,
  width,
}) => {
  return (
    <select
      className={styles.select}
      style={width !== undefined ? { width } : undefined}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.currentTarget.value)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}

export default SectionSelect
