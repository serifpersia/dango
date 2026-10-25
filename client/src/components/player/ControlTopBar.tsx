import React from 'react'
import Icon from '../common/Icon'
import styles from './UnifiedPlayer.module.css'

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
  server?: string
  mode?: 'sub' | 'dub'
  audio?: string
  subtitles?: string
  onBack: () => void
  classes: TopBarClasses
}

const ControlTopBar: React.FC<ControlTopBarProps> = ({
  visible,
  title,
  episode,
  server,
  mode,
  audio,
  subtitles,
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
      <div className={`${classes.titleInfo} ${styles.topBarTitleInfo}`}>
        <span className={classes.title}>{title}</span>
        {episode && <span className={classes.episode}>{episode}</span>}
        {(mode || server || audio || subtitles) && (
          <div className={styles.streamDetails}>
            {mode && <span className={styles.modeTag}>{mode.toUpperCase()}</span>}
            {server && <span title={`Server: ${server}`}>Server: {server}</span>}
            {audio && <span title={`Audio: ${audio}`}>Audio: {audio}</span>}
            {subtitles && <span title={`Subs: ${subtitles}`}>Subs: {subtitles}</span>}
          </div>
        )}
      </div>
    </div>
  </div>
)

export default ControlTopBar
