import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import styles from './DiscordCommunityPromo.module.css'

const PROMO_DISMISSED_KEY = 'discord_community_promo_dismissed'
const SHOW_DELAY_MS = 4500

interface DiscordCommunityPromoProps {
  workerUrl: string
}

export default function DiscordCommunityPromo({ workerUrl }: DiscordCommunityPromoProps) {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const dismissed = useRef(false)

  useEffect(() => {
    if (localStorage.getItem(PROMO_DISMISSED_KEY) === 'true') return
    if (localStorage.getItem('dango_discord_user')) return
    const t = setTimeout(() => setVisible(true), SHOW_DELAY_MS)
    return () => clearTimeout(t)
  }, [])

  const dismiss = () => {
    if (dismissed.current) return
    dismissed.current = true
    setVisible(false)
    localStorage.setItem(PROMO_DISMISSED_KEY, 'true')
  }

  const goSettings = () => {
    dismiss()
    navigate('/settings?tab=community')
  }

  if (!workerUrl) return null

  return (
    <div className={`${styles.promoWrapper} ${visible ? styles.visible : ''}`} aria-live="polite">
      <div className={styles.panel}>
        <button className={styles.closeBtn} onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>

        <div className={styles.header}>
          <div className={styles.discordIcon}>
            <svg width="20" height="16" viewBox="0 0 71 55" fill="white" aria-hidden="true">
              <path d="M60.1 4.9A58.5 58.5 0 0 0 45.5.3a.22.22 0 0 0-.23.11 40.8 40.8 0 0 0-1.8 3.7 54 54 0 0 0-16.2 0 37.5 37.5 0 0 0-1.83-3.7.23.23 0 0 0-.23-.11A58.3 58.3 0 0 0 10.9 4.9a.2.2 0 0 0-.1.08C1.58 18.73-1 32.23.31 45.55a.24.24 0 0 0 .09.17 58.8 58.8 0 0 0 17.7 8.95.23.23 0 0 0 .25-.08 42 42 0 0 0 3.61-5.88.22.22 0 0 0-.12-.31 38.7 38.7 0 0 1-5.53-2.64.23.23 0 0 1-.02-.37 29 29 0 0 0 1.1-.86.22.22 0 0 1 .23-.03c11.6 5.3 24.14 5.3 35.6 0a.22.22 0 0 1 .23.03c.36.3.73.58 1.1.86a.23.23 0 0 1-.02.37 36.4 36.4 0 0 1-5.53 2.64.22.22 0 0 0-.12.31 47.1 47.1 0 0 0 3.61 5.88.22.22 0 0 0 .25.08 58.6 58.6 0 0 0 17.72-8.95.23.23 0 0 0 .09-.16c1.47-15.27-2.47-28.65-10.46-40.47a.18.18 0 0 0-.09-.09ZM23.73 37.55c-3.49 0-6.37-3.21-6.37-7.15s2.82-7.15 6.37-7.15c3.58 0 6.42 3.24 6.37 7.15 0 3.94-2.82 7.15-6.37 7.15Zm23.54 0c-3.49 0-6.37-3.21-6.37-7.15s2.82-7.15 6.37-7.15c3.58 0 6.42 3.24 6.37 7.15 0 3.94-2.79 7.15-6.37 7.15Z" />
            </svg>
          </div>
          <div className={styles.headerText}>
            <h4>Join the Dango Community</h4>
            <p>Earn roles based on your watch stats</p>
          </div>
        </div>

        <div className={styles.body}>
          <p style={{ margin: '0 0 6px' }}>
            Connect your Discord account and earn exclusive server roles based on how much you
            watch:
          </p>
          <div className={styles.rolePreview}>
            <span className={`${styles.badge} ${styles.badgeRank}`}>S-Rank</span>
            <span className={`${styles.badge} ${styles.badgeRank}`}>F–A Rank</span>
            <span className={`${styles.badge} ${styles.badgeDere}`}>Tsundere</span>
            <span className={`${styles.badge} ${styles.badgeDere}`}>Kamidere…</span>
          </div>
        </div>

        <div className={styles.actions}>
          <a
            className={styles.btnJoin}
            href="https://discord.gg/6yPAZjDzg8"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg width="16" height="12" viewBox="0 0 71 55" fill="currentColor" aria-hidden="true">
              <path d="M60.1 4.9A58.5 58.5 0 0 0 45.5.3a.22.22 0 0 0-.23.11 40.8 40.8 0 0 0-1.8 3.7 54 54 0 0 0-16.2 0 37.5 37.5 0 0 0-1.83-3.7.23.23 0 0 0-.23-.11A58.3 58.3 0 0 0 10.9 4.9a.2.2 0 0 0-.1.08C1.58 18.73-1 32.23.31 45.55a.24.24 0 0 0 .09.17 58.8 58.8 0 0 0 17.7 8.95.23.23 0 0 0 .25-.08 42 42 0 0 0 3.61-5.88.22.22 0 0 0-.12-.31 38.7 38.7 0 0 1-5.53-2.64.23.23 0 0 1-.02-.37 29 29 0 0 0 1.1-.86.22.22 0 0 1 .23-.03c11.6 5.3 24.14 5.3 35.6 0a.22.22 0 0 1 .23.03c.36.3.73.58 1.1.86a.23.23 0 0 1-.02.37 36.4 36.4 0 0 1-5.53 2.64.22.22 0 0 0-.12.31 47.1 47.1 0 0 0 3.61 5.88.22.22 0 0 0 .25.08 58.6 58.6 0 0 0 17.72-8.95.23.23 0 0 0 .09-.16c1.47-15.27-2.47-28.65-10.46-40.47a.18.18 0 0 0-.09-.09ZM23.73 37.55c-3.49 0-6.37-3.21-6.37-7.15s2.82-7.15 6.37-7.15c3.58 0 6.42 3.24 6.37 7.15 0 3.94-2.82 7.15-6.37 7.15Zm23.54 0c-3.49 0-6.37-3.21-6.37-7.15s2.82-7.15 6.37-7.15c3.58 0 6.42 3.24 6.37 7.15 0 3.94-2.79 7.15-6.37 7.15Z" />
            </svg>
            Join Discord Server
          </a>
          <button className={styles.btnSettings} onClick={goSettings}>
            <span>⚙</span> Get Roles &amp; Settings
          </button>
        </div>

        <button className={styles.skipLink} onClick={dismiss}>
          Skip — don&apos;t show again
        </button>

        <p className={styles.hint}>You can always find this in Settings → Community</p>
      </div>
    </div>
  )
}
