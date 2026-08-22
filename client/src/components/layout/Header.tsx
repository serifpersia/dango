import React, { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { FaBars, FaCloud, FaGithub, FaSearch } from 'react-icons/fa'
import NotificationBell from './NotificationBell'
import Logo from '../common/Logo'
import { useSidebar } from '../../hooks/useSidebar'
import { hideVirtualKeyboard } from '../../hooks/useVirtualKeyboard'
import styles from './Header.module.css'

interface UserProfile {
  name: string
  picture?: string
  email?: string
  provider: 'github' | 'google' | 'none'
}

const fetchSyncProfile = async (): Promise<UserProfile | null> => {
  const settingsRes = await fetch('/api/auth/settings/sync')
  if (!settingsRes.ok) return null

  const settings = await settingsRes.json()
  const activeProvider = settings.actualActiveProvider as 'github' | 'google' | 'rclone' | 'none'

  if (activeProvider === 'github') {
    const githubRes = await fetch('/api/auth/github/status')
    if (githubRes.ok) {
      const github = await githubRes.json()
      if (github.authenticated && github.user) {
        return {
          name: github.user.name || github.user.login,
          picture: github.user.avatarUrl,
          provider: 'github',
        }
      }
    }
  }

  if (activeProvider === 'google') {
    const googleRes = await fetch('/api/auth/user')
    if (googleRes.ok) {
      const google = await googleRes.json()
      if (google) {
        return {
          name: google.name,
          picture: google.picture,
          email: google.email,
          provider: 'google',
        }
      }
    }
  }

  return null
}

const Header: React.FC = () => {
  const { toggleSidebar } = useSidebar()
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(true)
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [isAtTop, setIsAtTop] = useState(true)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const autoHideTimer = useRef<number | null>(null)
  const mobileSearchRef = useRef<HTMLDivElement>(null)
  const mobileInputRef = useRef<HTMLInputElement>(null)
  const isHome = location.pathname === '/'

  const { data: user } = useQuery<UserProfile | null>({
    queryKey: ['sync-profile'],
    queryFn: fetchSyncProfile,
    staleTime: 30000,
  })

  useEffect(() => {
    const clearTimer = () => {
      if (autoHideTimer.current) {
        window.clearTimeout(autoHideTimer.current)
        autoHideTimer.current = null
      }
    }

    const handleScroll = () => {
      const currentScrollY = window.scrollY

      if (currentScrollY <= 10) {
        setIsAtTop(true)
        setVisible(true)
        clearTimer()
        return
      }

      setIsAtTop(false)
      setVisible(true)
      clearTimer()

      autoHideTimer.current = window.setTimeout(() => {
        setVisible(false)
      }, 2500)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        searchInputRef.current?.blur()
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('keydown', handleKeyDown)
      clearTimer()
    }
  }, [isSearchFocused])

  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const isMobile = () => window.innerWidth <= 1024

  const handleSearchButtonClick = () => {
    if (isMobile()) {
      setMobileSearchOpen(true)
      setTimeout(() => mobileInputRef.current?.focus(), 50)
    } else if (document.activeElement === searchInputRef.current && query.trim()) {
      handleSearch()
    } else {
      searchInputRef.current?.focus()
    }
  }

  const handleMobileSearchBlur = (e: React.FocusEvent) => {
    if (!mobileSearchRef.current?.contains(e.relatedTarget as Node)) {
      setMobileSearchOpen(false)
    }
  }

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault()
    hideVirtualKeyboard()
    if (query.trim()) {
      navigate(`/search?query=${encodeURIComponent(query.trim())}`)
    }
  }

  return (
    <>
      <header
        className={`${styles.header} ${!visible ? styles.hidden : ''} ${!isAtTop ? styles.scrolled : ''}`}
      >
        <div className={styles.headerInner}>
          <div className={styles.leftSection}>
            <button className={styles.hamburgerBtn} onClick={toggleSidebar} aria-label="Menu">
              <FaBars />
            </button>
            <Link to="/" className={styles.logo} aria-label="Ani-Web Home">
              <Logo />
            </Link>
            <nav className={styles.desktopNav}>
              <Link
                to="/"
                className={`${styles.navLink} ${location.pathname === '/' ? styles.navLinkActive : ''}`}
              >
                Home
              </Link>
              <Link
                to="/watchlist"
                className={`${styles.navLink} ${location.pathname === '/watchlist' ? styles.navLinkActive : ''}`}
              >
                Watchlist
              </Link>
              <Link
                to="/insights"
                className={`${styles.navLink} ${location.pathname === '/insights' ? styles.navLinkActive : ''}`}
              >
                Insights
              </Link>
              <Link
                to="/settings"
                className={`${styles.navLink} ${location.pathname.startsWith('/settings') ? styles.navLinkActive : ''}`}
              >
                Settings
              </Link>
            </nav>
          </div>

          <div className={styles.rightSection}>
            <div className={styles.searchWrapper}>
              <input
                ref={searchInputRef}
                type="text"
                data-virtual-keyboard="true"
                className={styles.searchInput}
                placeholder="Search anime..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearch()
                  }
                }}
              />
              <button
                type="button"
                className={styles.searchButton}
                aria-label="Search"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleSearchButtonClick}
              >
                <FaSearch className={styles.searchIcon} />
              </button>
            </div>

            <NotificationBell />

            <Link to="/settings?tab=sync" className={styles.profileBtn} aria-label="Sync settings">
              {user?.picture ? (
                <img
                  src={user.picture}
                  alt={user.name}
                  className={styles.profileImg}
                  referrerPolicy="no-referrer"
                />
              ) : user?.provider === 'github' ? (
                <FaGithub />
              ) : (
                <FaCloud />
              )}
            </Link>
          </div>
        </div>
      </header>
      {mobileSearchOpen && (
        <div
          className={styles.mobileSearchBar}
          ref={mobileSearchRef}
          onBlur={handleMobileSearchBlur}
        >
          <div className={styles.mobileSearchInner}>
            <FaSearch className={styles.mobileSearchIcon} />
            <input
              ref={mobileInputRef}
              type="text"
              data-virtual-keyboard="true"
              className={styles.mobileSearchInput}
              placeholder="Search anime..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearch()
                  setMobileSearchOpen(false)
                } else if (e.key === 'Escape') {
                  setMobileSearchOpen(false)
                }
              }}
            />
          </div>
        </div>
      )}
    </>
  )
}

export default Header
