import React, { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../common/Button'
import { Modal } from '../common/Modal'
import styles from './ClearDatabaseSettings.module.css'

const ClearDatabaseSettings: React.FC = () => {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')

  const openModal = () => {
    setAcknowledged(false)
    setStatusMessage('')
    setShowModal(true)
  }

  const closeModal = () => {
    if (isClearing) return
    setShowModal(false)
    setAcknowledged(false)
  }

  const handleClear = async () => {
    if (!acknowledged || isClearing) return
    setIsClearing(true)
    setStatusMessage('')
    try {
      const res = await fetch('/api/database/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to clear database')
      const deleted = data.deleted as Record<string, number>
      const deletedManga = data.deletedManga as Record<string, number> | undefined
      const total =
        Object.values(deleted).reduce((sum, n) => sum + (n || 0), 0) +
        Object.values(deletedManga ?? {}).reduce((sum, n) => sum + (n || 0), 0)
      const mangaCount = (deletedManga?.manga_library ?? 0) + (deletedManga?.manga_progress ?? 0)
      setStatusMessage(
        `Library cleared — ${deleted.watchlist ?? 0} watchlist entries, ${mangaCount} manga rows and ${total} total rows removed.`
      )
      queryClient.invalidateQueries({ queryKey: ['watchlist'] })
      queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
      queryClient.invalidateQueries({ queryKey: ['manga-library'] })
      queryClient.invalidateQueries({ queryKey: ['manga-library-ids'] })
      queryClient.invalidateQueries({ queryKey: ['manga-continue-reading'] })
      setShowModal(false)
    } catch (err) {
      setStatusMessage((err as Error).message)
    } finally {
      setIsClearing(false)
      setAcknowledged(false)
    }
  }

  return (
    <div className={`${styles.sectionCard} ${styles.dangerCard}`}>
      <h3>Danger Zone</h3>
      <p>
        Permanently delete your library (watchlist, watched episodes, queue, cached show metadata,
        manga reading list and reading progress) to start fresh. Your settings, sync state and the
        offline metadata cache are preserved.
      </p>
      <Button variant="danger" onClick={openModal}>
        Clear Library Data
      </Button>
      {statusMessage && <p className={styles.status}>{statusMessage}</p>}

      <Modal isOpen={showModal} onClose={closeModal} title="Clear library data?" width="sm">
        <Modal.Body>
          <p className={styles.warningText}>
            This permanently deletes everything in your library. It acts on the active database (dev
            or prod, per server config) and cannot be undone. Settings, sync state and the offline
            metadata cache are kept.
          </p>
          <label className={styles.ackLabel}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              disabled={isClearing}
            />
            <span>I understand this permanently deletes my library</span>
          </label>
        </Modal.Body>
        <Modal.Actions>
          <Button variant="secondary" onClick={closeModal} disabled={isClearing}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleClear} disabled={!acknowledged || isClearing}>
            {isClearing ? 'Clearing...' : 'Yes, delete everything'}
          </Button>
        </Modal.Actions>
      </Modal>
    </div>
  )
}

export default ClearDatabaseSettings
