import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchApi } from '../lib/fetchApi'

const isMissing = (url: string | undefined | null): boolean => {
  if (!url || url.trim() === '') return true
  return url.includes('placeholder')
}

export function useEnrichedThumbnail(
  showId: string | undefined,
  thumbnail: string | undefined
): { thumbnail: string | undefined; reportImageError: () => void } {
  const [resolved, setResolved] = useState<string | undefined>(thumbnail)
  const retriedRef = useRef(false)

  useEffect(() => {
    setResolved(thumbnail)
    retriedRef.current = false
  }, [thumbnail])

  const refresh = useCallback(async () => {
    if (!showId) return
    try {
      const meta = await fetchApi(`/api/show-meta/${showId}`)
      const fresh = (meta as { thumbnail?: string } | null)?.thumbnail
      if (fresh && fresh.trim() !== '' && !fresh.includes('placeholder')) {
        setResolved((prev) => (prev === fresh ? prev : fresh))
      }
    } catch {
      // ignore
    }
  }, [showId])

  useEffect(() => {
    if (!isMissing(thumbnail)) return
    if (!showId) return
    let cancelled = false
    void (async () => {
      if (cancelled) return
      await refresh()
    })()
    return () => {
      cancelled = true
    }
  }, [showId, thumbnail, refresh])

  const reportImageError = useCallback(() => {
    if (retriedRef.current) return
    retriedRef.current = true
    void refresh()
  }, [refresh])

  return { thumbnail: resolved, reportImageError }
}
