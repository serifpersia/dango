import React, { useState, useEffect, useRef } from 'react'
import { Modal } from '../common/Modal'
import styles from '../anime/AnimePaheCookieModal.module.css'
import toast from 'react-hot-toast'

interface JasmrCookieModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

interface HelperReply {
  ok?: boolean
  cookie?: string
  error?: string
  storeId?: string
  debug?: { stores?: string[]; names?: string[] }
}

const EXTENSION_ZIP_URL =
  'https://github.com/serifpersia/dango/releases/latest/download/dango-extension.zip'

const parseReply = (e: Event): HelperReply | null => {
  try {
    return JSON.parse((e as CustomEvent<string>).detail) as HelperReply
  } catch {
    return null
  }
}

const JasmrCookieModal: React.FC<JasmrCookieModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [step, setStep] = useState<1 | 2>(1)
  const [userAgent, setUserAgent] = useState(
    typeof navigator !== 'undefined' ? navigator.userAgent : ''
  )
  const [cookie, setCookie] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const replyRef = useRef<((e: Event) => void) | null>(null)

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isAndroid = /android/i.test(ua)
  const isFirefoxDesktop = /firefox|fxios/i.test(ua) && !isAndroid
  const isChromeDesktop = !isFirefoxDesktop && !isAndroid && /chrome|chromium|edg|brave/i.test(ua)
  const showHelper = isFirefoxDesktop || isChromeDesktop

  useEffect(() => {
    if (isOpen) {
      setStep(1)
      setUserAgent(typeof navigator !== 'undefined' ? navigator.userAgent : '')
      setCookie('')
      setIsSubmitting(false)
      setExtracting(false)
    }
  }, [isOpen])

  useEffect(() => {
    return () => {
      if (replyRef.current) {
        window.removeEventListener('dango:jasmr-cookie', replyRef.current)
        replyRef.current = null
      }
    }
  }, [])

  const handleStartVerification = async () => {
    localStorage.setItem('jasmr_ua', userAgent)
    window.open('https://japaneseasmr.com', '_blank', 'noopener,noreferrer')
    setStep(2)
  }

  const handleExtract = () => {
    if (extracting) return
    setExtracting(true)
    const timer = window.setTimeout(() => {
      setExtracting(false)
      if (replyRef.current) {
        window.removeEventListener('dango:jasmr-cookie', replyRef.current)
        replyRef.current = null
      }
      toast.error('Helper not detected — install it via about:debugging first.')
    }, 3000)
    const onReply = (e: Event) => {
      window.clearTimeout(timer)
      window.removeEventListener('dango:jasmr-cookie', onReply)
      replyRef.current = null
      setExtracting(false)
      const detail = parseReply(e)
      if (detail?.ok && detail.cookie) {
        setCookie(detail.cookie)
        toast.success('Cookie extracted from helper!')
      } else if (detail?.error === 'NO_COOKIE') {
        const stores = detail.debug?.stores?.length ?? 0
        const names = detail.debug?.names ?? []
        toast.error(
          `Helper found no cf_clearance (checked ${stores} stores, saw: ${names.join(', ') || 'none'}) — solve the challenge on the JapaneseASMR tab first.`
        )
      } else {
        toast.error('Helper request failed — try again.')
      }
    }
    replyRef.current = onReply
    window.addEventListener('dango:jasmr-cookie', onReply)
    window.dispatchEvent(new CustomEvent('dango:get-jasmr-cookie'))
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
    } catch {
      toast.error('Failed to save cookie')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="JapaneseASMR Verification Required">
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
              <strong>Either browser &mdash; extension:</strong> open{' '}
              <strong>Cookie Manager</strong> while on the JapaneseASMR tab, find{' '}
              <strong>cf_clearance</strong>, and copy its value (or use the extension&apos;s
              export).
              <br />
              <br />
              3. Paste it below. Copy <strong>only the value</strong> &mdash; remove any{' '}
              <code>cf_clearance=</code> prefix or quotes if they were included.
            </p>
            {showHelper && (
              <div className={styles.hint}>
                <strong>Dango helper (one-time setup):</strong>{' '}
                {isFirefoxDesktop ? (
                  <>
                    type <code>about:debugging</code> in the address bar &rarr;{' '}
                    <strong>This Firefox</strong> &rarr; <strong>Load Temporary Add-on</strong>{' '}
                    &rarr; open the <code>dango-extension/firefox</code> folder and pick{' '}
                    <code>manifest.json</code>. (Temporary helpers unload when Firefox closes —
                    repeat after a restart.)
                  </>
                ) : (
                  <>
                    type <code>chrome://extensions</code> in the address bar &rarr; enable{' '}
                    <strong>Developer mode</strong> &rarr; <strong>Load unpacked</strong> &rarr;
                    open the <code>dango-extension/chrome</code> folder. (Unpacked helpers show a
                    developer-mode notice — expected.)
                  </>
                )}{' '}
                Use this link to download the extension and extract it:{' '}
                <a
                  href={EXTENSION_ZIP_URL}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.link}
                >
                  dango-extension.zip
                </a>
                . Then click Extract below and the field fills itself.
                <div className={styles.actions}>
                  <button
                    className={styles.button}
                    onClick={handleExtract}
                    disabled={extracting}
                    type="button"
                  >
                    {extracting ? 'Extracting…' : 'Extract cookie from helper'}
                  </button>
                </div>
              </div>
            )}
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
    </Modal>
  )
}

export default JasmrCookieModal
