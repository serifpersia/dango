import React from 'react'
import Icon from '../common/Icon'

export interface SettingsShellClasses {
  panel: string
  header: string
  backBtn: string
  title: string
  content: string
}

interface SettingsShellProps {
  classes: SettingsShellClasses
  title: string
  titleTag?: 'h3' | 'span'
  showBack?: boolean
  onBack: () => void
  panelRef?: React.RefObject<HTMLDivElement | null>
  onPanelClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  children: React.ReactNode
}

const SettingsShell: React.FC<SettingsShellProps> = ({
  classes,
  title,
  titleTag = 'span',
  showBack = true,
  onBack,
  panelRef,
  onPanelClick,
  children,
}) => {
  const TitleTag = titleTag
  return (
    <div ref={panelRef} className={classes.panel} onClick={onPanelClick}>
      <div className={classes.header}>
        {showBack && (
          <button className={classes.backBtn} onClick={onBack}>
            <Icon name="chevron-left" />
          </button>
        )}
        <TitleTag className={classes.title || undefined}>{title}</TitleTag>
      </div>
      <div className={classes.content}>{children}</div>
    </div>
  )
}

export default SettingsShell
