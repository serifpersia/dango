import { useEffect, useState } from 'react'
import { trpcClient } from '../lib/trpc'

const isMissing = (url: string | undefined | null): boolean => {
  if (!url || url.trim() === '') return true
  return url.includes('placeholder')
}

export function useEnrichedThumbnail(
  showId: string | undefined,
  thumbnail: string | undefined
): { thumbnail: string | undefined } {
  const [resolved, setResolved] = useState<string | undefined>(thumbnail)

  useEffect(() => {
    setResolved(thumbnail)
  }, [thumbnail])

  useEffect(() => {
    if (!isMissing(thumbnail)) return
    if (!showId) return
    let cancelled = false
    trpcClient.data.showMeta
      .query({ id: showId })
      .then((meta) => {
        const fresh = (meta as { thumbnail?: string } | null)?.thumbnail
        if (!cancelled && fresh && fresh.trim() !== '' && !fresh.includes('placeholder')) {
          setResolved(fresh)
        }
      })
      .catch(() => {
        // ignore
      })
    return () => {
      cancelled = true
    }
  }, [showId, thumbnail])

  return { thumbnail: resolved }
}
