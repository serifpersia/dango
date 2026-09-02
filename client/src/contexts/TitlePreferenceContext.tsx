import { createContext, useContext } from 'react'
export type TitlePreferenceContextType = {
  titlePreference: 'name' | 'nativeName' | 'englishName'
  setTitlePreference: (preference: 'name' | 'nativeName' | 'englishName') => void
  loading: boolean
}

export const TitlePreferenceContext = createContext<TitlePreferenceContextType | undefined>(
  undefined
)

export const useTitlePreference = (): TitlePreferenceContextType => {
  const context = useContext(TitlePreferenceContext)
  if (context === undefined) {
    throw new Error('useTitlePreference must be used within a TitlePreferenceProvider')
  }
  return context
}
