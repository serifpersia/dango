import React, { useState, useEffect } from 'react'
import { Link, NavLink } from 'react-router'
import { useSidebar } from '../../hooks/useSidebar'
import { useContentType } from '../../contexts/ContentTypeContext'
import styles from './Sidebar.module.css'
import Icon from '../common/Icon'
import Logo from '../common/Logo'
import packageJson from '../../../package.json'

const Sidebar: React.FC = () => {
  const { isOpen, setIsOpen } = useSidebar()
  const { contentType } = useContentType()
  const [hasMatureConsent, setHasMatureConsent] = useState(
    () => localStorage.getItem('agreedToViewMature') === 'true'
  )

  useEffect(() => {
    const sync = () => setHasMatureConsent(localStorage.getItem('agreedToViewMature') === 'true')
    window.addEventListener('storage', sync)
    window.addEventListener('focus', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('focus', sync)
    }
  }, [])

  const handleNavLinkClick = () => {
    setIsOpen(false)
  }

  const isManga = contentType === 'manga'
  const isTv = contentType === 'tv'
  const isAsmr = contentType === 'asmr'

  const navItems = [
    { to: '/', icon: <Icon name="home" />, label: 'Home' },
    isManga
      ? { to: '/manga', icon: <Icon name="book" />, label: 'Manga' }
      : isTv
        ? { to: '/tv-search', icon: <Icon name="tv" />, label: 'TV and Movies' }
        : isAsmr
          ? { to: '/asmr', icon: <Icon name="headphones" />, label: 'ASMR' }
          : { to: '/search', icon: <Icon name="search" />, label: 'Search' },
    isManga
      ? { to: '/reading-list', icon: <Icon name="bookmark" />, label: 'Reading List' }
      : isTv
        ? { to: '/tv-watchlist', icon: <Icon name="clock" />, label: 'TV Watchlist' }
        : isAsmr
          ? { to: '/listening-list', icon: <Icon name="history" />, label: 'Listening List' }
          : { to: '/watchlist', icon: <Icon name="clock" />, label: 'Watchlist' },
    { to: '/insights', icon: <Icon name="chart-pie" />, label: 'Insights' },
    { to: '/trackers', icon: <Icon name="sync-alt" />, label: 'Trackers' },
    { to: '/radio', icon: <Icon name="broadcast-tower" />, label: 'Radio' },
    { to: '/music', icon: <Icon name="headphones" />, label: 'Music' },
    ...(hasMatureConsent
      ? [{ to: '/mature', icon: <Icon name="pepper-hot" />, label: 'Mature' }]
      : []),
    { to: '/settings', icon: <Icon name="cog" />, label: 'Settings' },
  ]

  return (
    <>
      <aside className={`${styles.sidebar} ${isOpen ? styles.open : ''} sidebar`}>
        <div className={styles.sidebarHeader}>
          <button
            className={styles.closeBtn}
            onClick={() => setIsOpen(false)}
            aria-label="Close menu"
          >
            &times;
          </button>
          <Link to="/" className={styles.logo} onClick={handleNavLinkClick}>
            <Logo />
          </Link>
        </div>

        <nav className={styles.navSection}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
              onClick={handleNavLinkClick}
              end={item.to === '/'}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={styles.versionInfo}>v{packageJson.version}</div>
      </aside>
      {isOpen && (
        <div
          className={styles.overlay}
          onClick={() => setIsOpen(false)}
          aria-label="Close sidebar"
        />
      )}
    </>
  )
}

export default Sidebar
