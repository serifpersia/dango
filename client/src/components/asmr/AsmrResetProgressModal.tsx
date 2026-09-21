import React, { useState } from 'react'
import { Modal } from '../common/Modal'
import { Button } from '../common/Button'
import { useRemoveAsmrBookmark, useRemoveAsmrProgress } from '../../hooks/useAsmrLibrary'

interface AsmrResetProgressModalProps {
  workId: string | null
  title?: string
  onClose: () => void
}

const AsmrResetProgressModal: React.FC<AsmrResetProgressModalProps> = ({
  workId,
  title,
  onClose,
}) => {
  const [alsoRemoveFromList, setAlsoRemoveFromList] = useState(false)
  const removeProgress = useRemoveAsmrProgress()
  const removeBookmark = useRemoveAsmrBookmark()

  const handleConfirm = () => {
    if (!workId) return
    removeProgress.mutate({ workId })
    if (alsoRemoveFromList) {
      removeBookmark.mutate(workId)
    }
    setAlsoRemoveFromList(false)
    onClose()
  }

  const handleClose = () => {
    setAlsoRemoveFromList(false)
    onClose()
  }

  return (
    <Modal isOpen={!!workId} onClose={handleClose} title="Reset Progress">
      <Modal.Body>
        <p>Are you sure you want to remove your listening progress for &quot;{title}&quot;?</p>
        <label>
          <input
            type="checkbox"
            checked={alsoRemoveFromList}
            onChange={(e) => setAlsoRemoveFromList(e.target.checked)}
          />
          Also remove from my listening list
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

export default AsmrResetProgressModal
