import React from 'react'
import { Link, useLocation } from 'react-router'
import Icon from '../common/Icon'
import Logo from '../common/Logo'
import styles from './Footer.module.css'
import packageJson from '../../../package.json'

const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear()
  const location = useLocation()

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleLogoClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (location.pathname === '/') {
      e.preventDefault()
      scrollToTop()
    }
  }

  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.brandSection}>
          <div className={styles.logoRow}>
            <Link to="/" onClick={handleLogoClick} aria-label="Home">
              <Logo collapsed className={styles.logoText} />
            </Link>
          </div>
          <div className={styles.brandMeta}>
            <div className={styles.statusPill}>
              <span className={styles.statusDot} />
              <span>v{packageJson.version}</span>
            </div>
            <p className={styles.brandTagline}>Fast, local anime streaming.</p>
          </div>
        </div>

        <div className={styles.linksGrid}>
          <div className={styles.linkColumn}>
            <h4 className={styles.columnTitle}>Navigation</h4>
            <Link to="/">Home</Link>
            <Link to="/watchlist">Watchlist</Link>
            <Link to="/settings">Settings</Link>
          </div>

          <div className={styles.linkColumn}>
            <h4 className={styles.columnTitle}>Features</h4>
            <Link to="/search">Search Anime</Link>
            <Link to="/trackers">Trackers</Link>
            <Link to="/insights">Insights</Link>
          </div>

          <div className={styles.linkColumn}>
            <h4 className={styles.columnTitle}>Community</h4>
            <a href="https://discord.gg/6yT3VwTqz9" target="_blank" rel="noopener noreferrer">
              <Icon name="discord" style={{ marginRight: '6px' }} /> Discord
            </a>
            <a
              href="https://github.com/serifpersia/dango"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="github" style={{ marginRight: '6px' }} /> GitHub
            </a>
          </div>

          <div className={styles.linkColumn}>
            <h4 className={styles.columnTitle}>Project</h4>
            <a
              href="https://github.com/serifpersia/dango/releases"
              target="_blank"
              rel="noopener noreferrer"
            >
              Releases
            </a>
            <a
              href="https://github.com/serifpersia/dango/issues"
              target="_blank"
              rel="noopener noreferrer"
            >
              Feedback
            </a>
          </div>
        </div>
      </div>

      <div className={styles.bottomBar}>
        <p className={styles.copyright}>
          © {currentYear} <span className={styles.brand}>dango</span> • Crafted with{' '}
          <Icon name="heart" className={styles.heartIcon} /> by{' '}
          <a href="https://github.com/serifpersia" target="_blank" rel="noopener noreferrer">
            serifpersia
          </a>
        </p>
        <button className={styles.backToTop} onClick={scrollToTop} aria-label="Back to top">
          <Icon name="chevron-up" size={14} />
          <span>Top</span>
        </button>
      </div>
    </footer>
  )
}

export default Footer
