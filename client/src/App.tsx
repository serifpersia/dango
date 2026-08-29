import { useEffect, useRef, Suspense, lazy } from 'react'
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router'
import Header from './components/layout/Header'
import Sidebar from './components/layout/Sidebar'
import Footer from './components/layout/Footer'
import { useTelemetry } from './hooks/useTelemetry'
import { useSetting } from './hooks/useSettings'
import VirtualKeyboard from './components/common/VirtualKeyboard'
import { useVirtualKeyboard } from './hooks/useVirtualKeyboard'
import { useAnimePaheCookie } from './hooks/useAnimePaheCookie'
import AnimePaheCookieModal from './components/anime/AnimePaheCookieModal'

function useDiscordPageStatus() {
  const location = useLocation()
  const { data: discordEnabled } = useSetting('discordRPCEnabled')
  const sessionIdRef = useRef<string>('')
  if (!sessionIdRef.current) {
    sessionIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  useEffect(() => {
    if (discordEnabled === false || discordEnabled === 'false') return

    const sessionId = sessionIdRef.current
    const heartbeat = () =>
      fetch('/api/discord/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).catch(() => {})

    heartbeat()
    const interval = setInterval(heartbeat, 15000)

    const handlePageHide = () => {
      navigator.sendBeacon(
        '/api/discord/heartbeat',
        new Blob([JSON.stringify({ sessionId, bye: true })], { type: 'application/json' })
      )
    }
    window.addEventListener('pagehide', handlePageHide)

    return () => {
      clearInterval(interval)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [discordEnabled])

  useEffect(() => {
    if (discordEnabled === false || discordEnabled === 'false') return

    const path = location.pathname

    if (path.startsWith('/watch/') || path.startsWith('/player/')) return

    let page = 'home'
    if (path.startsWith('/search')) page = 'search'
    else if (path.startsWith('/watchlist')) page = 'watchlist'
    else if (path.startsWith('/anime/')) page = 'anime'
    else if (path.startsWith('/insights')) page = 'insights'
    else if (path.startsWith('/settings')) page = 'settings'
    else if (path.startsWith('/map')) page = 'map'
    else if (path.startsWith('/mal')) page = 'mal'
    else if (path.startsWith('/asmr')) page = 'asmr'
    else if (path.startsWith('/tv')) page = 'tv'

    fetch('/api/discord/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page }),
    }).catch(() => {})
  }, [location.pathname, discordEnabled])
}

const Home = lazy(() => import('./pages/Home'))
const Watchlist = lazy(() => import('./pages/Watchlist'))
const Settings = lazy(() => import('./pages/Settings'))
const Player = lazy(() => import('./pages/Player'))
const Search = lazy(() => import('./pages/Search'))
const Asmr = lazy(() => import('./pages/Asmr'))
const Tv = lazy(() => import('./pages/Tv'))
const MAL = lazy(() => import('./pages/MAL'))
const Insights = lazy(() => import('./pages/Insights'))
const UserMap = lazy(() => import('./pages/Map'))
const AnimeInfoPage = lazy(() => import('./pages/AnimeInfoPage'))

import { useSidebar } from './hooks/useSidebar'
import { Toaster } from 'react-hot-toast'
import TopProgressBar from './components/common/TopProgressBar'
import ErrorBoundary from './components/common/ErrorBoundary'

const PlayerRedirect = () => {
  const { id, episodeNumber } = useParams()
  return <Navigate to={episodeNumber ? `/watch/${id}/${episodeNumber}` : `/watch/${id}`} replace />
}

function App() {
  const { isOpen, openModal, closeModal, onSuccess } = useAnimePaheCookie()
  const { isOpen: sidebarOpen, setIsOpen } = useSidebar()
  const location = useLocation()
  const virtualKeyboard = useVirtualKeyboard()
  useTelemetry()
  useDiscordPageStatus()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  useEffect(() => {
    const handleAuthRequired = () => openModal()
    window.addEventListener('ANIMEPAHE_AUTH_REQUIRED', handleAuthRequired)
    return () => window.removeEventListener('ANIMEPAHE_AUTH_REQUIRED', handleAuthRequired)
  }, [openModal])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (sidebarOpen && event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    if (sidebarOpen) {
      document.body.classList.add('sidebar-open')
    } else {
      document.body.classList.remove('sidebar-open')
    }

    window.addEventListener('keydown', handleKeydown)

    return () => {
      window.removeEventListener('keydown', handleKeydown)
      document.body.classList.remove('sidebar-open')
    }
  }, [sidebarOpen, setIsOpen])

  return (
    <div className="app-container">
      <AnimePaheCookieModal isOpen={isOpen} onClose={closeModal} onSuccess={onSuccess} />
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-primary)',
          },
          success: {
            style: {
              background: 'var(--accent)',
              color: '#fff',
            },
            iconTheme: {
              primary: '#fff',
              secondary: 'var(--accent)',
            },
          },
          error: {
            style: {
              background: 'rgba(153, 42, 42, 0.95)',
              color: '#fff',
            },
          },
        }}
      />
      <Header />
      <Sidebar />
      <main className="main-content">
        <ErrorBoundary>
          <Suspense fallback={<TopProgressBar />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/watchlist/:filter?" element={<Watchlist />} />
              <Route path="/search" element={<Search />} />
              <Route path="/asmr" element={<Asmr />} />
              <Route path="/asmr/:rj" element={<Asmr />} />
              <Route path="/tv" element={<Tv />} />
              <Route path="/tv/:id" element={<Tv />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/mal" element={<MAL />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/map" element={<UserMap />} />
              <Route path="/anime/:id" element={<AnimeInfoPage />} />
              <Route path="/watch/:id" element={<Player />} />
              <Route path="/watch/:id/:episodeNumber" element={<Player />} />
              <Route path="/player/:id" element={<PlayerRedirect />} />
              <Route path="/player/:id/:episodeNumber" element={<PlayerRedirect />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      <Footer />
      <VirtualKeyboard
        activeInputRef={virtualKeyboard.activeInputRef}
        isVisible={virtualKeyboard.isVisible}
        onClose={virtualKeyboard.hide}
      />
    </div>
  )
}

export default App
