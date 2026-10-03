import React from 'react'
import Icon from '../common/Icon'

export interface TopBarClasses {
  overlay: string
  hidden: string
  top: string
  backBtn: string
  titleInfo: string
  title: string
  episode: string
}

interface ControlTopBarProps {
  visible: boolean
  title: string
  episode?: string
  onBack: () => void
  classes: TopBarClasses
}

const ControlTopBar: React.FC<ControlTopBarProps> = ({
  visible,
  title,
  episode,
  onBack,
  classes,
}) => (
  <div
    className={`${classes.overlay} ${!visible ? classes.hidden : ''} `}
    data-speed-boost-ignore="true"
    style={{ pointerEvents: 'none', background: 'none' }}
  >
    <div className={classes.top} onClick={(e) => e.stopPropagation()}>
      <button
        className={classes.backBtn}
        onClick={(e) => {
          e.stopPropagation()
          onBack()
        }}
        title="Back"
        aria-label="Back"
      >
        <Icon name="chevron-left" />
      </button>
      <div className={classes.titleInfo}>
        <span className={classes.title}>{title}</span>
        {episode && <span className={classes.episode}>{episode}</span>}
      </div>
    </div>
  </div>
)

export default ControlTopBar
