import type { ReactNode } from 'react'
import type { PlayerEngine } from '../../lib/player/engine'
import { PlayerContext } from './PlayerContext'

export function PlayerProvider({
  engine,
  children,
}: {
  engine: PlayerEngine
  children: ReactNode
}) {
  return <PlayerContext.Provider value={engine}>{children}</PlayerContext.Provider>
}
