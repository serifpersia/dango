import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useSetting, useUpdateSetting } from '../hooks/useSettings'
import { LowEndModeContext } from './LowEndModeContext'

interface LowEndModeProviderProps {
  children: React.ReactNode
}

export const LowEndModeProvider: React.FC<LowEndModeProviderProps> = ({ children }) => {
  const { data: lowEndModeSetting, isLoading } = useSetting('lowEndMode')
  const updateSetting = useUpdateSetting()
  const [lowEndMode, setLowEndModeState] = useState<boolean>(false)

  useEffect(() => {
    if (lowEndModeSetting !== undefined) {
      setLowEndModeState(lowEndModeSetting === 'true' || lowEndModeSetting === true)
    }
  }, [lowEndModeSetting])

  useEffect(() => {
    if (lowEndMode) {
      document.body.classList.add('low-end')
    } else {
      document.body.classList.remove('low-end')
    }
  }, [lowEndMode])

  const setLowEndMode = useCallback(
    (value: boolean) => {
      setLowEndModeState(value)
      updateSetting.mutate({ key: 'lowEndMode', value: String(value) })
    },
    [updateSetting]
  )

  const value = useMemo(
    () => ({ lowEndMode, setLowEndMode, loading: isLoading }),
    [lowEndMode, setLowEndMode, isLoading]
  )

  return <LowEndModeContext.Provider value={value}>{children}</LowEndModeContext.Provider>
}
