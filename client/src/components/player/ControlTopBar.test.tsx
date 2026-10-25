import type { ComponentChildren } from 'preact'
import type { ComponentProps } from 'react'
import { expect, it } from 'vitest'
import ControlTopBar from './ControlTopBar'

function text(node: ComponentChildren): string {
  if (Array.isArray(node)) return node.map(text).join('')
  if (node && typeof node === 'object' && 'props' in node) return text(node.props.children)
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}

const render = (props: Partial<ComponentProps<typeof ControlTopBar>> = {}) =>
  text(
    ControlTopBar({
      visible: true,
      title: 'Example title',
      episode: 'Episode 4',
      onBack: () => {},
      classes: {
        overlay: '',
        hidden: '',
        top: '',
        backBtn: '',
        titleInfo: '',
        title: '',
        episode: '',
      },
      ...props,
    })
  )

it('keeps the title and episode when stream metadata is unavailable', () => {
  const result = render()
  expect(result).toContain('Example title')
  expect(result).toContain('Episode 4')
  expect(result).not.toMatch(/Server:|Audio:|Subs:/)
})

it.each(['sub', 'dub'] as const)(
  'shows anime %s mode and the selected server without an audio label',
  (mode) => {
    const result = render({ mode, server: 'Kwik', subtitles: 'English' })
    expect(result).toContain(mode.toUpperCase())
    expect(result).toContain('Server: Kwik')
    expect(result).toContain('Subs: English')
    expect(result).not.toContain('Audio:')
  }
)

it('shows the selected TV audio and subtitle names', () => {
  const result = render({
    server: 'Premium VidSpark',
    audio: 'Japanese 5.1',
    subtitles: 'English SDH',
  })
  expect(result).toContain('Server: Premium VidSpark')
  expect(result).toContain('Audio: Japanese 5.1')
  expect(result).toContain('Subs: English SDH')
})

it('omits the subtitle label when subtitles are off', () => {
  const result = render({ mode: 'sub', server: 'Kwik' })
  expect(result).toContain('SUB')
  expect(result).not.toContain('Subs:')
  expect(result).not.toContain('Off')
})
