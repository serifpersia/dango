import React, { useState } from 'react'
import ResetProgressModal from '../common/ResetProgressModal'
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
    <ResetProgressModal
      isOpen={!!mangaId}
      itemName={title}
      progressKind="reading"
      listLabel="my reading list"
      alsoRemove={alsoRemoveFromList}
      onAlsoRemoveChange={setAlsoRemoveFromList}
      onClose={handleClose}
      onConfirm={handleConfirm}
    />
  )
}

export default MangaResetProgressModal
