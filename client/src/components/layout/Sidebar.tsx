import React from 'react'
import { Link, NavLink } from 'react-router'
import { useSidebar } from '../../hooks/useSidebar'
import styles from './Sidebar.module.css'
import {
  FaHome,
  FaSearch,
  FaClock,
  FaSyncAlt,
  FaCog,
  FaChartPie,
  FaHeadphones,
  FaTv,
} from 'react-icons/fa'
import Logo from '../common/Logo'
import packageJson from '../../../package.json'

const Sidebar: React.FC = () => {
  const { isOpen, setIsOpen } = useSidebar()

  const handleNavLinkClick = () => {
    setIsOpen(false)
  }

  const navItems = [
    { to: '/', icon: <FaHome />, label: 'Home' },
    { to: '/search', icon: <FaSearch />, label: 'Search' },
    { to: '/watchlist', icon: <FaClock />, label: 'Watchlist' },
    { to: '/insights', icon: <FaChartPie />, label: 'Insights' },
    { to: '/trackers', icon: <FaSyncAlt />, label: 'Trackers' },
    { to: '/asmr', icon: <FaHeadphones />, label: 'ASMR' },
    { to: '/tv', icon: <FaTv />, label: 'TV & Movies' },
    { to: '/settings', icon: <FaCog />, label: 'Settings' },
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
