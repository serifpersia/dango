import type { ComponentChildren, VNode } from 'preact'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_FONTS,
  type SubtitleEdge,
  type SubtitleFont,
  type SubtitleStyleSettings,
} from '../../lib/subtitleStyle'
import { MenuSlider, SegmentedRow, SwatchRow } from './MenuControls'
import SubtitleStyleMenu from './SubtitleStyleMenu'

type ButtonProps = Omit<ComponentProps<'button'>, 'className' | 'onClick'> & {
  className: string
  onClick: () => void
}

type InputProps = {
  oninput: (event: { target: { value: string } }) => void
}

function nodes<P = Record<string, unknown>>(node: ComponentChildren): VNode<P>[] {
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

function render(values: SubtitleStyleSettings = DEFAULT_SUBTITLE_STYLE) {
  const onChange = vi.fn()
  const onFontMenu = vi.fn()
  const tree = SubtitleStyleMenu({
    classes: { item: 'style-item', active: 'style-active' },
    values,
    onChange,
    onFontMenu,
  })
  const buttons = nodes<ButtonProps>(tree).filter((node) => node.type === 'button')
  return { tree, buttons, onChange, onFontMenu }
}

function control<P>(tree: ComponentChildren, type: unknown, label: string): VNode<P> {
  const node = nodes(tree).find((node) => node.type === type && node.props.label === label)
  if (!node) throw new Error(`Expected ${label} control`)
  return node as VNode<P>
}

function outlineSlider(tree: ComponentChildren) {
  return control<ComponentProps<typeof MenuSlider>>(tree, MenuSlider, 'Outline Thickness')
}

function outlineSwatches(tree: ComponentChildren) {
  return control<ComponentProps<typeof SwatchRow>>(tree, SwatchRow, 'Outline Color')
}

describe('SubtitleStyleMenu', () => {
  it.each(Object.keys(SUBTITLE_FONTS) as SubtitleFont[])(
    'shows %s and navigates to the font menu without changing styles',
    (font) => {
      const { buttons, onChange, onFontMenu } = render({ ...DEFAULT_SUBTITLE_STYLE, font })
      const button = buttons.find((node) => /^Font/.test(text(node)))
      expect(button).toBeDefined()
      expect(text(button)).toContain(SUBTITLE_FONTS[font].label)
      expect(button?.props.className).toContain('style-item')
      expect(button?.props.type).toBe('button')
      expect(onFontMenu).not.toHaveBeenCalled()
      button?.props.onClick()
      expect(onFontMenu).toHaveBeenCalledExactlyOnceWith()
      expect(onChange).not.toHaveBeenCalled()
    }
  )

  it.each(['shadow', 'outline', 'none'] as const)(
    'shows outline controls only when the text edge is %s',
    (edge) => {
      const { tree, onChange, onFontMenu } = render({ ...DEFAULT_SUBTITLE_STYLE, edge })
      const sliders = nodes<ComponentProps<typeof MenuSlider>>(tree).filter(
        (node) => node.type === MenuSlider
      )
      const swatches = nodes<ComponentProps<typeof SwatchRow>>(tree).filter(
        (node) => node.type === SwatchRow
      )
      expect(sliders.map((node) => node.props.label)).toEqual(
        expect.arrayContaining(['Font Size', 'Vertical Position', 'Background Opacity'])
      )
      expect(swatches.map((node) => node.props.label)).toEqual(
        expect.arrayContaining(['Text Color', 'Background Color'])
      )
      expect(sliders.filter((node) => node.props.label === 'Outline Thickness')).toHaveLength(
        edge === 'outline' ? 1 : 0
      )
      expect(swatches.filter((node) => node.props.label === 'Outline Color')).toHaveLength(
        edge === 'outline' ? 1 : 0
      )
      if (edge === 'outline') {
        expect(outlineSlider(tree).props).toMatchObject({ min: 0.5, max: 4, step: 0.5, value: 1 })
        expect(outlineSwatches(tree).props.value).toBe('#000000')
      }
      expect(onChange).not.toHaveBeenCalled()
      expect(onFontMenu).not.toHaveBeenCalled()
    }
  )

  it.each([0.5, 1, 2.5, 4])('emits numeric outline width %s from the slider input', (width) => {
    const values = { ...DEFAULT_SUBTITLE_STYLE, edge: 'outline' as const, outlineWidth: 3 }
    const before = { ...values }
    const { tree, onChange, onFontMenu } = render(values)
    const slider = outlineSlider(tree)
    expect(slider.props).toMatchObject({ min: 0.5, max: 4, step: 0.5, value: 3 })
    const input = nodes<InputProps>(MenuSlider(slider.props)).find((node) => node.type === 'input')
    expect(input?.props).toMatchObject({
      type: 'range',
      'aria-label': 'Outline Thickness',
      min: 0.5,
      max: 4,
      step: 0.5,
      value: 3,
    })
    input?.props.oninput({ target: { value: String(width) } })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('outlineWidth', width)
    expect(values).toEqual(before)
    expect(onFontMenu).not.toHaveBeenCalled()
  })

  it.each([NaN, Infinity, -Infinity])('ignores non-finite outline width %s', (width) => {
    const { tree, onChange } = render({ ...DEFAULT_SUBTITLE_STYLE, edge: 'outline' })
    outlineSlider(tree).props.onChange(width)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('emits an outline preset color without changing other styles', () => {
    const values = {
      ...DEFAULT_SUBTITLE_STYLE,
      edge: 'outline' as const,
      outlineColor: '#123456',
    }
    const before = { ...values }
    const { tree, onChange, onFontMenu } = render(values)
    const swatches = outlineSwatches(tree)
    expect(swatches.props.value).toBe('#123456')
    expect(swatches.props.colors.length).toBeGreaterThan(0)
    const color = swatches.props.colors[0]
    const button = nodes<ButtonProps>(SwatchRow(swatches.props)).find(
      (node) => node.type === 'button' && node.props['aria-label'] === `Outline Color ${color}`
    )
    expect(button).toBeDefined()
    button?.props.onClick()
    expect(onChange).toHaveBeenCalledExactlyOnceWith('outlineColor', color)
    expect(values).toEqual(before)
    expect(onFontMenu).not.toHaveBeenCalled()
  })

  it('emits a custom outline color from the color input', () => {
    const { tree, onChange, onFontMenu } = render({
      ...DEFAULT_SUBTITLE_STYLE,
      edge: 'outline',
      outlineColor: '#123456',
    })
    const swatches = outlineSwatches(tree)
    const input = nodes<InputProps>(SwatchRow(swatches.props)).find((node) => node.type === 'input')
    expect(input?.props).toMatchObject({
      type: 'color',
      'aria-label': 'Custom outline color',
      value: '#123456',
    })
    input?.props.oninput({ target: { value: '#abcdef' } })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('outlineColor', '#abcdef')
    expect(onFontMenu).not.toHaveBeenCalled()
  })

  it.each(['shadow', 'outline', 'none'] as const)('emits the %s text edge selection', (edge) => {
    const values = {
      ...DEFAULT_SUBTITLE_STYLE,
      edge: 'outline' as const,
      outlineWidth: 3,
      outlineColor: '#123456',
    }
    const before = { ...values }
    const { tree, onChange, onFontMenu } = render(values)
    const row = control<ComponentProps<typeof SegmentedRow<SubtitleEdge>>>(
      tree,
      SegmentedRow,
      'Text Edge'
    )
    expect(row.props.options).toEqual(['shadow', 'outline', 'none'])
    expect(row.props.value).toBe('outline')
    const buttons = nodes<ButtonProps>(SegmentedRow(row.props)).filter(
      (node) => node.type === 'button'
    )
    expect(buttons.filter((node) => node.props['aria-pressed']).map(text)).toEqual(['outline'])
    const button = buttons.find((node) => text(node) === edge)
    expect(button).toBeDefined()
    button?.props.onClick()
    expect(onChange).toHaveBeenCalledExactlyOnceWith('edge', edge)
    expect(values).toEqual(before)
    expect(onFontMenu).not.toHaveBeenCalled()
  })

  it.each([false, true])('toggles bold=%s without changing outline preferences', (bold) => {
    const { buttons, onChange, onFontMenu } = render({
      ...DEFAULT_SUBTITLE_STYLE,
      edge: 'outline',
      outlineWidth: 3,
      outlineColor: '#123456',
      bold,
    })
    const button = buttons.find((node) => text(node) === 'Bold Text')
    expect(button).toBeDefined()
    expect(button?.props.className.includes('style-active')).toBe(bold)
    button?.props.onClick()
    expect(onChange).toHaveBeenCalledExactlyOnceWith('bold', !bold)
    expect(onFontMenu).not.toHaveBeenCalled()
  })

  it.each(['shadow', 'outline', 'none'] as const)(
    'resets all ten style properties from %s mode without navigating',
    (edge) => {
      const values: SubtitleStyleSettings = {
        font: 'atkinson-hyperlegible',
        fontSize: 4,
        position: 30,
        bgOpacity: 0.9,
        bgColor: '#123456',
        textColor: '#abcdef',
        edge,
        outlineWidth: 4,
        outlineColor: '#ff0000',
        bold: true,
      }
      const before = { ...values }
      const { buttons, onChange, onFontMenu } = render(values)
      const reset = buttons.find((node) => text(node) === 'Reset to Defaults')
      expect(reset).toBeDefined()
      expect(onChange).not.toHaveBeenCalled()
      reset?.props.onClick()
      expect(onChange).toHaveBeenCalledTimes(10)
      expect(onChange.mock.calls).toEqual(
        expect.arrayContaining([
          ['font', 'default'],
          ['fontSize', DEFAULT_SUBTITLE_STYLE.fontSize],
          ['position', DEFAULT_SUBTITLE_STYLE.position],
          ['bgOpacity', DEFAULT_SUBTITLE_STYLE.bgOpacity],
          ['bgColor', DEFAULT_SUBTITLE_STYLE.bgColor],
          ['textColor', DEFAULT_SUBTITLE_STYLE.textColor],
          ['edge', DEFAULT_SUBTITLE_STYLE.edge],
          ['outlineWidth', 1],
          ['outlineColor', '#000000'],
          ['bold', DEFAULT_SUBTITLE_STYLE.bold],
        ])
      )
      expect(onFontMenu).not.toHaveBeenCalled()
      expect(values).toEqual(before)
    }
  )
})
