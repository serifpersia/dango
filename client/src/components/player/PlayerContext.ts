import { createContext, useContext } from 'react'
import type { PlayerEngine } from '../../lib/player/engine'

export const PlayerContext = createContext<PlayerEngine | null>(null)

export function usePlayer() {
  const player = useContext(PlayerContext)
  if (!player) throw new Error('Player controls must be inside a PlayerProvider.')
  return player
}
