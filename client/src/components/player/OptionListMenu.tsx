import React from 'react'
import Icon from '../common/Icon'

export interface OptionListMenuClasses {
  item: string
  active: string
}

export interface OptionListItem {
  key: string
  label: React.ReactNode
  selected: boolean
}

interface OptionListMenuProps {
  classes: OptionListMenuClasses
  options: OptionListItem[]
  onSelect: (key: string) => void
}

const OptionListMenu: React.FC<OptionListMenuProps> = ({ classes, options, onSelect }) => (
  <>
    {options.map((option) => (
      <button
        key={option.key}
        type="button"
        className={`${classes.item} ${option.selected ? classes.active : ''}`}
        onClick={() => onSelect(option.key)}
      >
        <span>{option.label}</span>
        {option.selected && <Icon name="check" size={12} />}
      </button>
    ))}
  </>
)

export default OptionListMenu
