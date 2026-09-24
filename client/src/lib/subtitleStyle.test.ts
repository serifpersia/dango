import { describe, it, expect } from 'vitest'
import { fitSubtitleSize, formatSubtitleDelay, subtitleBottomPx } from './subtitleStyle'

describe('fitSubtitleSize', () => {
  it('keeps the user size on large video surfaces', () => {
    expect(fitSubtitleSize(1.8, 800)).toBeCloseTo(1.8, 5)
  })

  it('shrinks an oversized preference on small portrait video', () => {
    const fitted = fitSubtitleSize(3, 220)
    expect(fitted * 16).toBeLessThanOrEqual(220 * 0.07 + 1e-9)
    expect(fitted).toBeLessThan(3)
  })

  it('never enlarges beyond the user preference', () => {
    expect(fitSubtitleSize(1, 1080)).toBeCloseTo(1, 5)
  })

  it('floors at a readable minimum', () => {
    expect(fitSubtitleSize(1.8, 40) * 16).toBeGreaterThanOrEqual(13)
  })
})

describe('formatSubtitleDelay', () => {
  it('keeps zero neutral and shows the sign for adjusted timings', () => {
    expect(formatSubtitleDelay(0)).toBe('0.0s')
    expect(formatSubtitleDelay(500)).toBe('+0.5s')
    expect(formatSubtitleDelay(-1500)).toBe('-1.5s')
  })
})

describe('subtitleBottomPx', () => {
  const video = (over: Partial<HTMLVideoElement>) =>
    ({
      clientWidth: 0,
      clientHeight: 0,
      videoWidth: 0,
      videoHeight: 0,
      ...over,
    }) as HTMLVideoElement

  it('measures lift from the video box, not the letterboxed shell', () => {
    const v = video({ clientWidth: 390, clientHeight: 390, videoWidth: 1280, videoHeight: 720 })
    const vidH = 390 / (1280 / 720)
    const band = (390 - vidH) / 2
    expect(subtitleBottomPx(v, 0)).toBeCloseTo(band, 5)
    expect(subtitleBottomPx(v, 50)).toBeCloseTo(band + vidH * 0.5, 5)
  })

  it('matches plain percentage when the video fills its box', () => {
    const v = video({ clientWidth: 1280, clientHeight: 720, videoWidth: 1280, videoHeight: 720 })
    expect(subtitleBottomPx(v, 10)).toBeCloseTo(72, 5)
  })
})
