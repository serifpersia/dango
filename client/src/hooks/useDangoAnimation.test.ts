/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startDangoAnimation, gazeAt } from './useDangoAnimation'

const rect = { left: 0, top: 0, width: 360, height: 120, right: 360, bottom: 120 } as DOMRect

const setup = () => {
  document.body.innerHTML = `
    <div data-dango-origin style="position:relative">
      <button data-dango-slot="0" data-dango-face="normal"><svg><g data-dango-eye="0"></g></svg></button>
      <button data-dango-slot="1" data-dango-face="normal"><svg><g data-dango-eye="1"></g></svg></button>
      <button data-dango-slot="2" data-dango-face="normal"><svg><g data-dango-eye="2"></g></svg></button>
      <button data-dango-slot="3" data-dango-face="normal"><svg><g data-dango-eye="3"></g></svg></button>
    </div>
  `
  const slots = Array.from(document.querySelectorAll<HTMLElement>('[data-dango-slot]'))
  slots.forEach((el, i) => {
    const left = i * 80 + 10
    const top = 20
    el.getBoundingClientRect = () =>
      ({ left, top, right: left + 60, bottom: top + 60, width: 60, height: 60 }) as DOMRect
  })
  const origin = document.querySelector<HTMLElement>('[data-dango-origin]')!
  origin.getBoundingClientRect = () => rect
  return {
    slots,
    eyes: Array.from(document.querySelectorAll<SVGGElement>('[data-dango-eye]')),
  }
}

const move = (clientX: number, clientY: number) => {
  window.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY }))
}

const frames = async (n: number) => {
  for (let i = 0; i < n; i++) {
    await vi.advanceTimersByTimeAsync(16)
  }
}

describe('dango animation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(performance.now()), 16)
    )
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({ matches: false })),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('gazeAt clamps relative pointer position', () => {
    const center = gazeAt(180, 60, rect)
    expect(center.x).toBeCloseTo(0)
    expect(center.y).toBeCloseTo(0)
    expect(gazeAt(1000, 1000, rect).x).toBe(1)
    expect(gazeAt(-1000, -1000, rect).y).toBe(-1)
  })

  it('pets hovered dango and drops cheer after leaving', async () => {
    const { slots } = setup()
    const stop = startDangoAnimation()
    move(40, 50)
    await frames(1)
    expect(slots[0].getAttribute('data-dango-face')).toBe('pet')
    expect(slots[0].hasAttribute('data-dango-cheer')).toBe(true)

    move(500, 500)
    await frames(1)
    expect(slots[0].getAttribute('data-dango-face')).not.toBe('pet')
    await vi.advanceTimersByTimeAsync(400)
    expect(slots[0].hasAttribute('data-dango-cheer')).toBe(false)
    stop()
  })

  it('all dangos sleep after idle', async () => {
    const { slots } = setup()
    const stop = startDangoAnimation()
    await vi.advanceTimersByTimeAsync(7000)
    expect(slots.every((el) => el.getAttribute('data-dango-face') === 'sleep')).toBe(true)
    stop()
  })

  it('dangos do not look uniformly at pointer', async () => {
    const { eyes } = setup()
    const seq = [0.05, 0.2, 0.8, 0.5, 0.8, 0.5, 0.8, 0.5, 0.8, 0.5, 0.5, 0.5]
    let k = 0
    vi.spyOn(Math, 'random').mockImplementation(() => seq[k++ % seq.length]!)
    const stop = startDangoAnimation()
    move(180, 60)
    await vi.advanceTimersByTimeAsync(3300)
    await frames(50)
    const xs = eyes.map((el) => el.style.getPropertyValue('--dango-gaze-x'))
    expect(new Set(xs).size).toBeGreaterThan(1)
    stop()
  })
})
