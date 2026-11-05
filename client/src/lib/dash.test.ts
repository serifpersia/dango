import { describe, expect, it } from 'vitest'
import { resolveDashModule } from './dash'

describe('resolveDashModule', () => {
  it('resolves the dashjs MediaPlayer constructor', () => {
    class MediaPlayer {}
    expect(resolveDashModule({ default: { MediaPlayer } })?.MediaPlayer).toBe(MediaPlayer)
    expect(resolveDashModule({ MediaPlayer })?.MediaPlayer).toBe(MediaPlayer)
    expect(resolveDashModule({ default: MediaPlayer })?.MediaPlayer).toBe(MediaPlayer)
    expect(resolveDashModule({ default: {} })).toBeNull()
    expect(resolveDashModule(null)).toBeNull()
  })
})
