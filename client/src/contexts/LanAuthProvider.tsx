import React, { useState } from 'react'
import { LanAuthContext } from './LanAuthContext'

export const LanAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false)

  const openModal = () => setIsOpen(true)
  const closeModal = () => setIsOpen(false)

  return (
    <LanAuthContext.Provider value={{ isOpen, openModal, closeModal }}>
      {children}
    </LanAuthContext.Provider>
  )
}
