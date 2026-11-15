import { createContext, useContext } from 'react'

export type ThemeId = 'taro' | 'mochi' | 'sakura' | 'matcha' | 'mitarashi' | 'kinako' | 'azuki'

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

export const THEMES: {
  id: ThemeId
  label: string
  color: string
}[] = [
  { id: 'taro', label: 'Taro', color: '#7d6df0' },
  { id: 'sakura', label: 'Sakura', color: '#e0b0e0' },
  { id: 'matcha', label: 'Matcha', color: '#8fcf7a' },
  { id: 'mitarashi', label: 'Mitarashi', color: '#d9a05b' },
  { id: 'kinako', label: 'Kinako', color: '#d8b56b' },
  { id: 'azuki', label: 'Azuki', color: '#c96b7b' },
  { id: 'mochi', label: 'Shiratama', color: '#e3e1ee' },
]

export const SEASONAL_THEME: Record<'winter' | 'spring' | 'summer' | 'autumn', ThemeId> = {
  spring: 'sakura',
  summer: 'matcha',
  autumn: 'mitarashi',
  winter: 'mochi',
}

export type Season = keyof typeof SEASONAL_THEME

export const seasonForDate = (date = new Date()): Season => {
  const month = date.getMonth()
  if (month >= 2 && month <= 4) return 'spring'
  if (month >= 5 && month <= 7) return 'summer'
  if (month >= 8 && month <= 10) return 'autumn'
  return 'winter'
}

export const seasonalThemeForDate = (date = new Date()): ThemeId =>
  SEASONAL_THEME[seasonForDate(date)]
