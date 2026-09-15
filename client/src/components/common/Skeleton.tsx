import type { CSSProperties } from 'react'
import './Skeleton.css'

interface Props {
  width?: string
  height?: string
  variant?: 'text' | 'circular' | 'rectangular'
  className?: string
  style?: CSSProperties
}

export function Skeleton({
  width = '100%',
  height = '1em',
  variant = 'rectangular',
  className = '',
  style,
}: Props) {
  return (
    <div
      className={`skeleton skeleton-${variant} ${className}`}
      style={{ width, height, ...style }}
    />
  )
}
