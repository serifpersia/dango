import { useEffect, useRef, useState, Suspense, lazy } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router'
import toast from 'react-hot-toast'
import Header from './components/layout/Header'
import Sidebar from './components/layout/Sidebar'
import Footer from './components/layout/Footer'
import { useDiscordPageStatus } from './hooks/useDiscordRPC'
import { useLocalStorage } from './hooks/useLocalStorage'
import { useVirtualKeyboard } from './hooks/useVirtualKeyboard'
import { useAnimePaheCookie } from './hooks/useAnimePaheCookie'
import AnimePaheCookieModal from './components/anime/AnimePaheCookieModal'
const Home = lazy(() => import('./pages/Home'))
const Watchlist = lazy(() => import('./pages/Watchlist'))
const Settings = lazy(() => import('./pages/Settings'))
const Player = lazy(() => import('./pages/Player'))
const Search = lazy(() => import('./pages/Search'))
const Mature = lazy(() => import('./pages/Mature'))
const Asmr = lazy(() => import('./pages/Asmr'))
const Manga = lazy(() => import('./pages/Manga'))
const MangaInfoPage = lazy(() => import('./pages/MangaInfoPage'))
const MangaReadPage = lazy(() => import('./pages/MangaReadPage'))
const ReadingList = lazy(() => import('./pages/ReadingList'))
const Radio = lazy(() => import('./pages/Radio'))
const Music = lazy(() => import('./pages/Music'))
const TvSearch = lazy(() => import('./pages/TvSearch'))
const TvInfo = lazy(() => import('./pages/TvInfo'))
const Tv = lazy(() => import('./pages/Tv'))
const TvWatchlist = lazy(() => import('./pages/TvWatchlist'))
const ListeningList = lazy(() => import('./pages/ListeningList'))
const Trackers = lazy(() => import('./pages/Trackers'))
const Insights = lazy(() => import('./pages/Insights'))
const AnimeInfoPage = lazy(() => import('./pages/AnimeInfoPage'))
const PlayerRedirect = lazy(() => import('./pages/PlayerRedirect'))
const VirtualKeyboard = lazy(() => import('./components/common/VirtualKeyboard'))

import { useSidebar } from './hooks/useSidebar'
import { Toaster } from 'react-hot-toast'
import TopProgressBar from './components/common/TopProgressBar'
import ErrorBoundary from './components/common/ErrorBoundary'
import { LanAuthProvider } from './contexts/LanAuthProvider'
import { useLanAuth } from './hooks/useLanAuth'
import LanAuthModal from './components/modals/LanAuthModal'

function App() {
  const { isOpen: animePaheOpen, closeModal: closeAnimePaheModal, onSuccess } = useAnimePaheCookie()
  const { isOpen: sidebarOpen, setIsOpen } = useSidebar()
  const {
    isOpen: lanAuthOpen,
    openModal: openLanAuthModal,
    closeModal: closeLanAuthModal,
  } = useLanAuth()
  const location = useLocation()
  const navigationType = useNavigationType()
  const scrollPositions = useRef(new Map<string, number>())
  const prevPathname = useRef(location.pathname)
  const virtualKeyboard = useVirtualKeyboard()
  useDiscordPageStatus()

  const [lanLocked, setLanLocked] = useState(false)

  useEffect(() => {
    fetch('/api/auth/app-status')
      .then((res) => res.json())
      .then((data) => {
        if (data.hasPassword && !data.isAuthenticated) {
          setLanLocked(true)
          openLanAuthModal()
        }
      })
      .catch(() => {})
  }, [openLanAuthModal])

  const [lanNoticeShown, setLanNoticeShown] = useLocalStorage<string>(
    'lan_auth_notice_shown',
    'false'
  )
  const lanNoticeScheduled = useRef(false)

  useEffect(() => {
    if (lanNoticeShown === 'true' || lanNoticeScheduled.current) return
    lanNoticeScheduled.current = true
    setLanNoticeShown('true')
    const timer = setTimeout(() => {
      toast(
        'Optional LAN lock is available. Set a password in Settings to protect access from other devices on your network.',
        { duration: 10000, icon: '🔒' }
      )
    }, 3000)
    return () => clearTimeout(timer)
  }, [lanNoticeShown, setLanNoticeShown])

  useEffect(() => {
    try {
      window.history.scrollRestoration = 'manual'
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    const key = location.key
    const positions = scrollPositions.current
    if (navigationType === 'POP') {
      const y = positions.get(key) ?? 0
      window.scrollTo({ top: y, behavior: 'instant' })
    } else if (location.pathname !== prevPathname.current) {
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
    prevPathname.current = location.pathname
    return () => {
      positions.set(key, window.scrollY)
    }
  }, [location.key, location.pathname, navigationType])

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
      <AnimePaheCookieModal
        isOpen={animePaheOpen}
        onClose={closeAnimePaheModal}
        onSuccess={onSuccess}
      />
      <LanAuthModal
        isOpen={lanAuthOpen}
        onClose={lanLocked ? () => {} : closeLanAuthModal}
        onSuccess={() => {
          setLanLocked(false)
          closeLanAuthModal()
        }}
      />
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
              color: 'var(--accent-text)',
            },
            iconTheme: {
              primary: 'var(--accent-text)',
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
              <Route path="/reading-list/:filter?" element={<ReadingList />} />
              <Route path="/search" element={<Search />} />
              <Route path="/mature" element={<Mature />} />
              <Route path="/asmr" element={<Asmr />} />
              <Route path="/asmr/:rj" element={<Asmr />} />
              <Route path="/manga" element={<Manga />} />
              <Route path="/manga/:provider/:id" element={<MangaInfoPage />} />
              <Route path="/manga/:provider/:id/read" element={<MangaReadPage />} />
              <Route path="/radio" element={<Radio />} />
              <Route path="/music" element={<Music />} />
              <Route path="/tv" element={<TvSearch />} />
              <Route path="/tv/:id" element={<TvInfo />} />
              <Route path="/tv/:id/watch" element={<Tv />} />
              <Route path="/tv-search" element={<TvSearch />} />
              <Route path="/tv-watchlist/:filter?" element={<TvWatchlist />} />
              <Route path="/listening-list/:filter?" element={<ListeningList />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/trackers" element={<Trackers />} />
              <Route path="/mal" element={<Navigate to="/trackers" replace />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/anime/:id" element={<AnimeInfoPage />} />
              <Route path="/watch/:id" element={<Player />} />
              <Route path="/watch/:id/:episodeNumber" element={<Player />} />
              <Route path="/player/:id/:episodeNumber?" element={<PlayerRedirect />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      <Footer />
      {virtualKeyboard.isVisible && (
        <Suspense fallback={null}>
          <VirtualKeyboard
            activeInputRef={virtualKeyboard.activeInputRef}
            isVisible={virtualKeyboard.isVisible}
            onClose={virtualKeyboard.hide}
          />
        </Suspense>
      )}
    </div>
  )
}

export default function AppWithProviders() {
  return (
    <LanAuthProvider>
      <App />
    </LanAuthProvider>
  )
}
