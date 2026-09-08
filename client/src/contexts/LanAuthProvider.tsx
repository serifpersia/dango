import React, { useState, useEffect, useCallback } from 'react'
import { LanAuthContext } from './LanAuthContext'
import { subscribeAuthRequired } from '../lib/auth-bus'

export const LanAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false)

  const openModal = useCallback(() => setIsOpen(true), [])
  const closeModal = useCallback(() => setIsOpen(false), [])

  useEffect(() => subscribeAuthRequired('lan', openModal), [openModal])

  return (
    <LanAuthContext.Provider value={{ isOpen, openModal, closeModal }}>
      {children}
    </LanAuthContext.Provider>
  )
}
