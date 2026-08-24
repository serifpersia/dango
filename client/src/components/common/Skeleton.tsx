import React from 'react'
import './Skeleton.css'

interface Props {
  width?: string
  height?: string
  variant?: 'text' | 'circular' | 'rectangular'
  className?: string
}

export function Skeleton({
  width = '100%',
  height = '1em',
  variant = 'rectangular',
  className = '',
}: Props) {
  return <div className={`skeleton skeleton-${variant} ${className}`} style={{ width, height }} />
}

export function SkeletonText({
  lines = 3,
  className = '',
}: {
  lines?: number
  className?: string
}) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '70%' : '100%'} height="1em" variant="text" />
      ))}
    </div>
  )
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`skeleton-card ${className}`}>
      <Skeleton height="60%" variant="rectangular" />
      <div className="p-3">
        <Skeleton width="80%" height="1em" variant="text" />
        <Skeleton width="60%" height="1em" variant="text" />
      </div>
    </div>
  )
}
