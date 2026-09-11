import { createContext, useContext } from 'react'

export type ThemeId = 'iris' | 'mochi' | 'sakura'

export type ThemeContextType = {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
  loading: boolean
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

export const THEMES: { id: ThemeId; label: string; blurb: string; swatch: string }[] = [
  { id: 'iris', label: 'Taro (default)', blurb: 'Deep purple', swatch: '#7d6df0' },
  { id: 'mochi', label: 'Mochi', blurb: 'Monochrome pearl', swatch: '#f0f0f0' },
  { id: 'sakura', label: 'Sakura', blurb: 'Soft pink', swatch: '#e0b0e0' },
]
