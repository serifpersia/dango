import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate, useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import Icon from '../common/Icon'
import FadeImage from '../common/FadeImage'
import NotificationBell from './NotificationBell'
import Logo from '../common/Logo'
import { useSidebar } from '../../contexts/SidebarContext'
import { useContentType } from '../../contexts/ContentTypeContext'
import { hideVirtualKeyboard } from '../../hooks/useVirtualKeyboard'
import { profileQuery } from '../../hooks/useProfile'
import ProfileAvatar from '../common/ProfileAvatar'
import { useTRPC, trpcClient } from '../../lib/trpc'
import { qk } from '../../lib/queryKeys'
import { fixThumbnailUrl } from '../../lib/utils'
import { tvDetailPath } from '../../lib/tv'
import { mangaCoverSrc } from '../../hooks/useManga'
import { asmrWorkId } from '../../lib/asmr'
import type { MangaBrowseResult } from '../../hooks/useManga'
import type { AsmrBrowseResult } from '../../hooks/useAsmr'
import { useTitlePreference } from '../../contexts/TitlePreferenceContext'
import styles from './Header.module.css'

const STALE_5_MIN = 5 * 60 * 1000

const Header: React.FC = () => {
  const { toggleSidebar } = useSidebar()
  const { contentType } = useContentType()
  const trpc = useTRPC()
  const { titlePreference } = useTitlePreference()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [visible, setVisible] = useState(true)
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [isAtTop, setIsAtTop] = useState(true)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const autoHideTimer = useRef<number | null>(null)
  const scrollTicking = useRef(false)
  const scrollRaf = useRef<number | null>(null)
  const mobileSearchRef = useRef<HTMLDivElement>(null)
  const mobileInputRef = useRef<HTMLInputElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const overHeader = useRef(false)
  const debounceTimer = useRef<number | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { data: user } = useQuery(profileQuery)

  const instantEnabled = debouncedQuery.length >= 2

  const { data: instantResults } = useQuery({
    ...trpc.data.search.queryOptions({ query: debouncedQuery, page: 1, limit: 6 }),
    enabled: instantEnabled && contentType === 'anime',
  })
  const { data: tvResults } = useQuery({
    ...trpc.tv.search.queryOptions({ q: debouncedQuery, page: 1, type: 'multi' }),
    enabled: instantEnabled && contentType === 'tv',
  })
  const { data: mangaResults } = useQuery({
    queryFn: () =>
      trpcClient.manga.search.query({
        q: debouncedQuery,
        page: 1,
        limit: 6,
        rating: 'safe',
      }) as Promise<MangaBrowseResult>,
    queryKey: [qk.mangaBrowse, '', debouncedQuery, 1, '', '', '', 'safe', false],
    staleTime: STALE_5_MIN,
    enabled: instantEnabled && contentType === 'manga',
  })
  const { data: asmrResults } = useQuery({
    queryFn: () =>
      trpcClient.asmr.browse.query({ q: debouncedQuery, page: 1 }) as Promise<AsmrBrowseResult>,
    queryKey: [qk.asmrBrowse, debouncedQuery, 1, '', ''],
    staleTime: STALE_5_MIN,
    enabled: instantEnabled && contentType === 'asmr',
  })

  interface InstantItem {
    key: string
    name: string
    meta?: string
    thumb?: string
    href: string
  }
  const instantItems: InstantItem[] =
    contentType === 'anime'
      ? (instantResults ?? []).map((item) => ({
          key: String(item.id),
          name:
            titlePreference === 'nativeName'
              ? item.nativeName || item.name
              : titlePreference === 'englishName'
                ? item.englishName || item.name
                : item.name,
          meta: item.year,
          thumb: item.thumbnail ? fixThumbnailUrl(item.thumbnail, 48, 64) : undefined,
          href: `/anime/${item.id}`,
        }))
      : contentType === 'tv'
        ? (tvResults?.results ?? []).map((item) => ({
            key: `${item.type}-${item.id}`,
            name: item.title,
            meta: item.year,
            thumb: item.image || undefined,
            href: tvDetailPath(item.type, item.id),
          }))
        : contentType === 'manga'
          ? (mangaResults?.items ?? []).map((item) => ({
              key: `${item.provider}-${item.id}`,
              name: item.title,
              meta: item.year,
              thumb: item.cover ? mangaCoverSrc(item.provider, item.cover) : undefined,
              href: `/manga/${item.provider}/${encodeURIComponent(item.id)}`,
            }))
          : (asmrResults?.shows ?? []).map((item) => ({
              key: asmrWorkId(item),
              name: item.name,
              thumb: item.thumbnail || undefined,
              href: `/asmr/${encodeURIComponent(asmrWorkId(item))}`,
            }))

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
      if (window.scrollY <= 10 || isSearchFocused) return
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
      const target = e.target
      const typing =
        target instanceof HTMLElement &&
        !!target.closest(
          'input, textarea, select, button, a, [role="button"], [contenteditable="true"]'
        )
      const focusSearch = () => {
        clearTimer()
        setVisible(true)
        if (window.innerWidth <= 1024) {
          setMobileSearchOpen(true)
          setTimeout(() => mobileInputRef.current?.focus({ preventScroll: true }), 50)
        } else {
          setTimeout(() => searchInputRef.current?.focus({ preventScroll: true }), 10)
        }
      }
      if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing) {
        e.preventDefault()
        focusSearch()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        focusSearch()
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

  useEffect(() => {
    if (debounceTimer.current) window.clearTimeout(debounceTimer.current)
    if (!query.trim() || query.trim().length < 2) {
      setDebouncedQuery('')
      setDropdownOpen(false)
      return
    }
    debounceTimer.current = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      if (isSearchFocused) setDropdownOpen(true)
    }, 500)
    return () => {
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current)
    }
  }, [query, isSearchFocused])

  const closeDropdown = useCallback(() => {
    setDropdownOpen(false)
  }, [])

  useEffect(() => {
    setDropdownOpen(false)
    setMobileSearchOpen(false)
  }, [location.pathname, location.search])

  const isMobile = () => window.innerWidth <= 1024

  const handleSearchButtonClick = () => {
    setVisible(true)
    if (isMobile()) {
      setMobileSearchOpen(true)
      setTimeout(() => mobileInputRef.current?.focus({ preventScroll: true }), 50)
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
    closeDropdown()
    searchInputRef.current?.blur()
    setIsSearchFocused(false)
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
            <div
              className={styles.searchWrapper}
              ref={dropdownRef}
              onClick={() => searchInputRef.current?.focus()}
            >
              <button
                type="button"
                className={styles.searchIconButton}
                aria-label="Search"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation()
                  handleSearch()
                }}
              >
                <Icon name="search" className={styles.searchIcon} />
              </button>
              <input
                ref={searchInputRef}
                type="text"
                data-virtual-keyboard="true"
                className={styles.searchInput}
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                onFocus={() => {
                  setIsSearchFocused(true)
                  setVisible(true)
                  if (debouncedQuery.length >= 2) setDropdownOpen(true)
                }}
                onBlur={(e) => {
                  setIsSearchFocused(false)
                  if (!dropdownRef.current?.contains(e.relatedTarget as Node)) {
                    closeDropdown()
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearch()
                  } else if (e.key === 'Escape') {
                    closeDropdown()
                    searchInputRef.current?.blur()
                  }
                }}
              />
              <span
                className={`${styles.searchKbd} ${query || isSearchFocused ? styles.searchKbdHidden : ''}`}
                aria-hidden="true"
              >
                Ctrl K
              </span>
              <button
                type="button"
                className={styles.searchButton}
                aria-label="Search"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation()
                  handleSearchButtonClick()
                }}
              >
                <Icon name="search" className={styles.searchIconMobile} />
              </button>

              {dropdownOpen && instantItems.length > 0 && (
                <div
                  className={`${styles.searchDropdown} ${mobileSearchOpen ? '' : styles.searchDropdownNoBar}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className={styles.searchDropdownHeader}>
                    <span className={styles.searchDropdownQuery}>
                      Results for &ldquo;{debouncedQuery}&rdquo;
                    </span>
                    <button
                      className={styles.searchDropdownSeeAll}
                      onClick={() => {
                        closeDropdown()
                        setMobileSearchOpen(false)
                        setIsSearchFocused(false)
                        handleSearch()
                      }}
                    >
                      See all
                    </button>
                  </div>
                  <div className={styles.searchDropdownList}>
                    {instantItems.map((item) => (
                      <button
                        key={item.key}
                        className={styles.searchDropdownItem}
                        onClick={() => {
                          closeDropdown()
                          setMobileSearchOpen(false)
                          setIsSearchFocused(false)
                          setQuery('')
                          searchInputRef.current?.blur()
                          navigate(item.href)
                        }}
                      >
                        {item.thumb && (
                          <FadeImage
                            src={item.thumb}
                            alt={item.name}
                            className={styles.searchDropdownThumb}
                            loading="lazy"
                            decoding="async"
                          />
                        )}
                        <div className={styles.searchDropdownItemInfo}>
                          <span className={styles.searchDropdownItemTitle}>{item.name}</span>
                          {item.meta && (
                            <span className={styles.searchDropdownItemMeta}>{item.meta}</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
                onFocus={() => {
                  setIsSearchFocused(true)
                  setVisible(true)
                }}
                onBlur={() => setIsSearchFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearch()
                    setMobileSearchOpen(false)
                    setIsSearchFocused(false)
                  } else if (e.key === 'Escape') {
                    setMobileSearchOpen(false)
                    setIsSearchFocused(false)
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
