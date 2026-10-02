import { useCallback, useState } from 'react'

export interface AmbientLightSettings {
  enabled: boolean
  blur: number
  saturation: number
  brightness: number
  opacity: number
}

export const AMBIENT_DEFAULTS: AmbientLightSettings = {
  enabled: true,
  blur: 60,
  saturation: 150,
  brightness: 70,
  opacity: 60,
}

function readStored(): AmbientLightSettings {
  try {
    const raw = localStorage.getItem('playerAmbientLight')
    if (!raw) return AMBIENT_DEFAULTS
    const parsed = JSON.parse(raw) as Partial<AmbientLightSettings>
    const num = (v: unknown, fallback: number, min: number, max: number) => {
      const n = Number(v)
      if (!Number.isFinite(n)) return fallback
      return Math.max(min, Math.min(max, n))
    }
    return {
      enabled: parsed.enabled ?? AMBIENT_DEFAULTS.enabled,
      blur: num(parsed.blur, AMBIENT_DEFAULTS.blur, 0, 120),
      saturation: num(parsed.saturation, AMBIENT_DEFAULTS.saturation, 0, 200),
      brightness: num(parsed.brightness, AMBIENT_DEFAULTS.brightness, 20, 120),
      opacity: num(parsed.opacity, AMBIENT_DEFAULTS.opacity, 10, 100),
    }
  } catch {
    return AMBIENT_DEFAULTS
  }
}

export function useAmbientLight() {
  const [settings, setSettings] = useState<AmbientLightSettings>(readStored)

  const update = useCallback((patch: Partial<AmbientLightSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem('playerAmbientLight', JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  return { settings, update }
}
