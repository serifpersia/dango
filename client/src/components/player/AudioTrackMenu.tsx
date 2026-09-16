import React from 'react'
import OptionListMenu, { type OptionListMenuClasses } from './OptionListMenu'

export interface AudioTrackLike {
  language?: string
  label?: string
}

interface AudioTrackMenuProps {
  classes: OptionListMenuClasses
  tracks: AudioTrackLike[]
  selected: number
  onChange: (index: number) => void
}

const AudioTrackMenu: React.FC<AudioTrackMenuProps> = ({ classes, tracks, selected, onChange }) => (
  <OptionListMenu
    classes={classes}
    options={tracks.map((track, i) => ({
      key: String(i),
      label: track.label || track.language,
      selected: i === selected,
    }))}
    onSelect={(key) => onChange(Number(key))}
  />
)

export default AudioTrackMenu
