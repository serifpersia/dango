import React, { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import Icon from '../common/Icon'
import NotificationBell from './NotificationBell'
import Logo from '../common/Logo'
import { useSidebar } from '../../contexts/SidebarContext'
import { useContentType } from '../../contexts/ContentTypeContext'
import { hideVirtualKeyboard } from '../../hooks/useVirtualKeyboard'
import { profileQuery } from '../../hooks/useProfile'
import ProfileAvatar from '../common/ProfileAvatar'
import styles from './Header.module.css'

const Header: React.FC = () => {
  const { toggleSidebar } = useSidebar()
  const { contentType } = useContentType()
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(true)
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [isAtTop, setIsAtTop] = useState(true)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const autoHideTimer = useRef<number | null>(null)
  const scrollTicking = useRef(false)
  const scrollRaf = useRef<number | null>(null)
  const mobileSearchRef = useRef<HTMLDivElement>(null)
  const mobileInputRef = useRef<HTMLInputElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const overHeader = useRef(false)

  const { data: user } = useQuery(profileQuery)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const sync = () => {
      headerRef.current?.style.setProperty('--vv-top', `${vv.offsetTop}px`)
    }
    sync()
    vv.addEventListener('scroll', sync)
    vv.addEventListener('resize', sync)
    return () => {
      vv.removeEventListener('scroll', sync)
      vv.removeEventListener('resize', sync)
    }
  }, [])

  useEffect(() => {
    const clearTimer = () => {
      if (autoHideTimer.current) {
        window.clearTimeout(autoHideTimer.current)
        autoHideTimer.current = null
      }
    }

    const scheduleHide = () => {
      clearTimer()
      if (window.scrollY <= 10) return
      autoHideTimer.current = window.setTimeout(() => {
        if (!overHeader.current) setVisible(false)
      }, 2500)
    }

    const handleScroll = () => {
      if (scrollTicking.current) return
      scrollTicking.current = true
      scrollRaf.current = requestAnimationFrame(() => {
        scrollTicking.current = false
        scrollRaf.current = null
        const atTop = window.scrollY <= 10
        setIsAtTop((prev) => (prev === atTop ? prev : atTop))
        setVisible((prev) => (prev ? prev : true))
        scheduleHide()
      })
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus({ preventScroll: true })
      } else if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        searchInputRef.current?.blur()
      }
    }

    const header = headerRef.current
    const handleEnter = () => {
      overHeader.current = true
    }
    const handleLeave = () => {
      overHeader.current = false
      scheduleHide()
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('keydown', handleKeyDown)
    header?.addEventListener('pointerenter', handleEnter)
    header?.addEventListener('pointerleave', handleLeave)
    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('keydown', handleKeyDown)
      header?.removeEventListener('pointerenter', handleEnter)
      header?.removeEventListener('pointerleave', handleLeave)
      clearTimer()
      if (scrollRaf.current !== null) {
        cancelAnimationFrame(scrollRaf.current)
        scrollRaf.current = null
      }
      scrollTicking.current = false
    }
  }, [isSearchFocused])

  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const isMobile = () => window.innerWidth <= 1024

  const handleSearchButtonClick = () => {
    if (isMobile()) {
      setMobileSearchOpen(true)
      setTimeout(() => mobileInputRef.current?.focus({ preventScroll: true }), 50)
    } else if (document.activeElement === searchInputRef.current && query.trim()) {
      handleSearch()
    } else {
      searchInputRef.current?.focus({ preventScroll: true })
    }
  }

  const handleMobileSearchBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (!mobileSearchRef.current?.contains(e.relatedTarget as Node)) {
      setMobileSearchOpen(false)
    }
  }

  const searchPlaceholder =
    contentType === 'manga'
      ? 'Search manga...'
      : contentType === 'tv'
        ? 'Search TV & movies...'
        : contentType === 'asmr'
          ? 'Search ASMR...'
          : 'Search anime...'

  const listLink =
    contentType === 'manga'
      ? { to: '/reading-list', label: 'Reading List' }
      : contentType === 'tv'
        ? { to: '/tv-watchlist', label: 'TV Watchlist' }
        : contentType === 'asmr'
          ? { to: '/listening-list', label: 'Listening List' }
          : { to: '/watchlist', label: 'Watchlist' }

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault()
    hideVirtualKeyboard()
    const trimmed = query.trim()
    if (!trimmed) return
    if (contentType === 'manga') {
      navigate(`/manga?q=${encodeURIComponent(trimmed)}`)
    } else if (contentType === 'tv') {
      navigate(`/tv-search?q=${encodeURIComponent(trimmed)}`)
    } else if (contentType === 'asmr') {
      navigate(`/asmr?q=${encodeURIComponent(trimmed)}`)
    } else {
      navigate(`/search?query=${encodeURIComponent(trimmed)}`)
    }
  }

  return (
    <>
      <header
        ref={headerRef}
        className={`${styles.header} ${!visible ? styles.hidden : ''} ${!isAtTop ? styles.scrolled : ''}`}
      >
        <div className={styles.headerInner}>
          <div className={styles.leftSection}>
            <button className={styles.hamburgerBtn} onClick={toggleSidebar} aria-label="Menu">
              <Icon name="bars" />
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
                to={listLink.to}
                className={`${styles.navLink} ${location.pathname.startsWith(listLink.to) ? styles.navLinkActive : ''}`}
              >
                {listLink.label}
              </Link>
              {contentType === 'anime' && (
                <Link
                  to="/insights"
                  className={`${styles.navLink} ${location.pathname === '/insights' ? styles.navLinkActive : ''}`}
                >
                  Insights
                </Link>
              )}
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
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
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
                <Icon name="search" className={styles.searchIcon} />
              </button>
            </div>

            <NotificationBell />

            <Link
              to="/settings"
              className={styles.profileBtn}
              aria-label={`${user?.name ?? 'Profile'} — profile settings`}
              title={`${user?.name ?? 'Profile'}${user?.owner ? ' (owner)' : ''} — profile settings`}
            >
              <span className={styles.profileAvatar} aria-hidden="true">
                <ProfileAvatar image={user?.image} name={user?.name ?? 'Profile'} />
              </span>
              <span className={styles.profileName}>{user?.name ?? 'Profile'}</span>
            </Link>
          </div>
        </div>
        {mobileSearchOpen && (
          <div
            className={`${styles.mobileSearchBar} ${!visible ? styles.mobileSearchBarHidden : ''}`}
            ref={mobileSearchRef}
            onBlur={handleMobileSearchBlur}
          >
            <div className={styles.mobileSearchInner}>
              <Icon name="search" className={styles.mobileSearchIcon} />
              <input
                ref={mobileInputRef}
                type="text"
                data-virtual-keyboard="true"
                className={styles.mobileSearchInput}
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
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
      </header>
    </>
  )
}

export default Header
