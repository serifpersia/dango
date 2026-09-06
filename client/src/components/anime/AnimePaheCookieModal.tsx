import React, { useState, useEffect } from 'react'
import GenericModal from '../common/GenericModal'
import styles from './AnimePaheCookieModal.module.css'
import toast from 'react-hot-toast'

interface AnimePaheCookieModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

const AnimePaheCookieModal: React.FC<AnimePaheCookieModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<1 | 2>(1)
  const [userAgent, setUserAgent] = useState(navigator.userAgent)
  const [cookie, setCookie] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setStep(1)
      setUserAgent(navigator.userAgent)
      setCookie('')
    }
  }, [isOpen])

  const handleStartVerification = async () => {
    localStorage.setItem('animepahe_ua', userAgent)
    window.open('https://animepahe.pw', '_blank', 'noopener,noreferrer')
    setStep(2)
  }

  const handleSubmitCookie = async () => {
    if (!cookie.trim()) {
      toast.error('Please enter the cf_clearance cookie')
      return
    }

    setIsSubmitting(true)
    try {
      localStorage.setItem('animepahe_cookie', cookie.trim())
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
    <GenericModal isOpen={isOpen} onClose={onClose} title="AnimePahe Verification Required">
      <div className={styles.container}>
        {step === 1 ? (
          <>
            <p>
              AnimePahe requires a manual verification to bypass Cloudflare/DDoS-Guard protection.
            </p>
            <div className={styles.field}>
              <label>Your User-Agent (will be used for requests):</label>
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
                Start Verification (Opens AnimePahe)
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              1. Solve the challenge on the <strong>AnimePahe tab</strong> (keep that tab open).
              <br />
              2. Copy the <strong>cf_clearance</strong> cookie value using one of these:
              <br />
              <br />
              <strong>Chrome / Edge &mdash; DevTools:</strong> press <code>F12</code> &rarr;{' '}
              <strong>Application</strong> &rarr; <strong>Cookies</strong> &rarr;{' '}
              <code>https://animepahe.pw</code>. Find <strong>cf_clearance</strong>, double-click
              its <strong>Value</strong> to select it, then copy.
              <br />
              <br />
              <strong>Firefox &mdash; Storage Inspector:</strong> press <code>F12</code> &rarr;{' '}
              <strong>Storage</strong> &rarr; <strong>Cookies</strong> &rarr;{' '}
              <code>https://animepahe.pw</code>. Find <strong>cf_clearance</strong>, right-click the
              value &rarr; <strong>Copy Value</strong>.
              <br />
              <br />
              <strong>Either browser &mdash; extension:</strong> install a cookie manager like{' '}
              <em>Cookie-Editor</em> or <em>Cookie Manager</em>, open it while on the AnimePahe tab,
              find <strong>cf_clearance</strong>, and copy its value (or use the extension's
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

export default AnimePaheCookieModal
