import React from 'react'
import './Badge.css'

interface Props {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'warning'
  className?: string
  children: React.ReactNode
}

export function Badge({ variant = 'primary', className = '', children }: Props) {
  return <span className={`badge badge-${variant} ${className}`}>{children}</span>
}
