import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  FaSpinner,
  FaSyncAlt,
  FaCheckCircle,
  FaInfoCircle,
  FaExclamationCircle,
  FaPlus,
  FaTimes,
} from 'react-icons/fa'
import NotificationItem from './NotificationItem'
import {
  useNotifications,
  useDiscoveryStatus,
  useClearAllNotifications,
  useSystemNotifications,
} from '../../hooks/useAnimeData'
import { useQueryClient } from '@tanstack/react-query'
import styles from './Notification.module.css'

const NotificationDropdown: React.FC = () => {
  const { data: notifications = [], isLoading } = useNotifications()
  const { data: systemNotifications = [] } = useSystemNotifications()
  const { data: status } = useDiscoveryStatus()
  const clearAllMutation = useClearAllNotifications()
  const queryClient = useQueryClient()
  const [fullMessageId, setFullMessageId] = useState<string | null>(null)

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }, [queryClient])

  const handleClearAll = () => {
    clearAllMutation.mutate(undefined)
  }

  const fullNotification = systemNotifications.find((sn) => sn.id === fullMessageId) ?? null

  return (
    <div className={styles.dropdown}>
      <div className={styles.dropdownHeader}>
        <h4>Notifications</h4>
        {notifications.length > 0 && (
          <button className={styles.clearAllBtn} onClick={handleClearAll}>
            Clear All
          </button>
        )}
      </div>
      <div className={styles.discoveryStatusRow}>
        {status?.running ? (
          <>
            <FaSpinner className={styles.spinIcon} />
            <span>
              {status.total > 0
                ? `Checking ${Math.min(status.done, status.total)}/${status.total} shows...`
                : 'Checking for new episodes...'}
            </span>
          </>
        ) : status?.state === 'complete' ? (
          <>
            <FaCheckCircle size={12} />
            <span>
              Discovery complete — checked {status.total} {status.total === 1 ? 'show' : 'shows'}
            </span>
          </>
        ) : status?.state === 'empty' ? (
          <>
            <FaInfoCircle size={12} />
            <span>No shows set to Watching — nothing to check</span>
          </>
        ) : status?.state === 'error' ? (
          <>
            <FaExclamationCircle size={12} />
            <span>Last check failed — will retry automatically</span>
          </>
        ) : (
          <>
            <FaSyncAlt size={11} />
            <span>
              {status?.lastRunAt
                ? `Last checked ${Math.max(
                    1,
                    Math.round((Date.now() - status.lastRunAt) / 1000)
                  )}s ago`
                : 'Auto-checks every few minutes'}
            </span>
          </>
        )}
      </div>
      <div className={styles.list}>
        {isLoading && systemNotifications.length === 0 ? (
          <div className={styles.emptyState}>Loading...</div>
        ) : (
          <>
            {systemNotifications.map((sn) => (
              <div key={sn.id} className={styles.item}>
                <div
                  className={styles.thumbnail}
                  style={{
                    background: 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 0,
                    boxShadow: 'none',
                  }}
                >
                  <FaInfoCircle size={32} color="#6c9fff" />
                </div>
                <div className={styles.itemInfo}>
                  <span className={styles.itemTitle}>{sn.title}</span>
                  <button
                    type="button"
                    className={styles.systemItemMeta}
                    onClick={() => setFullMessageId(sn.id)}
                    title="View full status"
                  >
                    {sn.message.length > 40 ? sn.message.slice(0, 40) + '…' : sn.message}
                  </button>
                </div>
                <button
                  className={styles.removeItem}
                  disabled
                  style={{ opacity: 0.3, cursor: 'not-allowed' }}
                  aria-hidden="true"
                >
                  <FaPlus />
                </button>
                <button
                  className={styles.removeItem}
                  disabled
                  style={{ opacity: 0.3, cursor: 'not-allowed' }}
                  aria-hidden="true"
                >
                  <FaTimes />
                </button>
              </div>
            ))}
            {systemNotifications.length > 0 && notifications.length > 0 && (
              <div className={styles.notificationDivider} />
            )}
            {notifications.length > 0
              ? notifications.map((notification) => (
                  <NotificationItem key={notification.id} notification={notification} />
                ))
              : !isLoading &&
                systemNotifications.length === 0 && (
                  <div className={styles.emptyState}>No new notifications</div>
                )}
          </>
        )}
      </div>

      {fullNotification &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: '1rem',
              backdropFilter: 'blur(3px)',
            }}
            onClick={() => setFullMessageId(null)}
          >
            <div
              style={{
                backgroundColor: 'var(--bg-secondary)',
                padding: '1.5rem',
                borderRadius: 'var(--radius-lg)',
                maxWidth: '420px',
                width: '100%',
                boxShadow: 'var(--shadow-xl)',
                border: '1px solid var(--border-primary)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  marginBottom: '1rem',
                }}
              >
                <FaInfoCircle color="#6c9fff" />
                <span style={{ color: '#fff', fontWeight: 600, fontSize: '1rem' }}>
                  {fullNotification.title}
                </span>
              </div>
              <p
                style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: 1.5 }}
              >
                {fullNotification.message}
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setFullMessageId(null)}
                  style={{
                    background: 'var(--primary-color)',
                    color: '#fff',
                    border: 'none',
                    padding: '0.5rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  OK
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

export default NotificationDropdown
