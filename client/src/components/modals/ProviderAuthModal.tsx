import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Modal } from '../common/Modal'
import styles from './ProviderAuthModal.module.css'
import { subscribeAnyAuthRequired } from '../../lib/auth-bus'
import { useProviders } from '../../hooks/useProviders'
import { setProviderCreds } from '../../lib/providerAuthStorage'
import { clearThumbnailCache } from '../../lib/utils'
import type { ProviderAuthSpec, ProviderOption } from '../../types/providers'

interface ResolvedSpec extends Omit<ProviderAuthSpec, 'type'> {
  type: 'cookie' | 'browser_verify'
  label: string
  cookieName: string
  needsUa: boolean
}

interface HelperReply {
  ok?: boolean
  cookie?: string
  error?: string
  requestId?: string
  debug?: { stores?: string[]; names?: string[] }
}

const HELPER_ZIP_URL =
  'https://github.com/serifpersia/dango/releases/latest/download/dango-extension.zip'
const HELPER_GET_EVENT = 'dango:get-provider-cookie'
const HELPER_REPLY_EVENT = 'dango:provider-cookie'

const parseReply = (event: Event): HelperReply | null => {
  try {
    return JSON.parse((event as CustomEvent<string>).detail) as HelperReply
  } catch {
    return null
  }
}

function resolveSpec(id: string, provider?: ProviderOption): ResolvedSpec {
  const auth = provider?.auth
  return {
    type: auth?.type ?? 'browser_verify',
    label: auth?.label ?? provider?.label ?? id,
    cookieName: auth?.cookieName ?? 'cf_clearance',
    needsUa: auth?.needsUa ?? true,
    siteUrl: auth?.siteUrl,
    instructions: auth?.instructions,
  }
}

function siteHost(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

function siteOrigin(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

export default function ProviderAuthModal() {
  const [providerId, setProviderId] = useState<string | null>(null)
  const [step, setStep] = useState<1 | 2>(1)
  const [userAgent, setUserAgent] = useState('')
  const [cookie, setCookie] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const replyRef = useRef<((event: Event) => void) | null>(null)
  const queryClient = useQueryClient()
  const { options } = useProviders()

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isAndroid = /android/i.test(ua)
  const isFirefoxDesktop = /firefox|fxios/i.test(ua) && !isAndroid
  const isChromeDesktop = !isFirefoxDesktop && !isAndroid && /chrome|chromium|edg|brave/i.test(ua)
  const showHelper = isFirefoxDesktop || isChromeDesktop

  useEffect(
    () =>
      subscribeAnyAuthRequired((kind) => {
        if (kind === 'lan') return
        setProviderId(kind)
      }),
    []
  )

  useEffect(() => {
    if (!providerId) return
    setStep(1)
    setUserAgent(typeof navigator !== 'undefined' ? navigator.userAgent : '')
    setCookie('')
    setSubmitting(false)
    setExtracting(false)
  }, [providerId])

  useEffect(
    () => () => {
      if (replyRef.current) {
        window.removeEventListener(HELPER_REPLY_EVENT, replyRef.current)
        replyRef.current = null
      }
    },
    []
  )

  const provider = providerId ? options.find((option) => option.id === providerId) : undefined
  const spec = providerId ? resolveSpec(providerId, provider) : null

  const close = () => setProviderId(null)

  const finish = () => {
    clearThumbnailCache()
    queryClient.invalidateQueries()
    close()
  }

  const openSite = () => {
    if (spec?.siteUrl) window.open(spec.siteUrl, '_blank', 'noopener,noreferrer')
    setStep(2)
  }

  const submitCookie = () => {
    if (!providerId || !spec) return
    const trimmed = cookie.trim()
    if (!trimmed) {
      toast.error(`Please enter the ${spec.cookieName} cookie`)
      return
    }
    setSubmitting(true)
    try {
      setProviderCreds(providerId, {
        cookie: trimmed,
        ...(spec.needsUa ? { ua: userAgent } : {}),
      })
      toast.success('Access saved')
      finish()
    } catch {
      toast.error('Failed to save credentials')
    } finally {
      setSubmitting(false)
    }
  }

  const host = siteHost(spec?.siteUrl)
  const origin = siteOrigin(spec?.siteUrl)

  const handleExtract = () => {
    if (extracting || !spec || !host || !origin) return
    setExtracting(true)
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    const timer = window.setTimeout(() => {
      setExtracting(false)
      if (replyRef.current) {
        window.removeEventListener(HELPER_REPLY_EVENT, replyRef.current)
        replyRef.current = null
      }
      toast.error('Helper not detected - install it via about:debugging first.')
    }, 3000)
    const onReply = (event: Event) => {
      const detail = parseReply(event)
      if (!detail || detail.requestId !== requestId) return
      window.clearTimeout(timer)
      window.removeEventListener(HELPER_REPLY_EVENT, onReply)
      replyRef.current = null
      setExtracting(false)
      if (detail.ok && detail.cookie) {
        setCookie(detail.cookie)
        toast.success('Cookie extracted from helper!')
      } else if (detail.error === 'NO_COOKIE') {
        const stores = detail.debug?.stores?.length ?? 0
        const names = detail.debug?.names ?? []
        toast.error(
          `Helper found no ${spec.cookieName} (checked ${stores} stores, saw: ${names.join(', ') || 'none'}) - solve the challenge on the ${spec.label} tab first.`
        )
      } else {
        toast.error('Helper request failed - try again.')
      }
    }
    replyRef.current = onReply
    window.addEventListener(HELPER_REPLY_EVENT, onReply)
    window.dispatchEvent(
      new CustomEvent(HELPER_GET_EVENT, {
        detail: JSON.stringify({
          requestId,
          domain: host,
          origin,
          cookieName: spec.cookieName,
        }),
      })
    )
  }

  return (
    <Modal
      isOpen={!!providerId}
      onClose={close}
      title={spec ? `${spec.label} Verification Required` : 'Verification Required'}
    >
      {spec && (
        <div className={styles.container}>
          {spec.type === 'browser_verify' ? (
            <>
              <p>
                {spec.instructions ??
                  `${spec.label} needs a browser verification. Open it in this browser, complete any challenge it shows, then return to Dango and click Refresh.`}
              </p>
              {spec.siteUrl && (
                <div className={styles.actions}>
                  <a
                    className={styles.link}
                    href={spec.siteUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open {spec.label}
                  </a>
                </div>
              )}
              <div className={styles.actions}>
                <button className={styles.secondaryButton} onClick={close}>
                  Cancel
                </button>
                <button className={styles.button} onClick={finish}>
                  Refresh Dango
                </button>
              </div>
            </>
          ) : step === 1 && spec.siteUrl ? (
            <>
              <p>
                {spec.instructions ??
                  `${spec.label} is protected by a Cloudflare challenge. Solve it once in your browser, then paste the ${spec.cookieName} cookie value so Dango can load it.`}
              </p>
              {spec.needsUa && (
                <div className={styles.field}>
                  <label>
                    Your User-Agent (must match the browser you solve the challenge with):
                  </label>
                  <textarea
                    value={userAgent}
                    onChange={(event) => setUserAgent(event.currentTarget.value)}
                    rows={3}
                    className={styles.textarea}
                  />
                </div>
              )}
              <div className={styles.actions}>
                <button className={styles.secondaryButton} onClick={close}>
                  Cancel
                </button>
                <button className={styles.button} onClick={openSite}>
                  Start Verification (Opens {spec.label})
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                1. Solve the challenge on the <strong>{spec.label} tab</strong> (keep it open).
                <br />
                2. Copy the <strong>{spec.cookieName}</strong> cookie value from your browser
                devtools
                {host ? (
                  <>
                    {' '}
                    (Application/Storage &rarr; Cookies &rarr; <code>{host}</code>)
                  </>
                ) : null}
                .
                <br />
                3. Paste only the value below (no <code>{spec.cookieName}=</code> prefix).
              </p>
              {spec.instructions && (
                <div className={styles.hint}>{spec.instructions}</div>
              )}
              {showHelper && host && (
                <div className={styles.hint}>
                  <strong>Dango helper (one-time setup):</strong>{' '}
                  {isFirefoxDesktop ? (
                    <>
                      type <code>about:debugging</code> in the address bar &rarr;{' '}
                      <strong>This Firefox</strong> &rarr; <strong>Load Temporary Add-on</strong>{' '}
                      &rarr; open the <code>dango-extension/firefox</code> folder and pick{' '}
                      <code>manifest.json</code>. (Temporary helpers unload when Firefox closes -
                      repeat after a restart.)
                    </>
                  ) : (
                    <>
                      type <code>chrome://extensions</code> in the address bar &rarr; enable{' '}
                      <strong>Developer mode</strong> &rarr; <strong>Load unpacked</strong> &rarr;
                      open the <code>dango-extension/chrome</code> folder. (Unpacked helpers show a
                      developer-mode notice - expected.)
                    </>
                  )}{' '}
                  Use this link to download the extension and extract it:{' '}
                  <a
                    className={styles.link}
                    href={HELPER_ZIP_URL}
                    target="_blank"
                    rel="noreferrer"
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
                <label>{spec.cookieName} cookie value:</label>
                <input
                  type="text"
                  value={cookie}
                  onChange={(event) => setCookie(event.currentTarget.value)}
                  placeholder="e.g. xxxxxxxx.xxxxxxxx.xxxxxxx-xxxxxxx"
                  className={styles.input}
                />
              </div>
              <div className={styles.actions}>
                <button className={styles.secondaryButton} onClick={close}>
                  Cancel
                </button>
                {spec.siteUrl && (
                  <button className={styles.secondaryButton} onClick={() => setStep(1)}>
                    Back
                  </button>
                )}
                <button
                  className={styles.button}
                  onClick={submitCookie}
                  disabled={submitting}
                >
                  {submitting ? 'Saving...' : 'Submit'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
