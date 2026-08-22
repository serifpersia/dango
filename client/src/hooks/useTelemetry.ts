import { useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import toast from 'react-hot-toast'
import packageJson from '../../package.json'

const TELEMETRY_URL = import.meta.env.VITE_TELEMETRY_URL

const getPrivacyFriendlyUserAgent = () => {
  const ua = navigator.userAgent
  let browser = 'Unknown Browser'
  let os = 'Unknown OS'

  if (ua.includes('Firefox')) browser = 'Firefox'
  else if (ua.includes('SamsungBrowser')) browser = 'Samsung Browser'
  else if (ua.includes('Opera') || ua.includes('OPR')) browser = 'Opera'
  else if (ua.includes('Trident')) browser = 'Internet Explorer'
  else if (ua.includes('Edge')) browser = 'Edge'
  else if (ua.includes('Chrome')) browser = 'Chrome'
  else if (ua.includes('Safari')) browser = 'Safari'

  if (ua.includes('Windows')) os = 'Windows'
  else if (ua.includes('Mac')) os = 'MacOS'
  else if (ua.includes('Linux')) os = 'Linux'
  else if (ua.includes('Android')) os = 'Android'
  else if (ua.includes('iPhone') || ua.includes('iPad') || ua.includes('iPod')) os = 'iOS'

  return `${browser} on ${os}`
}

export const deleteTelemetryData = async () => {
  localStorage.removeItem('last_telemetry_ping')
}

export const useTelemetry = () => {
  useEffect(() => {
    const isTelemetryEnabled = localStorage.getItem('telemetry_enabled') !== 'false'

    if (isTelemetryEnabled) {
      const noticeShown = localStorage.getItem('telemetry_notice_shown')
      if (!noticeShown) {
        localStorage.setItem('telemetry_notice_shown', 'true')
        setTimeout(() => {
          toast('Optional install data is collected. You can opt out in Settings.', {
            duration: 8000,
            icon: 'ℹ️',
            style: {
              background: '#1a3a5c',
              color: '#fff',
              border: '1px solid #2a5a8c',
            },
          })
        }, 3000)
      }
    }

    if (!isTelemetryEnabled || !TELEMETRY_URL) return

    const lastPing = localStorage.getItem('last_telemetry_ping')
    const now = Date.now()
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000

    if (lastPing && now - parseInt(lastPing) < TWENTY_FOUR_HOURS) {
      return
    }

    const sendPing = async () => {
      try {
        let installationId = localStorage.getItem('installation_id')

        if (!installationId || installationId.length === 36) {
          try {
            const res = await fetch('/api/installation-id')
            const data = await res.json()
            if (data.id) {
              installationId = data.id
              localStorage.setItem('installation_id', installationId!)
            }
          } catch (err) {
            console.error('Failed to fetch hardware ID:', err)
          }
        }

        if (!installationId) {
          installationId = uuidv4()
          localStorage.setItem('installation_id', installationId)
        }

        await fetch(TELEMETRY_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: installationId,
            version: packageJson.version,
            userAgent: getPrivacyFriendlyUserAgent(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        })
        localStorage.setItem('last_telemetry_ping', now.toString())
      } catch (err) {
        console.error('Telemetry ping failed:', err)
      }
    }

    sendPing()
  }, [])
}
