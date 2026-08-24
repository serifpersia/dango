import React from 'react'
import './Layout.css'

interface Props {
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'full'
  className?: string
}

export function Container({ children, size = 'lg', className = '' }: Props) {
  return <div className={`container container-${size} ${className}`}>{children}</div>
}

export function Flex({
  children,
  className = '',
  gap,
  align,
  justify,
  direction = 'row',
  wrap,
}: {
  children: React.ReactNode
  className?: string
  gap?: string
  align?: 'start' | 'center' | 'end' | 'stretch'
  justify?: 'start' | 'center' | 'end' | 'between' | 'around'
  direction?: 'row' | 'col'
  wrap?: boolean
}) {
  const classes = [
    'flex',
    direction === 'col' && 'flex-col',
    wrap && 'flex-wrap',
    align && `items-${align}`,
    justify && `justify-${justify}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} style={{ gap }}>
      {children}
    </div>
  )
}

export function Grid({
  children,
  cols,
  gap,
  className = '',
}: {
  children: React.ReactNode
  cols?: number
  gap?: string
  className?: string
}) {
  return (
    <div
      className={`grid ${className}`}
      style={
        {
          '--grid-cols': cols,
          gap,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  )
}

export function Stack({
  children,
  gap,
  className = '',
}: {
  children: React.ReactNode
  gap?: string
  className?: string
}) {
  return (
    <div className={`stack ${className}`} style={{ gap }}>
      {children}
    </div>
  )
}
