import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { profileStorage, setActiveProfileId } from './profileStorage'
import {
  buildCueCss,
  buildOverlayCss,
  DEFAULT_SUBTITLE_STYLE,
  fitSubtitleSize,
  formatSubtitleDelay,
  isSubtitleFont,
  loadSubtitleStyle,
  SUBTITLE_FONTS,
  SUBTITLE_STYLE_STORAGE_KEYS,
  subtitleBottomPx,
} from './subtitleStyle'

const fontChoices = [
  ['default', 'Default', ''],
  ['comic-neue', 'Comic Neue', "'Comic Neue', sans-serif"],
  ['chakra-petch', 'Chakra Petch', "'Chakra Petch', sans-serif"],
  ['oswald', 'Oswald', "'Oswald Variable', sans-serif"],
  ['bree-serif', 'Bree Serif', "'Bree Serif', serif"],
  ['russo-one', 'Russo One', "'Russo One', sans-serif"],
  ['bangers', 'Bangers', "'Bangers', sans-serif"],
  ['atkinson-hyperlegible', 'Atkinson Hyperlegible', "'Atkinson Hyperlegible', sans-serif"],
] as const

const invalidFontStrings = [
  '',
  'unknown-font',
  'noto-sans',
  'roboto',
  'open-sans',
  'Roboto',
  ' roboto ',
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'hasOwnProperty',
  'roboto; color: red; } video::cue { display: none',
  '</style><script>alert(1)</script>',
  'url(https://example.com/font.woff2)',
]

describe('subtitle font choices', () => {
  it('exposes exactly the supported fonts and the default storage contract', () => {
    expect(Object.keys(SUBTITLE_FONTS)).toEqual(fontChoices.map(([font]) => font))
    expect(DEFAULT_SUBTITLE_STYLE.font).toBe('default')
    expect(SUBTITLE_STYLE_STORAGE_KEYS.font).toBe('subtitleFont')
  })

  it.each(fontChoices)('accepts %s with its label and family', (font, label, family) => {
    expect(isSubtitleFont(font)).toBe(true)
    expect(SUBTITLE_FONTS[font]).toEqual({ label, family })
  })

  it.each(invalidFontStrings)('rejects unsupported or unsafe font %j', (font) => {
    expect(isSubtitleFont(font)).toBe(false)
  })

  it.each([
    null,
    undefined,
    0,
    true,
    {},
    ['bangers'],
    { toString: () => 'bangers' },
    new String('bangers'),
    Symbol('bangers'),
  ])('rejects non-string font %#', (font) => {
    expect(isSubtitleFont(font)).toBe(false)
  })
})

describe('subtitle style defaults and storage keys', () => {
  it('defines all ten defaults, including a one-pixel black outline', () => {
    expect(DEFAULT_SUBTITLE_STYLE).toEqual({
      font: 'default',
      fontSize: 1.8,
      position: 0,
      bgOpacity: 0.5,
      bgColor: '#000000',
      textColor: '#ffffff',
      edge: 'shadow',
      outlineWidth: 1,
      outlineColor: '#000000',
      bold: false,
    })
    expect(SUBTITLE_STYLE_STORAGE_KEYS).toEqual({
      font: 'subtitleFont',
      fontSize: 'subtitleFontSize',
      position: 'subtitlePosition',
      bgOpacity: 'subtitleBgOpacity',
      bgColor: 'subtitleBgColor',
      textColor: 'subtitleTextColor',
      edge: 'subtitleEdge',
      outlineWidth: 'subtitleOutlineWidth',
      outlineColor: 'subtitleOutlineColor',
      bold: 'subtitleBold',
    })
  })
})

describe('loadSubtitleStyle', () => {
  let data: Map<string, string>

  beforeEach(() => {
    setActiveProfileId('default')
    data = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    })
  })

  afterEach(() => {
    setActiveProfileId('default')
    vi.unstubAllGlobals()
  })

  it('returns all defaults when storage is empty', () => {
    expect(loadSubtitleStyle()).toEqual(DEFAULT_SUBTITLE_STYLE)
  })

  it.each(fontChoices)('loads the persisted %s font', (font) => {
    profileStorage.setItem(SUBTITLE_STYLE_STORAGE_KEYS.font, font)
    expect(loadSubtitleStyle().font).toBe(font)
  })

  it.each(invalidFontStrings)('falls back for malformed persisted font %j', (font) => {
    profileStorage.setItem(SUBTITLE_STYLE_STORAGE_KEYS.font, font)
    const style = loadSubtitleStyle()
    expect(style).toEqual(DEFAULT_SUBTITLE_STYLE)
    expect(buildCueCss(style)).not.toContain('font-family')
    expect(buildOverlayCss(style)).not.toContain('font-family')
  })

  it('keeps existing saved styles when only the persisted font is invalid', () => {
    for (const [key, value] of Object.entries({
      subtitleFont: '__proto__',
      subtitleFontSize: '2.5',
      subtitlePosition: '20',
      subtitleBgOpacity: '0.75',
      subtitleBgColor: '#123456',
      subtitleTextColor: '#abcdef',
      subtitleEdge: 'outline',
      subtitleBold: 'true',
    })) {
      profileStorage.setItem(key, value)
    }
    expect(loadSubtitleStyle()).toEqual({
      font: 'default',
      fontSize: 2.5,
      position: 20,
      bgOpacity: 0.75,
      bgColor: '#123456',
      textColor: '#abcdef',
      edge: 'outline',
      outlineWidth: 1,
      outlineColor: '#000000',
      bold: true,
    })
  })

  it.each([0.5, 1, 1.5, 2.25, 4])('loads persisted outline width %s without rounding', (width) => {
    profileStorage.setItem('subtitleOutlineWidth', String(width))
    expect(loadSubtitleStyle()).toEqual({ ...DEFAULT_SUBTITLE_STYLE, outlineWidth: width })
  })

  it.each([
    ['-10', 0.5],
    ['0', 0.5],
    ['0.49', 0.5],
    ['4.01', 4],
    ['100', 4],
  ] as const)('clamps persisted outline width %s to %s', (raw, expected) => {
    profileStorage.setItem('subtitleOutlineWidth', raw)
    expect(loadSubtitleStyle().outlineWidth).toBe(expected)
  })

  it.each(['', ' ', 'NaN', 'Infinity', '-Infinity', '1e309', 'null', 'undefined', 'wide', '{}'])(
    'falls back to one for invalid outline width %j without losing other settings',
    (raw) => {
      profileStorage.setItem('subtitleOutlineWidth', raw)
      profileStorage.setItem('subtitleOutlineColor', '#123456')
      profileStorage.setItem('subtitleFont', 'bangers')
      profileStorage.setItem('subtitleEdge', 'outline')
      expect(loadSubtitleStyle()).toEqual({
        ...DEFAULT_SUBTITLE_STYLE,
        font: 'bangers',
        edge: 'outline',
        outlineWidth: 1,
        outlineColor: '#123456',
      })
    }
  )

  describe.each(['bgColor', 'textColor', 'outlineColor'] as const)('%s validation', (key) => {
    it.each(['#000000', '#ffffff', '#123456', '#AbCDeF'])(
      'loads the six-digit hex color %s unchanged',
      (color) => {
        profileStorage.setItem(SUBTITLE_STYLE_STORAGE_KEYS[key], color)
        expect(loadSubtitleStyle()).toEqual({ ...DEFAULT_SUBTITLE_STYLE, [key]: color })
      }
    )

    it.each([
      '',
      '#fff',
      '#12345',
      '#1234567',
      '#12345678',
      '#gggggg',
      '123456',
      'black',
      'rgba(0, 0, 0, 1)',
      ' #123456',
      '#123456 ',
      '#123456; color: red',
      '</style><script>alert(1)</script>',
    ])('falls back for invalid color %j without losing a saved outline width', (color) => {
      profileStorage.setItem(SUBTITLE_STYLE_STORAGE_KEYS[key], color)
      profileStorage.setItem('subtitleOutlineWidth', '2.5')
      const style = loadSubtitleStyle()
      expect(style).toEqual({ ...DEFAULT_SUBTITLE_STYLE, outlineWidth: 2.5 })
      expect(buildCueCss(style)).not.toContain('<script>')
      expect(buildOverlayCss(style)).not.toContain('<script>')
    })
  })

  it('loads outline settings alongside all previously persisted styles', () => {
    const saved = {
      font: 'bree-serif',
      fontSize: 2.5,
      position: 20,
      bgOpacity: 0,
      bgColor: '#123456',
      textColor: '#abcdef',
      edge: 'outline',
      outlineWidth: 3,
      outlineColor: '#00e5ff',
      bold: true,
    } as const
    for (const key of Object.keys(saved) as (keyof typeof saved)[]) {
      profileStorage.setItem(SUBTITLE_STYLE_STORAGE_KEYS[key], String(saved[key]))
    }
    expect(loadSubtitleStyle()).toEqual(saved)
    for (const css of [buildCueCss(loadSubtitleStyle()), buildOverlayCss(loadSubtitleStyle())]) {
      expect(css).toContain('-3px 0 0 #00e5ff')
      expect(css).toContain('0 0 6px rgba(0, 229, 255, 0.9)')
    }
  })

  it('isolates outline settings per profile and preserves legacy default-profile keys', () => {
    profileStorage.setItem('subtitleOutlineWidth', '2.5')
    profileStorage.setItem('subtitleOutlineColor', '#123456')
    expect(data.get('subtitleOutlineWidth')).toBe('2.5')
    expect(data.get('subtitleOutlineColor')).toBe('#123456')

    setActiveProfileId('second')
    expect(loadSubtitleStyle()).toEqual(DEFAULT_SUBTITLE_STYLE)
    profileStorage.setItem('subtitleOutlineWidth', '4')
    profileStorage.setItem('subtitleOutlineColor', '#abcdef')
    expect(data.get('dango:profile:second:subtitleOutlineWidth')).toBe('4')
    expect(data.get('dango:profile:second:subtitleOutlineColor')).toBe('#abcdef')
    expect(loadSubtitleStyle()).toEqual({
      ...DEFAULT_SUBTITLE_STYLE,
      outlineWidth: 4,
      outlineColor: '#abcdef',
    })

    setActiveProfileId('third')
    profileStorage.setItem('subtitleOutlineWidth', 'NaN')
    profileStorage.setItem('subtitleOutlineColor', 'red')
    expect(loadSubtitleStyle()).toEqual(DEFAULT_SUBTITLE_STYLE)

    setActiveProfileId('second')
    expect(loadSubtitleStyle().outlineWidth).toBe(4)
    expect(loadSubtitleStyle().outlineColor).toBe('#abcdef')
    profileStorage.removeItem('subtitleOutlineWidth')
    expect(loadSubtitleStyle()).toEqual({ ...DEFAULT_SUBTITLE_STYLE, outlineColor: '#abcdef' })
    profileStorage.removeItem('subtitleOutlineColor')
    expect(loadSubtitleStyle()).toEqual(DEFAULT_SUBTITLE_STYLE)

    setActiveProfileId('default')
    expect(loadSubtitleStyle()).toEqual({
      ...DEFAULT_SUBTITLE_STYLE,
      outlineWidth: 2.5,
      outlineColor: '#123456',
    })
  })

  it('returns defaults when storage access throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Storage unavailable')
      },
    })
    expect(loadSubtitleStyle()).toEqual(DEFAULT_SUBTITLE_STYLE)
  })

  it('returns defaults when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadSubtitleStyle()).toEqual(DEFAULT_SUBTITLE_STYLE)
  })

  it('isolates subtitle fonts by profile without losing the legacy default preference', () => {
    profileStorage.setItem(SUBTITLE_STYLE_STORAGE_KEYS.font, 'comic-neue')
    expect(data.get('subtitleFont')).toBe('comic-neue')

    setActiveProfileId('second')
    expect(loadSubtitleStyle().font).toBe('default')
    profileStorage.setItem(SUBTITLE_STYLE_STORAGE_KEYS.font, 'bangers')
    expect(data.get('dango:profile:second:subtitleFont')).toBe('bangers')
    expect(loadSubtitleStyle().font).toBe('bangers')

    setActiveProfileId('third')
    expect(loadSubtitleStyle().font).toBe('default')
    profileStorage.setItem(SUBTITLE_STYLE_STORAGE_KEYS.font, '__proto__')
    expect(loadSubtitleStyle().font).toBe('default')
    profileStorage.setItem(SUBTITLE_STYLE_STORAGE_KEYS.font, 'atkinson-hyperlegible')
    expect(loadSubtitleStyle().font).toBe('atkinson-hyperlegible')

    setActiveProfileId('second')
    expect(loadSubtitleStyle().font).toBe('bangers')
    profileStorage.removeItem(SUBTITLE_STYLE_STORAGE_KEYS.font)
    expect(loadSubtitleStyle().font).toBe('default')

    setActiveProfileId('default')
    expect(loadSubtitleStyle().font).toBe('comic-neue')
    setActiveProfileId('third')
    expect(loadSubtitleStyle().font).toBe('atkinson-hyperlegible')
  })
})

describe.each(fontChoices)('subtitle CSS for %s', (font, _label, family) => {
  it.each([false, true])('applies the font to native and overlay cues with bold=%s', (bold) => {
    const style = { ...DEFAULT_SUBTITLE_STYLE, font, bold }
    const cue = buildCueCss(style)
    const overlay = buildOverlayCss(style)

    if (font === 'default') {
      expect(cue).not.toContain('font-family')
      expect(overlay).not.toContain('font-family')
    } else {
      expect(cue).toContain(`font-family: ${family} !important;`)
      expect(overlay).toContain(`font-family: ${family};`)
    }
    expect(cue).toContain('video::cue')
    expect(cue).toContain(`font-weight: ${bold ? 'bold' : 'normal'} !important;`)
    expect(overlay).toContain(`font-weight: ${bold ? '700' : '400'};`)
    expect(cue).toContain('font-size: 1.8rem !important;')
    expect(overlay).toContain('font-size: 1.8rem;')
    expect(cue).toContain('color: #ffffff !important;')
    expect(overlay).toContain('color: #ffffff;')
    expect(cue).toContain('background-color: rgba(0, 0, 0, 0.5) !important;')
    expect(overlay).toContain('background-color: rgba(0, 0, 0, 0.5);')
    expect(cue).toContain('text-shadow: 0 0 4px black, 0 1px 2px rgba(0, 0, 0, 0.8) !important;')
    expect(overlay).toContain('text-shadow: 0 0 4px black, 0 1px 2px rgba(0, 0, 0, 0.8);')
  })
})

describe('shared native and overlay subtitle edges', () => {
  const shadows = (style: Parameters<typeof buildCueCss>[0]) => [
    buildCueCss(style)
      .match(/text-shadow:\s*([^;]+);/)?.[1]
      .replace(/ !important$/, ''),
    buildOverlayCss(style).match(/text-shadow:\s*([^;]+);/)?.[1],
  ]

  describe.each([0.5, 1, 1.5, 2.5, 4])('outline width %s', (width) => {
    it.each([
      ['#000000', 'rgba(0, 0, 0, 0.9)'],
      ['#123456', 'rgba(18, 52, 86, 0.9)'],
      ['#AbCDeF', 'rgba(171, 205, 239, 0.9)'],
    ])('uses %s for all eight directions and the six-pixel glow', (color, glow) => {
      const expected = [
        `-${width}px 0 0 ${color}`,
        `${width}px 0 0 ${color}`,
        `0 -${width}px 0 ${color}`,
        `0 ${width}px 0 ${color}`,
        `-${width}px -${width}px 0 ${color}`,
        `${width}px -${width}px 0 ${color}`,
        `-${width}px ${width}px 0 ${color}`,
        `${width}px ${width}px 0 ${color}`,
        `0 0 6px ${glow}`,
      ].join(', ')
      for (const bgOpacity of [0, 0.5, 1]) {
        const style = {
          ...DEFAULT_SUBTITLE_STYLE,
          edge: 'outline' as const,
          outlineWidth: width,
          outlineColor: color,
          bgOpacity,
        }
        expect(shadows(style)).toEqual([expected, expected])
        expect(buildCueCss(style)).toContain(`text-shadow: ${expected} !important;`)
        expect(buildOverlayCss(style)).toContain(`text-shadow: ${expected};`)
      }
    })
  })

  it('uses the default one-pixel black outline when only the edge mode changes', () => {
    const style = { ...DEFAULT_SUBTITLE_STYLE, edge: 'outline' as const }
    const expected = [
      '-1px 0 0 #000000',
      '1px 0 0 #000000',
      '0 -1px 0 #000000',
      '0 1px 0 #000000',
      '-1px -1px 0 #000000',
      '1px -1px 0 #000000',
      '-1px 1px 0 #000000',
      '1px 1px 0 #000000',
      '0 0 6px rgba(0, 0, 0, 0.9)',
    ].join(', ')
    expect(shadows(style)).toEqual([expected, expected])
  })

  it.each([0, 0.01, 0.5, 1])('None removes all shadows with background opacity %s', (bgOpacity) => {
    const style = {
      ...DEFAULT_SUBTITLE_STYLE,
      edge: 'none' as const,
      bgOpacity,
      outlineWidth: 4,
      outlineColor: '#ff0000',
    }
    expect(shadows(style)).toEqual(['none', 'none'])
    expect(buildCueCss(style)).toContain('text-shadow: none !important;')
    expect(buildOverlayCss(style)).toContain('text-shadow: none;')
  })

  it.each([0, 0.5, 1])(
    'preserves the original black shadow with background opacity %s',
    (bgOpacity) => {
      const style = {
        ...DEFAULT_SUBTITLE_STYLE,
        edge: 'shadow' as const,
        bgOpacity,
        outlineWidth: 4,
        outlineColor: '#ff0000',
      }
      const expected = '0 0 4px black, 0 1px 2px rgba(0, 0, 0, 0.8)'
      expect(shadows(style)).toEqual([expected, expected])
    }
  )
})

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
