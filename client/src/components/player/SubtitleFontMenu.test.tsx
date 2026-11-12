import type { ComponentChildren, VNode } from 'preact'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SUBTITLE_FONTS, type SubtitleFont } from '../../lib/subtitleStyle'
import OptionListMenu from './OptionListMenu'
import SubtitleFontMenu from './SubtitleFontMenu'

type ButtonProps = Omit<ComponentProps<'button'>, 'className' | 'onClick'> & {
  className: string
  onClick: () => void
}

function nodes<P>(node: ComponentChildren): VNode<P>[] {
  if (Array.isArray(node)) return node.flatMap((child) => nodes<P>(child))
  if (node && typeof node === 'object' && 'props' in node) {
    return [node as VNode<P>, ...nodes<P>(node.props.children)]
  }
  return []
}

function text(node: ComponentChildren): string {
  if (Array.isArray(node)) return node.map(text).join('')
  if (node && typeof node === 'object' && 'props' in node) return text(node.props.children)
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}

const classes = { item: 'font-item', active: 'font-active' }
const fonts = Object.keys(SUBTITLE_FONTS) as SubtitleFont[]

function render(font: SubtitleFont = 'default') {
  const onChange = vi.fn<(font: SubtitleFont) => void>()
  const menu = SubtitleFontMenu({ classes, value: font, onChange }) as VNode<
    ComponentProps<typeof OptionListMenu>
  >
  const tree = OptionListMenu(menu.props)
  const buttons = nodes<ButtonProps>(tree).filter((node) => node.type === 'button')
  return { tree, menu, buttons, onChange }
}

describe('SubtitleFontMenu', () => {
  it('returns a plain font list with delegated classes and no preview', () => {
    const { menu, buttons, tree } = render()
    expect(menu.type).toBe(OptionListMenu)
    expect(menu.props.classes).toEqual(classes)
    expect(menu.props.options.map((option) => option.key)).toEqual(fonts)
    expect(buttons).toHaveLength(fonts.length)
    for (const [index, font] of fonts.entries()) {
      expect(menu.props.options[index].label).toBe(SUBTITLE_FONTS[font].label)
      expect(text(buttons[index])).toBe(SUBTITLE_FONTS[font].label)
      expect(buttons[index].props.className).toContain(classes.item)
      expect(buttons[index].props.type).toBe('button')
    }
    expect(text(tree)).not.toMatch(/preview/i)
    expect(
      nodes<{ style?: { fontFamily?: string } }>(tree).some((node) => node.props.style?.fontFamily)
    ).toBe(false)
  })

  it.each(fonts)('marks only %s active and emits its typed key when clicked', (font) => {
    const { menu, buttons, onChange } = render(font)
    expect(
      menu.props.options.filter((option) => option.selected).map((option) => option.key)
    ).toEqual([font])
    expect(
      buttons.filter((button) => button.props.className.includes(classes.active))
    ).toHaveLength(1)
    expect(onChange).not.toHaveBeenCalled()
    const button = buttons[fonts.indexOf(font)]
    expect(button.props.className).toContain(classes.active)
    button.props.onClick()
    expect(onChange).toHaveBeenCalledExactlyOnceWith(font)
  })

  it('changes from the current font to another choice without changing other styles', () => {
    const { buttons, onChange } = render('comic-neue')
    buttons[fonts.indexOf('bangers')].props.onClick()
    expect(onChange).toHaveBeenCalledExactlyOnceWith('bangers')
  })

  it.each([
    'unknown-font',
    'noto-sans',
    'roboto',
    'open-sans',
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    'roboto; color: red',
    '</style><script>alert(1)</script>',
  ])('ignores invalid keys passed by the option menu: %j', (key) => {
    const { menu, onChange } = render()
    menu.props.onSelect(key)
    expect(onChange).not.toHaveBeenCalled()
  })
})
