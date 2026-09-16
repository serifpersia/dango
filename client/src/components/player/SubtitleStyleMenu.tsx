import React from 'react'
import Icon from '../common/Icon'
import {
  BG_COLOR_PRESETS,
  DEFAULT_SUBTITLE_STYLE,
  TEXT_COLOR_PRESETS,
} from '../../lib/subtitleStyle'
import { MenuSlider, SegmentedRow, SwatchRow } from './MenuControls'

export type SubtitleStyleKey =
  'fontSize' | 'position' | 'bgOpacity' | 'bgColor' | 'textColor' | 'edge' | 'bold'

export interface SubtitleStyleValues {
  fontSize: number
  position: number
  bgOpacity: number
  bgColor: string
  textColor: string
  edge: 'shadow' | 'outline' | 'none'
  bold: boolean
}

export interface SubtitleStyleMenuClasses {
  item: string
  active: string
}

interface SubtitleStyleMenuProps {
  classes: SubtitleStyleMenuClasses
  values: SubtitleStyleValues
  onChange: (key: SubtitleStyleKey, value: number | string | boolean) => void
}

const SubtitleStyleMenu: React.FC<SubtitleStyleMenuProps> = ({ classes, values, onChange }) => {
  const reset = () => {
    const d = DEFAULT_SUBTITLE_STYLE
    onChange('fontSize', d.fontSize)
    onChange('position', d.position)
    onChange('bgOpacity', d.bgOpacity)
    onChange('bgColor', d.bgColor)
    onChange('textColor', d.textColor)
    onChange('edge', d.edge)
    onChange('bold', d.bold)
  }
  return (
    <>
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
