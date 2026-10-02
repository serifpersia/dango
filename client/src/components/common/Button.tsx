import React, { forwardRef } from 'react'
import { cx } from '../../lib/utils'
import './Button.css'

interface Props extends React.HTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  children?: React.ReactNode
}

export const Button = forwardRef<HTMLButtonElement, Props>(
  (
    { variant = 'primary', size = 'md', loading, children, className = '', disabled, ...props },
    ref
  ) => {
    const classes = cx(
      'btn',
      `btn-${variant}`,
      size !== 'md' && `btn-${size}`,
      loading && 'btn-loading',
      className
    )

    return (
      <button className={classes} disabled={disabled || loading} ref={ref} {...props}>
        {loading ? <span className="btn-spinner" /> : children}
      </button>
    )
  }
)
