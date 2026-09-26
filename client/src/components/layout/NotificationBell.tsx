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
import styles from './Notification.module.css'

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

  const displayCount = count > 5 ? '5+' : count

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
      <button className={styles.bellBtn} onClick={handleToggle} aria-label="Notifications">
        <Icon name="bell" />
        {count > 0 && <span className={styles.badge}>{displayCount}</span>}
      </button>

      {isOpen && <NotificationDropdown />}
    </div>
  )
}

export default NotificationBell
