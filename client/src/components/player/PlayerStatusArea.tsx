import React, { useState } from 'react'
import styles from './PlayerStatusArea.module.css'
import Icon from '../common/Icon'

const PlayerStatusArea: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className={styles.statusArea}>
      <button
        type="button"
        className={styles.toggleBtn}
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="player-shortcuts"
      >
        <Icon name="keyboard" size={14} />
        <span>Keyboard Shortcuts</span>
        {isOpen ? <Icon name="chevron-up" size={12} /> : <Icon name="chevron-down" size={12} />}
      </button>

      {isOpen && (
        <div id="player-shortcuts" className={styles.shortcuts}>
          <div className={styles.shortcutGroup}>
            <div className={styles.shortcut}>
              <span className={styles.key}>↑</span>
              <span className={styles.key}>↓</span>
              <span className={styles.label}>Volume</span>
            </div>
            <div className={styles.shortcut}>
              <span className={styles.key}>←</span>
              <span className={styles.key}>→</span>
              <span className={styles.label}>Seek</span>
            </div>
          </div>

          <div className={styles.shortcutGroup}>
            <div className={styles.shortcut}>
              <span className={styles.key}>Space</span>
              <span className={styles.label}>Play/Pause</span>
            </div>
            <div className={styles.shortcut}>
              <span className={styles.key}>F</span>
              <span className={styles.label}>Fullscreen</span>
            </div>
            <div className={styles.shortcut}>
              <span className={styles.key}>M</span>
              <span className={styles.label}>Mute</span>
            </div>
            <div className={styles.shortcut}>
              <span className={styles.key}>T</span>
              <span className={styles.label}>Theater</span>
            </div>
            <div className={styles.shortcut}>
              <span className={styles.key}>N</span>
              <span className={styles.label}>Next</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PlayerStatusArea
