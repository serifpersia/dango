import React, { useState, useEffect, useRef } from 'react'
import Icon from '../common/Icon'
import { useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '../../lib/trpc'
import NotificationDropdown from './NotificationDropdown'
import {
  useNotifications,
  useDiscoveryStatus,
  useTriggerDiscovery,
  useSystemNotifications,
} from '../../hooks/useAnimeData'
import { qk } from '../../lib/queryKeys'
import styles from './Notification.module.css'

const NOTIFICATION_PANEL_ID = 'notification-panel'

const NotificationBell: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const trpc = useTRPC()
  const triggerDiscovery = useTriggerDiscovery()

  const { data: notifications = [] } = useNotifications()
  const { data: systemNotifications = [] } = useSystemNotifications()
  const { data: discoveryStatus } = useDiscoveryStatus()
  const count = notifications.length + systemNotifications.length

  const displayCount = count > 9 ? '9+' : count

  const wasDiscoveryRunning = useRef(false)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const running = !!discoveryStatus?.running
    if (wasDiscoveryRunning.current && !running) {
      void queryClient.invalidateQueries(trpc.notifications.pathFilter())
      void queryClient.invalidateQueries(trpc.discovery.pathFilter())
      void queryClient.invalidateQueries({ queryKey: [qk.continueWatching] })
      void queryClient.invalidateQueries({ queryKey: [qk.thisWeekSchedule] })
      void queryClient.invalidateQueries(trpc.continueWatching.pathFilter())
      queryClient.invalidateQueries({ queryKey: [qk.notifications] })
    }
    wasDiscoveryRunning.current = running
  }, [discoveryStatus?.running, queryClient, trpc])

  const handleToggle = () => {
    const nextOpen = !isOpen
    setIsOpen(nextOpen)
    if (nextOpen) {
      triggerDiscovery.mutate()
    }
  }

  return (
    <div className={styles.container} ref={bellRef}>
      <button
        className={styles.bellBtn}
        onClick={handleToggle}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={NOTIFICATION_PANEL_ID}
        aria-label="Notifications"
      >
        <Icon name="bell" />
        {count > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {displayCount}
          </span>
        )}
      </button>

      {isOpen && <NotificationDropdown onClose={() => setIsOpen(false)} />}
    </div>
  )
}

export default NotificationBell
