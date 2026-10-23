import { useCallback, useEffect, useRef } from 'react'
import type { ComponentProps } from 'react'
import { usePlayer } from './PlayerContext'
import type { PlayerSource, PlayerSourceOptions } from '../../lib/player/types'

interface SourceProps {
  source?: PlayerSource
  sourceOptions?: PlayerSourceOptions
}

function useMediaElement(source?: PlayerSource, options?: PlayerSourceOptions) {
  const engine = usePlayer()
  const latestOptions = useRef(options)
  latestOptions.current = options
  const url = source?.url
  const hls = source?.hls
  const bind = useCallback(
    (media: HTMLMediaElement | null) => {
      engine.mediaRef.current = media
      engine.connect()
    },
    [engine]
  )
  useEffect(() => {
    if (url) return engine.loadSource({ url, hls }, latestOptions.current)
  }, [engine, url, hls])
  return bind
}

export function PlayerVideo({
  source,
  sourceOptions,
  ...props
}: Omit<ComponentProps<'video'>, 'ref' | 'src'> & SourceProps) {
  const bind = useMediaElement(source, sourceOptions)
  return <video playsInline {...props} ref={bind} />
}

export function PlayerAudio({
  source,
  sourceOptions,
  ...props
}: Omit<ComponentProps<'audio'>, 'ref' | 'src'> & SourceProps) {
  const bind = useMediaElement(source, sourceOptions)
  return <audio {...props} ref={bind} />
}
