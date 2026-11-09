import React from 'react'
import styles from './Logo.module.css'

interface LogoProps {
  className?: string
  collapsed?: boolean
}

const Logo: React.FC<LogoProps> = ({ className, collapsed }) => (
  <span
    className={className ? `${styles.logo} ${className}` : styles.logo}
    role="img"
    aria-label="dango"
  >
    <img src="/logo-mascot.png" alt="" aria-hidden="true" draggable={false} className={styles.img} />
    {!collapsed && <span className={styles.word}>dango</span>}
  </span>
)

export default Logo
