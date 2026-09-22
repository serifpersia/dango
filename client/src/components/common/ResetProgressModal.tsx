import React from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

interface ResetProgressModalProps {
  isOpen: boolean
  itemName?: string
  progressKind: 'watch' | 'reading' | 'listening'
  listLabel: string
  alsoRemove: boolean
  onAlsoRemoveChange: (value: boolean) => void
  onClose: () => void
  onConfirm: () => void
}

const ResetProgressModal: React.FC<ResetProgressModalProps> = ({
  isOpen,
  itemName,
  progressKind,
  listLabel,
  alsoRemove,
  onAlsoRemoveChange,
  onClose,
  onConfirm,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Reset Progress">
      <Modal.Body>
        <p>
          Are you sure you want to remove your {progressKind} progress for &quot;{itemName}&quot;?
        </p>
        <label>
          <input
            type="checkbox"
            checked={alsoRemove}
            onChange={(e) => onAlsoRemoveChange(e.target.checked)}
          />
          Also remove from {listLabel}
        </label>
      </Modal.Body>
      <Modal.Actions>
        <Button variant="secondary" onClick={onClose}>
          No
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Yes
        </Button>
      </Modal.Actions>
    </Modal>
  )
}

export default ResetProgressModal
