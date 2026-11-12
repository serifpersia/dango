import React from 'react'
import { isSubtitleFont, SUBTITLE_FONTS, type SubtitleFont } from '../../lib/subtitleStyle'
import OptionListMenu, { type OptionListMenuClasses } from './OptionListMenu'

interface SubtitleFontMenuProps {
  classes: OptionListMenuClasses
  value: SubtitleFont
  onChange: (font: SubtitleFont) => void
}

const SubtitleFontMenu: React.FC<SubtitleFontMenuProps> = ({ classes, value, onChange }) => (
  <OptionListMenu
    classes={classes}
    options={Object.entries(SUBTITLE_FONTS).map(([key, font]) => ({
      key,
      label: font.label,
      selected: value === key,
    }))}
    onSelect={(key) => {
      if (isSubtitleFont(key)) onChange(key)
    }}
  />
)

export default SubtitleFontMenu
