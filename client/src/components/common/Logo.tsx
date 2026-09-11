import React from 'react'
import { useTheme } from '../../contexts/ThemeContext'

const THEME_LOGOS: Record<string, string> = {
  iris: '/logo.png',
  mochi: '/logo-mochi.png',
  sakura: '/logo-sakura.png',
}

interface LogoProps {
  className?: string
}

const Logo: React.FC<LogoProps> = ({ className }) => {
  const { theme } = useTheme()
  const src = THEME_LOGOS[theme] || THEME_LOGOS.iris

  return (
    <img
      src={src}
      alt="dango"
      className={className}
      style={{
        height: 'var(--logo-height, 75px)',
        width: 'auto',
        display: 'block',
        objectFit: 'contain',
      }}
    />
  )
}

export default Logo
