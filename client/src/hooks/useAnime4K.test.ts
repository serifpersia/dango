import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useAnime4K from './useAnime4K'

const { effects, useState } = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  useState: vi.fn(),
}))

vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => effects.push(effect),
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useState,
}))
vi.mock('anime4k-webgpu-async', () => ({
  ModeA: vi.fn(),
  ModeB: vi.fn(),
  ModeC: vi.fn(),
  ModeAA: vi.fn(),
}))

describe('Anime4K initialization cleanup', () => {
  beforeEach(() => {
    effects.length = 0
    useState
      .mockReset()
      .mockImplementation((initial) => [
        typeof initial === 'function' ? initial() : initial,
        vi.fn(),
      ])
      .mockReturnValueOnce([true, vi.fn()])
    vi.stubGlobal('localStorage', { getItem: () => 'true' })
    vi.stubGlobal('window', { innerWidth: 1920, innerHeight: 1080 })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('destroys a device acquired after unmount without touching the canvas', async () => {
    let resolveDevice!: (device: unknown) => void
    const requestDevice = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveDevice = resolve
        })
    )
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ requestDevice }) } })
    const getContext = vi.fn()
    useAnime4K({
      videoRef: { current: { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement },
      canvasRef: { current: { getContext } as unknown as HTMLCanvasElement },
    })
    const cleanup = effects[1]()
    await vi.waitFor(() => expect(requestDevice).toHaveBeenCalledOnce())
    if (typeof cleanup === 'function') cleanup()
    const destroy = vi.fn()
    resolveDevice({ destroy })
    await vi.waitFor(() => expect(destroy).toHaveBeenCalledOnce())
    expect(getContext).not.toHaveBeenCalled()
  })

  it('releases an acquired device when canvas setup fails', async () => {
    const destroy = vi.fn()
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: async () => ({ requestDevice: async () => ({ destroy }) }) },
    })
    useAnime4K({
      videoRef: { current: { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement },
      canvasRef: { current: { getContext: () => null } as unknown as HTMLCanvasElement },
    })
    const cleanup = effects[1]()
    await vi.waitFor(() => expect(destroy).toHaveBeenCalledOnce())
    if (typeof cleanup === 'function') cleanup()
    expect(destroy).toHaveBeenCalledOnce()
  })
})
