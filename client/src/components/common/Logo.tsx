import React from 'react'
import styles from './Logo.module.css'

interface LogoProps {
  className?: string
  collapsed?: boolean
}

const Logo: React.FC<LogoProps> = ({ className, collapsed }) => (
  <svg
    viewBox={collapsed ? '0 0 90 91' : '0 0 271 91'}
    className={className ? `${styles.logo} ${className}` : styles.logo}
    role="img"
    aria-label="dango"
  >
    <title>dango</title>
    <circle className={styles.ball} cx="45" cy="45.5" r="39" />
    <path className={styles.eyes} d="M36 36.5v18M54 36.5v18" />
    {!collapsed && (
      <text className={styles.word} x="97" y="67">
        dango
      </text>
    )}
  </svg>
)

export default Logo
