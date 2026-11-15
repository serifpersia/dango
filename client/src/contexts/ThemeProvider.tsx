import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useSetting, useUpdateSetting } from '../hooks/useSettings'
import { ThemeContext, type ThemeId } from './ThemeContext'

interface ThemeProviderProps {
  children: React.ReactNode
}

const VALID_THEMES: ThemeId[] = [
  'taro',
  'mochi',
  'sakura',
  'matcha',
  'mitarashi',
  'kinako',
  'azuki',
]

function applyTheme(theme: ThemeId) {
  if (theme === 'taro') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', theme)
  }
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const { data: themeSetting, isLoading } = useSetting('theme')
  const updateSetting = useUpdateSetting()
  const [theme, setThemeState] = useState<ThemeId>('taro')

  useEffect(() => {
    if (typeof themeSetting === 'string' && VALID_THEMES.includes(themeSetting as ThemeId)) {
      setThemeState(themeSetting as ThemeId)
    }
  }, [themeSetting])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = useCallback(
    (value: ThemeId) => {
      if (value === theme) return
      setThemeState(value)
      applyTheme(value)
      updateSetting.mutate({ key: 'theme', value })
    },
    [updateSetting, theme]
  )

  const value = useMemo(
    () => ({ theme, setTheme, loading: isLoading }),
    [theme, setTheme, isLoading]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
