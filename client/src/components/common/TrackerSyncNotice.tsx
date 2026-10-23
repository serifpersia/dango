import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import styles from './TrackerSyncNotice.module.css'

const NOTICE_DURATION = 2600
const NOTICE_COOLDOWN = 10000

type Provider = 'anilist' | 'mal'
const LABELS: Record<Provider, string> = {
  anilist: 'Updating AniList…',
  mal: 'Updating MyAnimeList…',
}

export default function TrackerSyncNotice({ enabled = true }: { enabled?: boolean }) {
  const [visible, setVisible] = useState(false)
  const [provider, setProvider] = useState<Provider>('mal')
  const [fullscreen, setFullscreen] = useState<Element | null>(document.fullscreenElement)

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return
    const events = new EventSource('/api/tracker/activity')
    const idle = new Map<Provider, ReturnType<typeof setTimeout>>()
    let hide: ReturnType<typeof setTimeout> | undefined
    const active = new Set<Provider>()
    let lastShown = -Infinity
    const updated = (event: MessageEvent<string>) => {
      let payload: { provider?: unknown; updating?: unknown }
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }
      const name = payload.provider
      if (name !== 'anilist' && name !== 'mal') return
      if (payload.updating === true) {
        clearTimeout(idle.get(name))
        if (active.size === 0 && Date.now() - lastShown >= NOTICE_COOLDOWN) {
          lastShown = Date.now()
          setProvider(name)
          setVisible(true)
          clearTimeout(hide)
          hide = setTimeout(() => setVisible(false), NOTICE_DURATION)
        }
        active.add(name)
      } else if (payload.updating === false) {
        // Treat sequential writes in one list sync as a single quiet notification.
        clearTimeout(idle.get(name))
        idle.set(
          name,
          setTimeout(() => active.delete(name), 1500)
        )
      }
    }
    events.addEventListener('tracker-activity', updated as EventListener)
    return () => {
      events.removeEventListener('tracker-activity', updated as EventListener)
      events.close()
      clearTimeout(hide)
      for (const timer of idle.values()) clearTimeout(timer)
      setVisible(false)
    }
  }, [enabled])

  if (!enabled || !visible) return null
  return createPortal(
    <div className={styles.notice} role="status" aria-live="polite" aria-atomic="true">
      <Icon name={provider === 'anilist' ? 'anilist' : 'myanimelist'} size={15} />
      <span>{LABELS[provider]}</span>
    </div>,
    fullscreen || document.body
  )
}
