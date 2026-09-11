import React from 'react'
import { FaPlay, FaPause } from 'react-icons/fa'
import { MdReplay10, MdForward10 } from 'react-icons/md'
import styles from './CenterControls.module.css'

interface CenterControlsProps {
  isPlaying: boolean
  onTogglePlay: () => void
  onSkipBack: () => void
  onSkipForward: () => void
  skipSeconds?: number
}

const CenterControls: React.FC<CenterControlsProps> = ({
  isPlaying,
  onTogglePlay,
  onSkipBack,
  onSkipForward,
  skipSeconds = 10,
}) => {
  return (
    <div className={styles.centerControls} onClick={(e) => e.stopPropagation()}>
      <button
        className={styles.centerSkipBtn}
        onClick={onSkipBack}
        title={`Skip back ${skipSeconds}s`}
        aria-label={`Skip back ${skipSeconds} seconds`}
      >
        <MdReplay10 />
      </button>
      <button
        className={styles.centerPlayPause}
        data-speed-boost-ignore="true"
        onClick={onTogglePlay}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <FaPause /> : <FaPlay className={styles.playIconOffset} />}
      </button>
      <button
        className={styles.centerSkipBtn}
        onClick={onSkipForward}
        title={`Skip forward ${skipSeconds}s`}
        aria-label={`Skip forward ${skipSeconds} seconds`}
      >
        <MdForward10 />
      </button>
    </div>
  )
}

export default CenterControls
