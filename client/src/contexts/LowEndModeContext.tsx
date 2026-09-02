import { createContext, useContext } from 'react'

export type LowEndModeContextType = {
  lowEndMode: boolean
  setLowEndMode: (value: boolean) => void
  loading: boolean
}

export const LowEndModeContext = createContext<LowEndModeContextType | undefined>(undefined)

export const useLowEndMode = (): LowEndModeContextType => {
  const context = useContext(LowEndModeContext)
  if (context === undefined) {
    throw new Error('useLowEndMode must be used within a LowEndModeProvider')
  }
  return context
}
