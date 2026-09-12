import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { useSetting } from './useSettings'

export function useDiscordPageStatus() {
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
    else if (path.startsWith('/mature')) page = 'search'
    else if (path.startsWith('/watchlist')) page = 'watchlist'
    else if (path.startsWith('/anime/')) page = 'anime'
    else if (path.startsWith('/insights')) page = 'insights'
    else if (path.startsWith('/settings')) page = 'settings'
    else if (path.startsWith('/map')) page = 'map'
    else if (path.startsWith('/trackers')) page = 'trackers'
    else if (path.startsWith('/asmr')) page = 'asmr'
    else if (path.startsWith('/manga')) page = 'manga'
    else if (path.startsWith('/radio')) page = 'radio'
    else if (path.startsWith('/tv')) page = 'tv'

    fetch('/api/discord/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page }),
    }).catch(() => {})
  }, [location.pathname, discordEnabled])
}
