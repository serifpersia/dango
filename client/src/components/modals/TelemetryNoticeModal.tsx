import React, { useState } from 'react'
import GenericModal from '../common/GenericModal'
import ToggleSwitch from '../common/ToggleSwitch'
import styles from './TelemetryNoticeModal.module.css'
import { FaChevronDown } from 'react-icons/fa'
import packageJson from '../../../../package.json'
import { deleteTelemetryData } from '../../hooks/useTelemetry'

interface TelemetryNoticeModalProps {
  isOpen: boolean
  onClose: () => void
}

const getBrowserInfo = () => {
  const ua = navigator.userAgent
  if (ua.includes('Firefox')) return 'Firefox'
  if (ua.includes('SamsungBrowser')) return 'Samsung Browser'
  if (ua.includes('Opera') || ua.includes('OPR')) return 'Opera'
  if (ua.includes('Edge')) return 'Edge'
  if (ua.includes('Chrome')) return 'Chrome'
  if (ua.includes('Safari')) return 'Safari'
  return 'Unknown'
}

const getOSInfo = () => {
  const ua = navigator.userAgent
  if (ua.includes('Windows')) return 'Windows'
  if (ua.includes('Mac')) return 'macOS'
  if (ua.includes('Linux')) return 'Linux'
  if (ua.includes('Android')) return 'Android'
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS'
  return 'Unknown'
}

const TelemetryNoticeModal: React.FC<TelemetryNoticeModalProps> = ({ isOpen, onClose }) => {
  const [enabled, setEnabled] = useState(true)
  const [showPreview, setShowPreview] = useState(false)

  const confirm = () => {
    localStorage.setItem('telemetry_enabled', String(enabled))
    localStorage.setItem('telemetry_notice_v2', 'true')
    if (!enabled) {
      deleteTelemetryData()
    }
    onClose()
  }

  return (
    <GenericModal isOpen={isOpen} onClose={() => {}} title="Telemetry">
      <div className={styles.container}>
        <p className={styles.description}>
          Dango collects anonymous usage data to help track how many people use the app. This
          information is used to measure the project's install base and popularity. Participation is
          completely optional.
        </p>

        <div className={styles.dataList}>
          <p className={styles.dataTitle}>What is collected:</p>
          <ul>
            <li>Browser type and operating system</li>
            <li>Your timezone (e.g. Europe/Berlin)</li>
            <li>Anonymous timestamps (first seen / last seen)</li>
          </ul>
        </div>

        <button className={styles.previewToggle} onClick={() => setShowPreview(!showPreview)}>
          <span>See exactly what data is sent</span>
          <FaChevronDown className={`${styles.chevron} ${showPreview ? styles.chevronOpen : ''}`} />
        </button>

        {showPreview && (
          <div className={styles.previewBox}>
            <div className={styles.previewItem}>
              <span className={styles.previewKey}>Browser:</span>
              <span className={styles.previewVal}>{getBrowserInfo()}</span>
            </div>
            <div className={styles.previewItem}>
              <span className={styles.previewKey}>OS:</span>
              <span className={styles.previewVal}>{getOSInfo()}</span>
            </div>
            <div className={styles.previewItem}>
              <span className={styles.previewKey}>Timezone:</span>
              <span className={styles.previewVal}>
                {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </span>
            </div>
            <div className={styles.previewItem}>
              <span className={styles.previewKey}>App Version:</span>
              <span className={styles.previewVal}>{packageJson.version}</span>
            </div>
          </div>
        )}

        <div className={styles.toggleRow}>
          <span className={styles.toggleLabel}>Send anonymous telemetry</span>
          <ToggleSwitch
            isChecked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            id="telemetry-notice-toggle"
          />
        </div>

        <div className={styles.actions}>
          <button className={styles.okButton} onClick={confirm}>
            Ok
          </button>
        </div>
      </div>
    </GenericModal>
  )
}

export default TelemetryNoticeModal
