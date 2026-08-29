import React, { useState, useEffect } from 'react'
import GenericModal from '../common/GenericModal'
import styles from '../anime/AnimePaheCookieModal.module.css'
import toast from 'react-hot-toast'

interface JasmrCookieModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

const JasmrCookieModal: React.FC<JasmrCookieModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [step, setStep] = useState<1 | 2>(1)
  const [userAgent, setUserAgent] = useState(
    typeof navigator !== 'undefined' ? navigator.userAgent : ''
  )
  const [cookie, setCookie] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setStep(1)
      setUserAgent(typeof navigator !== 'undefined' ? navigator.userAgent : '')
      setCookie('')
    }
  }, [isOpen])

  const handleStartVerification = async () => {
    localStorage.setItem('jasmr_ua', userAgent)
    window.open('https://japaneseasmr.com', '_blank')
    setStep(2)
  }

  const handleSubmitCookie = async () => {
    if (!cookie.trim()) {
      toast.error('Please enter the cf_clearance cookie')
      return
    }

    setIsSubmitting(true)
    try {
      localStorage.setItem('jasmr_cookie', cookie.trim())
      toast.success('Cookie updated successfully!')
      onSuccess?.()
      onClose()
    } catch (e) {
      toast.error('Failed to save cookie')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <GenericModal isOpen={isOpen} onClose={onClose} title="JapaneseASMR Verification Required">
      <div className={styles.container}>
        {step === 1 ? (
          <>
            <p>
              JapaneseASMR is protected by a Cloudflare challenge. Solve it once in your browser and
              paste the <strong>cf_clearance</strong> cookie so the app can load the site for you.
            </p>
            <div className={styles.field}>
              <label>Your User-Agent (must match the browser you solve the challenge with):</label>
              <textarea
                value={userAgent}
                onChange={(e) => setUserAgent(e.target.value)}
                rows={3}
                className={styles.textarea}
              />
            </div>
            <div className={styles.actions}>
              <button className={styles.secondaryButton} onClick={onClose}>
                Cancel
              </button>
              <button className={styles.button} onClick={handleStartVerification}>
                Start Verification (Opens JapaneseASMR)
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              1. Solve the challenge on the <strong>JapaneseASMR tab</strong> (keep that tab open).
              <br />
              2. Copy the <strong>cf_clearance</strong> cookie value using one of these:
              <br />
              <br />
              <strong>Chrome / Edge &mdash; DevTools:</strong> press <code>F12</code> &rarr;{' '}
              <strong>Application</strong> &rarr; <strong>Cookies</strong> &rarr;{' '}
              <code>https://japaneseasmr.com</code>. Find <strong>cf_clearance</strong>,
              double-click its <strong>Value</strong> to select it, then copy.
              <br />
              <br />
              <strong>Firefox &mdash; Storage Inspector:</strong> press <code>F12</code> &rarr;{' '}
              <strong>Storage</strong> &rarr; <strong>Cookies</strong> &rarr;{' '}
              <code>https://japaneseasmr.com</code>. Find <strong>cf_clearance</strong>, right-click
              the value &rarr; <strong>Copy Value</strong>.
              <br />
              <br />
              <strong>Either browser &mdash; extension:</strong> install a cookie manager like{' '}
              <em>Cookie-Editor</em> or <em>Cookie Manager</em>, open it while on the JapaneseASMR
              tab, find <strong>cf_clearance</strong>, and copy its value (or use the extension's
              export).
              <br />
              <br />
              3. Paste it below. Copy <strong>only the value</strong> &mdash; remove any{' '}
              <code>cf_clearance=</code> prefix or quotes if they were included.
            </p>
            <div className={styles.field}>
              <label>cf_clearance cookie value:</label>
              <input
                type="text"
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                placeholder="e.g. xxxxxxxx.xxxxxxxx.xxxxxxx-xxxxxxx"
                className={styles.input}
              />
            </div>
            <div className={styles.actions}>
              <button className={styles.secondaryButton} onClick={onClose}>
                Cancel
              </button>
              <button className={styles.secondaryButton} onClick={() => setStep(1)}>
                Back
              </button>
              <button
                className={styles.button}
                onClick={handleSubmitCookie}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Saving...' : 'Submit'}
              </button>
            </div>
          </>
        )}
      </div>
    </GenericModal>
  )
}

export default JasmrCookieModal
