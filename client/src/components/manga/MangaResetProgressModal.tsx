import React, { useState } from 'react'
import { Modal } from '../common/Modal'
import { Button } from '../common/Button'
import { useRemoveMangaBookmark, useRemoveMangaProgress } from '../../hooks/useMangaLibrary'

interface MangaResetProgressModalProps {
  mangaId: string | null
  title?: string
  onClose: () => void
}

const MangaResetProgressModal: React.FC<MangaResetProgressModalProps> = ({
  mangaId,
  title,
  onClose,
}) => {
  const [alsoRemoveFromList, setAlsoRemoveFromList] = useState(false)
  const removeProgress = useRemoveMangaProgress()
  const removeBookmark = useRemoveMangaBookmark()

  const handleConfirm = () => {
    if (!mangaId) return
    removeProgress.mutate({ mangaId })
    if (alsoRemoveFromList) {
      removeBookmark.mutate(mangaId)
    }
    setAlsoRemoveFromList(false)
    onClose()
  }

  const handleClose = () => {
    setAlsoRemoveFromList(false)
    onClose()
  }

  return (
    <Modal isOpen={!!mangaId} onClose={handleClose} title="Reset Progress">
      <Modal.Body>
        <p>Are you sure you want to remove your reading progress for &quot;{title}&quot;?</p>
        <label>
          <input
            type="checkbox"
            checked={alsoRemoveFromList}
            onChange={(e) => setAlsoRemoveFromList(e.target.checked)}
          />
          Also remove from my reading list
        </label>
      </Modal.Body>
      <Modal.Actions>
        <Button variant="secondary" onClick={handleClose}>
          No
        </Button>
        <Button variant="danger" onClick={handleConfirm}>
          Yes
        </Button>
      </Modal.Actions>
    </Modal>
  )
}

export default MangaResetProgressModal
