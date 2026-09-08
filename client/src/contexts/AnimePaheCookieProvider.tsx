import React, { useState, useEffect, useCallback } from 'react'
import { AnimePaheCookieContext } from './AnimePaheCookieContext'
import { subscribeAuthRequired } from '../lib/auth-bus'

export const AnimePaheCookieProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [onSuccess, setOnSuccess] = useState<(() => void) | undefined>(undefined)

  const openModal = useCallback((successCallback?: () => void) => {
    setOnSuccess(() => successCallback)
    setIsOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setIsOpen(false)
    setOnSuccess(undefined)
  }, [])

  useEffect(() => subscribeAuthRequired('animepahe', () => openModal()), [openModal])

  return (
    <AnimePaheCookieContext.Provider value={{ isOpen, openModal, closeModal, onSuccess }}>
      {children}
    </AnimePaheCookieContext.Provider>
  )
}
