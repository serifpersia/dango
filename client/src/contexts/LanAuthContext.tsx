import { createContext } from 'react'

export interface LanAuthContextType {
  isOpen: boolean
  openModal: () => void
  closeModal: () => void
}

export const LanAuthContext = createContext<LanAuthContextType | undefined>(undefined)
