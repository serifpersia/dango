import React from 'react'
import { Modal } from './Modal'

interface GenericModalProps {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
  title?: string
}

const GenericModal: React.FC<GenericModalProps> = ({ isOpen, onClose, children, title }) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      {children}
    </Modal>
  )
}

export default GenericModal
