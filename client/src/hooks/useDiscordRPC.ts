import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { useSetting } from './useSettings'
import { trpcClient } from '../lib/trpc'
import { trpcBeacon } from '../lib/trpcBeacon'
import { useContentType } from '../contexts/ContentTypeContext'

export function useDiscordPageStatus() {
  const location = useLocation()
  const { contentType } = useContentType()
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
    const heartbeat = () => trpcClient.discord.heartbeat.mutate({ sessionId }).catch(() => {})

    heartbeat()
    const interval = setInterval(heartbeat, 15000)

    const handlePageHide = () => {
      trpcBeacon('discord.heartbeat', { sessionId, bye: true })
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
    if (path === '/search' || path === '/mature') page = 'search-anime'
    else if (path === '/tv' || path === '/tv-search') page = 'search-tv'
    else if (path === '/manga') page = 'search-manga'
    else if (path === '/asmr') page = 'search-asmr'
    else if (path.startsWith('/watchlist')) page = 'watchlist'
    else if (path.startsWith('/tv-watchlist')) page = 'tv-watchlist'
    else if (path.startsWith('/reading-list')) page = 'reading-list'
    else if (path.startsWith('/listening-list')) page = 'listening-list'
    else if (path.startsWith('/anime/')) page = 'anime'
    else if (path.startsWith('/insights')) page = 'insights'
    else if (path.startsWith('/settings')) page = 'settings'
    else if (path.startsWith('/trackers')) page = 'trackers'
    else if (path.startsWith('/tv/')) page = 'tv'
    else if (path.startsWith('/manga/')) page = 'manga'
    else if (path.startsWith('/asmr/')) page = 'asmr'

    if (path === '/') page = `home-${contentType}`

    trpcClient.discord.pageStatus.mutate({ page, sessionId: sessionIdRef.current }).catch(() => {})
  }, [location.pathname, contentType, discordEnabled])
}
