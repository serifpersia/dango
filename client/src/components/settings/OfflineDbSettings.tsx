import React, { useState, useEffect, useRef } from 'react'
import { Button } from '../common/Button'
import ToggleSwitch from '../common/ToggleSwitch'
import styles from './OfflineDbSettings.module.css'

interface OfflineDbInfo {
  totalMapped: number
  totalMalMapped: number
  isInitialized: boolean
  isRefreshing: boolean
  autoUpdateEnabled: boolean
  lastCheckedAt: string | null
  lastUpdatedAt: string | null
  lastStatus: 'idle' | 'updating' | 'success' | 'failed'
  lastMessage: string | null
  sourceUrl: string | null
  releaseTag: string | null
  contentSha256: string | null
  entryCount: number
  schemaVersion: number
  nextDueAt: string | null
}

export const OfflineDbSettings: React.FC = () => {
  const [info, setInfo] = useState<OfflineDbInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [isUpdatingToggle, setIsUpdatingToggle] = useState(false)
  const [triggerLoading, setTriggerLoading] = useState(false)
  const pollIntervalRef = useRef<number | null>(null)

  const fetchInfo = async () => {
    try {
      const res = await fetch('/api/settings/offline-db')
      if (res.ok) {
        const data: OfflineDbInfo = await res.json()
        setInfo(data)
        return data
      }
    } catch (err) {
      console.error('Failed to fetch offline DB info:', err)
    } finally {
      setLoading(false)
    }
    return null
  }

  useEffect(() => {
    fetchInfo()
    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (info?.isRefreshing) {
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = window.setInterval(async () => {
          const updated = await fetchInfo()
          if (updated && !updated.isRefreshing) {
            if (pollIntervalRef.current) {
              window.clearInterval(pollIntervalRef.current)
              pollIntervalRef.current = null
            }
          }
        }, 2000)
      }
    } else if (pollIntervalRef.current) {
      window.clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }, [info?.isRefreshing])

  const handleToggleAutoUpdate = async () => {
    if (!info || isUpdatingToggle) return
    const nextVal = !info.autoUpdateEnabled
    setIsUpdatingToggle(true)
    setInfo({ ...info, autoUpdateEnabled: nextVal })
    try {
      const res = await fetch('/api/settings/offline-db/auto-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextVal }),
      })
      if (!res.ok) {
        setInfo({ ...info, autoUpdateEnabled: !nextVal })
      }
    } catch (err) {
      console.error('Failed to update auto update setting:', err)
      setInfo({ ...info, autoUpdateEnabled: !nextVal })
    } finally {
      setIsUpdatingToggle(false)
    }
  }

  const handleManualRefresh = async () => {
    if (info?.isRefreshing || triggerLoading) return
    setTriggerLoading(true)
    try {
      const res = await fetch('/api/settings/offline-db/update', { method: 'POST' })
      if (res.ok) {
        setInfo((prev: OfflineDbInfo | null) =>
          prev
            ? {
                ...prev,
                isRefreshing: true,
                lastStatus: 'updating',
                lastMessage: 'Downloading database...',
              }
            : null
        )
      }
    } catch (err) {
      console.error('Failed to trigger offline DB update:', err)
    } finally {
      setTriggerLoading(false)
    }
  }

  const formatDate = (isoString: string | null) => {
    if (!isoString) return 'Never'
    try {
      return new Date(isoString).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    } catch {
      return isoString
    }
  }

  const isRefreshing = info?.isRefreshing || triggerLoading

  return (
    <div className={styles.sectionCard}>
      <h3>Offline Metadata Database</h3>
      <p>
        Local MAL to AniList ID map used for instant imports and metadata enrichment without hitting
        rate-limited APIs. Updates automatically every Saturday in the background.
      </p>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>MAL Mapped</span>
          <span className={styles.statValue}>
            {loading ? '—' : (info?.totalMalMapped ?? 0).toLocaleString()}
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Release</span>
          <span className={styles.statMeta}>{loading ? '—' : (info?.releaseTag ?? 'Never')}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Last Checked</span>
          <span className={styles.statMeta}>
            {loading ? '—' : formatDate(info?.lastCheckedAt ?? null)}
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Last Updated</span>
          <span className={styles.statMeta}>
            {loading ? '—' : formatDate(info?.lastUpdatedAt ?? null)}
          </span>
        </div>
      </div>

      {info?.lastMessage && (
        <div
          className={`${styles.statusBanner} ${
            info.lastStatus === 'failed'
              ? styles.statusError
              : info.lastStatus === 'updating'
                ? styles.statusUpdating
                : styles.statusSuccess
          }`}
        >
          <span>{info.lastMessage}</span>
          {info.contentSha256 && (
            <span className={styles.sha}>sha:{info.contentSha256.slice(0, 12)}</span>
          )}
        </div>
      )}

      <div className={styles.settingItem}>
        <div className={styles.settingRow}>
          <div>
            <span className={styles.settingTitle}>Weekly Automatic Updates (Saturdays)</span>
            <div className={styles.settingSubtitle}>
              Download and index new database releases in the background. Catches up on startup if
              the server was offline.
            </div>
          </div>
          <ToggleSwitch
            id="offline-db-auto-update-toggle"
            isChecked={info ? info.autoUpdateEnabled : true}
            onChange={handleToggleAutoUpdate}
            disabled={loading || isUpdatingToggle}
          />
        </div>
      </div>

      <div className={styles.actionsRow}>
        <Button onClick={handleManualRefresh} disabled={loading || isRefreshing}>
          {isRefreshing ? 'Updating Database...' : 'Update Offline Database Now'}
        </Button>
      </div>
    </div>
  )
}

export default OfflineDbSettings
