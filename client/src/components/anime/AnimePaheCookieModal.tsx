import React, { useState, useEffect, useRef } from 'react'
import GenericModal from '../common/GenericModal'
import styles from './AnimePaheCookieModal.module.css'
import toast from 'react-hot-toast'

interface AnimePaheCookieModalProps {
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

const AnimePaheCookieModal: React.FC<AnimePaheCookieModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<1 | 2>(1)
  const [userAgent, setUserAgent] = useState(navigator.userAgent)
  const [cookie, setCookie] = useState('')
  const [extracting, setExtracting] = useState(false)
  const replyRef = useRef<((e: Event) => void) | null>(null)

  const ua = navigator.userAgent
  const isAndroid = /android/i.test(ua)
  const isFirefoxDesktop = /firefox|fxios/i.test(ua) && !isAndroid
  const isChromeDesktop = !isFirefoxDesktop && !isAndroid && /chrome|chromium|edg|brave/i.test(ua)
  const showHelper = isFirefoxDesktop || isChromeDesktop

  useEffect(() => {
    if (isOpen) {
      setStep(1)
      setUserAgent(navigator.userAgent)
      setCookie('')
      setExtracting(false)
    }
  }, [isOpen])

  useEffect(() => {
    return () => {
      if (replyRef.current) {
        window.removeEventListener('dango:pahe-cookie', replyRef.current)
        replyRef.current = null
      }
    }
  }, [])

  const handleStartVerification = () => {
    localStorage.setItem('animepahe_ua', userAgent)
    window.open('https://animepahe.pw', '_blank', 'noopener,noreferrer')
    setStep(2)
  }

  const handleExtract = () => {
    if (extracting) return
    setExtracting(true)
    const timer = window.setTimeout(() => {
      setExtracting(false)
      if (replyRef.current) {
        window.removeEventListener('dango:pahe-cookie', replyRef.current)
        replyRef.current = null
      }
      toast.error('Helper not detected — install it via about:debugging first.')
    }, 3000)
    const onReply = (e: Event) => {
      window.clearTimeout(timer)
      window.removeEventListener('dango:pahe-cookie', onReply)
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
          `Helper found no cf_clearance (checked ${stores} stores, saw: ${names.join(', ') || 'none'}) — solve the challenge on the AnimePahe tab first.`
        )
      } else {
        toast.error('Helper request failed — try again.')
      }
    }
    replyRef.current = onReply
    window.addEventListener('dango:pahe-cookie', onReply)
    window.dispatchEvent(new CustomEvent('dango:get-pahe-cookie'))
  }

  const handleSubmitCookie = () => {
    const trimmed = cookie.trim()
    if (!trimmed) {
      toast.error('Please enter the cf_clearance cookie')
      return
    }

    try {
      localStorage.setItem('animepahe_cookie', trimmed)
      toast.success('Cookie updated successfully! Reloading…')
      onSuccess?.()
      onClose()
      window.setTimeout(() => window.location.reload(), 1000)
    } catch {
      toast.error('Failed to save cookie')
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
              <textarea value={userAgent} readOnly rows={3} className={styles.textarea} />
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
              <strong>Either browser &mdash; extension:</strong> open{' '}
              <strong>Cookie Manager</strong> while on the AnimePahe tab, find{' '}
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
              <button className={styles.button} onClick={handleSubmitCookie}>
                Submit
              </button>
            </div>
          </>
        )}
      </div>
    </GenericModal>
  )
}

export default AnimePaheCookieModal
