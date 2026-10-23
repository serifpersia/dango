import React from 'react'
import { PlayPauseButton, SeekButton } from './PlaybackControls'

import styles from './CenterControls.module.css'

const CenterControls: React.FC = () => {
  return (
    <div className={styles.centerControls} onClick={(e) => e.stopPropagation()}>
      <SeekButton seconds={-10} className={styles.centerSkipBtn} />
      <PlayPauseButton className={styles.centerPlayPause} data-speed-boost-ignore="true" />
      <SeekButton seconds={10} className={styles.centerSkipBtn} />
    </div>
  )
}

export default CenterControls
