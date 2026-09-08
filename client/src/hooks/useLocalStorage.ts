import { useCallback, useEffect, useState } from 'react'

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return initialValue
      if (typeof initialValue === 'string') return raw as T
      try {
        return JSON.parse(raw) as T
      } catch {
        return raw as T
      }
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return
      try {
        if (e.newValue === null) {
          setValue(initialValue)
          return
        }
        if (typeof initialValue === 'string') {
          setValue(e.newValue as T)
          return
        }
        try {
          setValue(JSON.parse(e.newValue) as T)
        } catch {
          setValue(e.newValue as T)
        }
      } catch {
        // ignore
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [key, initialValue])

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        try {
          if (typeof resolved === 'string') localStorage.setItem(key, resolved)
          else localStorage.setItem(key, JSON.stringify(resolved))
        } catch {
          // ignore
        }
        return resolved
      })
    },
    [key]
  )

  return [value, set] as const
}
