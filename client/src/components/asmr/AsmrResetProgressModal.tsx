import React, { useState } from 'react'
import ResetProgressModal from '../common/ResetProgressModal'
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
    <ResetProgressModal
      isOpen={!!workId}
      itemName={title}
      progressKind="listening"
      listLabel="my listening list"
      alsoRemove={alsoRemoveFromList}
      onAlsoRemoveChange={setAlsoRemoveFromList}
      onClose={handleClose}
      onConfirm={handleConfirm}
    />
  )
}

export default AsmrResetProgressModal
