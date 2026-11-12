import React from 'react'
import Icon from '../common/Icon'
import {
  BG_COLOR_PRESETS,
  DEFAULT_SUBTITLE_STYLE,
  OUTLINE_COLOR_PRESETS,
  SUBTITLE_FONTS,
  TEXT_COLOR_PRESETS,
  type SubtitleStyleKey,
  type SubtitleStyleSettings,
} from '../../lib/subtitleStyle'
import { MenuSlider, SegmentedRow, SwatchRow } from './MenuControls'

export type { SubtitleStyleKey }
export type SubtitleStyleValues = SubtitleStyleSettings

export interface SubtitleStyleMenuClasses {
  item: string
  active: string
}

interface SubtitleStyleMenuProps {
  classes: SubtitleStyleMenuClasses
  values: SubtitleStyleValues
  onChange: (key: SubtitleStyleKey, value: number | string | boolean) => void
  onFontMenu: () => void
}

const SubtitleStyleMenu: React.FC<SubtitleStyleMenuProps> = ({
  classes,
  values,
  onChange,
  onFontMenu,
}) => {
  const reset = () => {
    const d = DEFAULT_SUBTITLE_STYLE
    onChange('font', d.font)
    onChange('fontSize', d.fontSize)
    onChange('position', d.position)
    onChange('bgOpacity', d.bgOpacity)
    onChange('bgColor', d.bgColor)
    onChange('textColor', d.textColor)
    onChange('edge', d.edge)
    onChange('outlineWidth', d.outlineWidth)
    onChange('outlineColor', d.outlineColor)
    onChange('bold', d.bold)
  }
  return (
    <>
      <button type="button" className={classes.item} onClick={onFontMenu} aria-haspopup="true">
        <span>Font</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {SUBTITLE_FONTS[values.font].label}
          <Icon name="chevron-right" size={12} />
        </span>
      </button>
      <MenuSlider
        label="Font Size"
        display={values.fontSize.toFixed(1)}
        min={0.5}
        max={10}
        step={0.5}
        value={values.fontSize}
        percent={((values.fontSize - 0.5) / 9.5) * 100}
        onChange={(v) => {
          if (Number.isFinite(v)) onChange('fontSize', v)
        }}
      />
      <MenuSlider
        label="Vertical Position"
        display={`${values.position}`}
        min={0}
        max={100}
        step={1}
        value={values.position}
        percent={values.position}
        onChange={(v) => {
          if (Number.isFinite(v)) onChange('position', Math.round(v))
        }}
      />
      <MenuSlider
        label="Background Opacity"
        display={`${Math.round(values.bgOpacity * 100)}%`}
        min={0}
        max={1}
        step={0.05}
        value={values.bgOpacity}
        percent={values.bgOpacity * 100}
        onChange={(v) => {
          if (Number.isFinite(v)) onChange('bgOpacity', v)
        }}
      />
      <SwatchRow
        label="Text Color"
        colors={TEXT_COLOR_PRESETS}
        value={values.textColor}
        onChange={(c) => onChange('textColor', c)}
      />
      <SwatchRow
        label="Background Color"
        colors={BG_COLOR_PRESETS}
        value={values.bgColor}
        onChange={(c) => onChange('bgColor', c)}
      />
      <SegmentedRow
        label="Text Edge"
        options={['shadow', 'outline', 'none'] as const}
        value={values.edge}
        onChange={(edge) => onChange('edge', edge)}
      />
      {values.edge === 'outline' && (
        <>
          <MenuSlider
            label="Outline Thickness"
            display={`${values.outlineWidth.toFixed(1)}px`}
            min={0.5}
            max={4}
            step={0.5}
            value={values.outlineWidth}
            percent={((values.outlineWidth - 0.5) / 3.5) * 100}
            onChange={(v) => {
              if (Number.isFinite(v)) onChange('outlineWidth', v)
            }}
          />
          <SwatchRow
            label="Outline Color"
            colors={OUTLINE_COLOR_PRESETS}
            value={values.outlineColor}
            onChange={(color) => onChange('outlineColor', color)}
          />
        </>
      )}
      <button
        type="button"
        className={`${classes.item} ${values.bold ? classes.active : ''}`}
        onClick={() => onChange('bold', !values.bold)}
      >
        <span>Bold Text</span>
        {values.bold && <Icon name="check" size={12} />}
      </button>
      <button type="button" className={classes.item} onClick={reset}>
        <span>Reset to Defaults</span>
      </button>
    </>
  )
}

export default SubtitleStyleMenu
