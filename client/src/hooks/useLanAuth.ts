import { useContext } from 'react'
import { LanAuthContext } from '../contexts/LanAuthContext'

export const useLanAuth = () => {
  const context = useContext(LanAuthContext)
  if (!context) {
    throw new Error('useLanAuth must be used within a LanAuthProvider')
  }
  return context
}
