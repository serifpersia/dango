import React from 'react'
import styles from './DangoMascot.module.css'

interface DangoMascotProps {
  size?: number
  className?: string
}

const DangoMascot: React.FC<DangoMascotProps> = ({ size = 150, className }) => (
  <img
    src="/logo-mascot.png"
    alt=""
    aria-hidden="true"
    draggable={false}
    className={className ? `${styles.mascot} ${className}` : styles.mascot}
    style={{ width: size }}
  />
)

export default DangoMascot
