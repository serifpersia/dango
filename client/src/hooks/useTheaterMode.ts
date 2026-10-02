import React, { useCallback, useEffect, useState } from 'react'

export function useTheaterMode() {
  const [isTheaterMode, setIsTheaterMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('playerTheaterMode') === 'true'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      if (isTheaterMode) {
        document.body.classList.add('theater-mode')
      } else {
        document.body.classList.remove('theater-mode')
      }
    } catch (e) {
      console.error(e)
    }
    return () => {
      try {
        document.body.classList.remove('theater-mode')
      } catch (e) {
        console.error(e)
      }
    }
  }, [isTheaterMode])

  const toggleTheaterMode = useCallback(() => {
    setIsTheaterMode((prev) => {
      const next = !prev
      try {
        localStorage.setItem('playerTheaterMode', next.toString())
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  const handleLayoutClick = useCallback(
    (e: React.MouseEvent) => {
      if (isTheaterMode && e.target === e.currentTarget) {
        setIsTheaterMode(false)
        try {
          localStorage.setItem('playerTheaterMode', 'false')
        } catch {
          // ignore
        }
      }
    },
    [isTheaterMode]
  )

  return { isTheaterMode, toggleTheaterMode, handleLayoutClick }
}
