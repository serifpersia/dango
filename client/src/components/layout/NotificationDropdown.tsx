import React, { useEffect, useRef, useState } from 'react'
import Icon from '../common/Icon'
import Modal from '../common/Modal'
import NotificationItem from './NotificationItem'
import NotificationSkeleton from './NotificationSkeleton'
import {
  useNotifications,
  useDiscoveryStatus,
  useClearAllNotifications,
  useSystemNotifications,
} from '../../hooks/useAnimeData'
import { useQueryClient } from '@tanstack/react-query'
import styles from './Notification.module.css'
import { qk } from '../../lib/queryKeys'
import { truncate } from '../../lib/utils'

interface NotificationDropdownProps {
  onClose: () => void
}

const NotificationDropdown: React.FC<NotificationDropdownProps> = ({ onClose }) => {
  const { data: notifications = [], isLoading } = useNotifications()
  const { data: systemNotifications = [] } = useSystemNotifications()
  const { data: status } = useDiscoveryStatus()
  const clearAllMutation = useClearAllNotifications()
  const queryClient = useQueryClient()
  const [fullMessageId, setFullMessageId] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dropdownRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: [qk.notifications] })
  }, [queryClient])

  const fullNotification = systemNotifications.find((sn) => sn.id === fullMessageId) ?? null
  const updateCount = notifications.length + systemNotifications.length
  const statusMessage = status?.running
    ? status.total > 0
      ? `Checking ${Math.min(status.done, status.total)}/${status.total} shows...`
      : 'Checking for new episodes...'
    : status?.state === 'complete'
      ? `Discovery complete · checked ${status.total} ${status.total === 1 ? 'show' : 'shows'}`
      : status?.state === 'empty'
        ? 'No shows set to Watching'
        : status?.state === 'error'
          ? 'Last check failed · will retry automatically'
          : status?.lastRunAt
            ? `Last checked ${Math.max(1, Math.round((Date.now() - status.lastRunAt) / 1000))}s ago`
            : 'Auto-checks every few minutes'

  return (
    <div
      id="notification-panel"
      ref={dropdownRef}
      className={styles.dropdown}
      role="dialog"
      aria-label="Notifications"
      tabIndex={-1}
    >
      <div className={styles.dropdownHeader}>
        <div>
          <h4>Notifications</h4>
          <span className={styles.headerSubtitle}>{updateCount} updates</span>
        </div>
        <div className={styles.headerActions}>
          {notifications.length > 0 && (
            <button
              className={styles.clearAllBtn}
              onClick={() => clearAllMutation.mutate(undefined)}
            >
              Clear all
            </button>
          )}
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close notifications"
          >
            <Icon name="times" />
          </button>
        </div>
      </div>

      <div className={styles.discoveryStatusRow}>
        <span
          className={`${styles.statusDot} ${status?.running ? styles.statusDotRunning : status?.state === 'complete' ? styles.statusDotOk : status?.state === 'error' ? styles.statusDotError : styles.statusDotIdle}`}
          aria-hidden="true"
        />
        <span>{statusMessage}</span>
      </div>

      <div className={styles.list}>
        {isLoading && updateCount === 0 ? (
          <NotificationSkeleton count={4} />
        ) : (
          <>
            {systemNotifications.length > 0 && (
              <section aria-labelledby="system-notifications-heading">
                <h5 id="system-notifications-heading" className={styles.sectionHeading}>
                  App updates
                </h5>
                {systemNotifications.map((notification) => (
                  <div key={notification.id} className={`${styles.item} ${styles.systemItem}`}>
                    <div className={styles.systemIcon}>
                      <Icon name="info-circle" size={20} />
                    </div>
                    <div className={styles.itemInfo}>
                      <span className={styles.itemTitle}>{notification.title}</span>
                      <button
                        type="button"
                        className={styles.systemItemMeta}
                        onClick={() => setFullMessageId(notification.id)}
                        title="View full message"
                      >
                        {truncate(notification.message, 72, '…')} <span>Read more</span>
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {notifications.length > 0 && (
              <section aria-labelledby="new-episodes-heading">
                <h5 id="new-episodes-heading" className={styles.sectionHeading}>
                  New episodes
                </h5>
                {notifications.map((notification) => (
                  <NotificationItem key={notification.id} notification={notification} />
                ))}
              </section>
            )}

            {!isLoading && updateCount === 0 && (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}>
                  <Icon name="bell" size={22} />
                </span>
                <strong>You’re all caught up</strong>
                <span>New episode alerts and app updates will show up here.</span>
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        isOpen={!!fullNotification}
        onClose={() => setFullMessageId(null)}
        title={fullNotification?.title}
        width="sm"
        footer={
          <button
            type="button"
            className={styles.modalButton}
            onClick={() => setFullMessageId(null)}
          >
            OK
          </button>
        }
      >
        {fullNotification && <p className={styles.fullMessage}>{fullNotification.message}</p>}
      </Modal>
    </div>
  )
}

export default NotificationDropdown
