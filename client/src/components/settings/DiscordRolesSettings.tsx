import { useCallback, useEffect, useState } from 'react'
import { fetchApi } from '../../lib/fetchApi'
import styles from './DiscordRolesSettings.module.css'

const RANK_THRESHOLDS = [
  { label: 'F-Rank', hours: 0 },
  { label: 'E-Rank', hours: 5 },
  { label: 'D-Rank', hours: 20 },
  { label: 'C-Rank', hours: 50 },
  { label: 'B-Rank', hours: 100 },
  { label: 'A-Rank', hours: 200 },
  { label: 'S-Rank', hours: 400 },
]

const GENRE_DERE_MAP: Record<string, string> = {
  fantasy: 'Kamidere',
  action: 'Kamidere',
  isekai: 'Kamidere',
  magic: 'Kamidere',
  'super power': 'Megadere',
  adventure: 'Himedere',
  'martial arts': 'Himedere',
  family: 'Himedere',
  comedy: 'Bakadere',
  shounen: 'Bakadere',
  parody: 'Bakadere',
  sports: 'Undere',
  music: 'Deredere',
  romance: 'Deredere',
  ecchi: 'Deredere',
  harem: 'Deredere',
  drama: 'Dandere',
  'slice of life': 'Dandere',
  yuri: 'Dandere',
  'school life': 'Dandere',
  'high school': 'Tsundere',
  school: 'Tsundere',
  military: 'Tsundere',
  shoujo: 'Tsundere',
  seinen: 'Kuudere',
  'sci-fi': 'Kuudere',
  'science fiction': 'Kuudere',
  mystery: 'Kuudere',
  mecha: 'Kuudere',
  josei: 'Kuudere',
  psychological: 'Yandere',
  horror: 'Yandere',
  thriller: 'Sadodere',
  supernatural: 'Dorodere',
  demons: 'Dorodere',
  game: 'Oujidere',
  historical: 'Kanedere',
}

function calculateDere(topGenre: string): string {
  return GENRE_DERE_MAP[(topGenre || '').toLowerCase().trim()] || 'Tsundere'
}

function getAllDereForGenres(genres: string[]): string[] {
  const dereSet = new Set<string>()
  for (const g of genres) {
    const dere = GENRE_DERE_MAP[g.toLowerCase().trim()]
    if (dere) dereSet.add(dere)
  }
  return [...dereSet]
}

const DERE_ARCHETYPES = [
  { name: 'Tsundere', genres: 'Romance, School, Shoujo, Military, High School' },
  { name: 'Yandere', genres: 'Psychological, Horror' },
  { name: 'Kuudere', genres: 'Seinen, Sci-Fi, Mystery, Mecha, Josei' },
  { name: 'Dandere', genres: 'Drama, Slice of Life, Yuri, School Life' },
  { name: 'Deredere', genres: 'Romance, Ecchi, Harem, Music' },
  { name: 'Bakadere', genres: 'Comedy, Shounen, Parody' },
  { name: 'Kamidere', genres: 'Fantasy, Action, Isekai, Magic' },
  { name: 'Dorodere', genres: 'Supernatural, Demons' },
  { name: 'Himedere', genres: 'Adventure, Martial Arts, Family' },
  { name: 'Sadodere', genres: 'Thriller' },
  { name: 'Undere', genres: 'Sports' },
  { name: 'Megadere', genres: 'Super Power' },
  { name: 'Oujidere', genres: 'Game' },
  { name: 'Kanedere', genres: 'Historical' },
]

function calculateRank(totalHours: number): string {
  if (totalHours >= 400) return 'S-Rank'
  if (totalHours >= 200) return 'A-Rank'
  if (totalHours >= 100) return 'B-Rank'
  if (totalHours >= 50) return 'C-Rank'
  if (totalHours >= 20) return 'D-Rank'
  if (totalHours >= 5) return 'E-Rank'
  return 'F-Rank'
}

function getRankProgress(hours: number): {
  pct: number
  current: string
  next: string
  nextHours: number
} {
  const idx = [...RANK_THRESHOLDS].reverse().findIndex((r) => hours >= r.hours)
  const rankIdx = idx === -1 ? 0 : RANK_THRESHOLDS.length - 1 - idx
  const current = RANK_THRESHOLDS[rankIdx].label
  const next = rankIdx < RANK_THRESHOLDS.length - 1 ? RANK_THRESHOLDS[rankIdx + 1] : null
  if (!next) return { pct: 100, current, next: 'MAX', nextHours: 0 }
  const prev = RANK_THRESHOLDS[rankIdx].hours
  const segments = RANK_THRESHOLDS.length - 1
  const intra = (hours - prev) / (next.hours - prev)
  const pct = Math.min(100, ((rankIdx + intra) / segments) * 100)
  return { pct, current, next: next.label, nextHours: next.hours - hours }
}

interface DiscordUser {
  id: string
  username: string
  avatar: string | null
}

interface SyncStats {
  totalSeconds: number
  topGenre: string
  genres?: string[]
  dere?: string[]
}

interface StatusMsg {
  type: 'success' | 'error' | 'info'
  text: string
}

const DISCORD_USER_KEY = 'dango_discord_user'

interface DiscordRolesSettingsProps {
  workerUrl?: string
}

export default function DiscordRolesSettings({ workerUrl }: DiscordRolesSettingsProps) {
  const [user, setUser] = useState<DiscordUser | null>(() => {
    try {
      const saved = localStorage.getItem(DISCORD_USER_KEY)
      if (saved) return JSON.parse(saved)
    } catch {
      // ignore
    }
    try {
      const searchParams = new URLSearchParams(window.location.search)
      const discordUser = searchParams.get('discord_user')
      if (discordUser) {
        return JSON.parse(discordUser)
      }
    } catch {
      // ignore
    }
    return null
  })
  const [stats, setStats] = useState<SyncStats | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState<StatusMsg | null>(null)
  const [loadingUser, setLoadingUser] = useState(() => !user)

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const discordUserParam = searchParams.get('discord_user')
    if (discordUserParam) {
      try {
        const parsed = JSON.parse(discordUserParam) as DiscordUser
        if (parsed && parsed.id) {
          setUser(parsed)
          setLoadingUser(false)
          localStorage.setItem(DISCORD_USER_KEY, JSON.stringify(parsed))
          fetch('/api/discord-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: parsed }),
          }).catch(() => {})
        }
      } catch {
        // ignore
      }
      searchParams.delete('discord_user')
      window.history.replaceState(
        null,
        '',
        window.location.pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '')
      )
    }
  }, [])

  const loadUser = useCallback(async () => {
    if (user) {
      setLoadingUser(false)
      return
    }
    try {
      const data = (await fetchApi('/api/discord-user')) as { user: DiscordUser | null }
      if (data.user) {
        setUser(data.user)
        localStorage.setItem(DISCORD_USER_KEY, JSON.stringify(data.user))
      }
    } catch {
      // ignore
    } finally {
      setLoadingUser(false)
    }
  }, [user])

  const fetchStats = useCallback(async () => {
    try {
      const data = (await fetchApi('/api/insights/discord-sync-stats')) as SyncStats
      setStats(data)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    loadUser()
    fetchStats()
  }, [loadUser, fetchStats])

  const handleUnlink = () => {
    localStorage.removeItem(DISCORD_USER_KEY)
    setUser(null)
    setStatus(null)
    fetch('/api/discord-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: null }),
    }).catch(() => {})
  }

  const handleSync = async () => {
    if (!user || !stats) return
    setSyncing(true)
    setStatus(null)
    try {
      const res = await fetch('/api/discord-sync-now', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setStatus({ type: 'success', text: `✅ ${data.message}` })
      } else {
        setStatus({ type: 'error', text: `❌ ${data.error || data.message || 'Sync failed'}` })
      }
    } catch {
      setStatus({ type: 'error', text: '❌ Network error — check your connection' })
    } finally {
      setSyncing(false)
    }
  }

  const totalHours = stats ? Math.round(stats.totalSeconds / 3600) : 0
  const currentRank = calculateRank(totalHours)
  const currentDere = stats ? calculateDere(stats.topGenre) : '—'
  const activeDereTypes =
    stats?.dere ||
    (stats?.genres ? getAllDereForGenres(stats.genres) : currentDere ? [currentDere] : [])
  const { pct, next, nextHours } = getRankProgress(totalHours)

  const avatarUrl = user?.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}?size=80`
    : null

  return (
    <>
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.discordBadge}>
            <svg width="20" height="15" viewBox="0 0 71 55" fill="white" aria-hidden="true">
              <path d="M60.1 4.9A58.5 58.5 0 0 0 45.5.3a.22.22 0 0 0-.23.11 40.8 40.8 0 0 0-1.8 3.7 54 54 0 0 0-16.2 0 37.5 37.5 0 0 0-1.83-3.7.23.23 0 0 0-.23-.11A58.3 58.3 0 0 0 10.9 4.9a.2.2 0 0 0-.1.08C1.58 18.73-1 32.23.31 45.55a.24.24 0 0 0 .09.17 58.8 58.8 0 0 0 17.7 8.95.23.23 0 0 0 .25-.08 42 42 0 0 0 3.61-5.88.22.22 0 0 0-.12-.31 38.7 38.7 0 0 1-5.53-2.64.23.23 0 0 1-.02-.37 29 29 0 0 0 1.1-.86.22.22 0 0 1 .23-.03c11.6 5.3 24.14 5.3 35.6 0a.22.22 0 0 1 .23.03c.36.3.73.58 1.1.86a.23.23 0 0 1-.02.37 36.4 36.4 0 0 1-5.53 2.64.22.22 0 0 0-.12.31 47.1 47.1 0 0 0 3.61 5.88.22.22 0 0 0 .25.08 58.6 58.6 0 0 0 17.72-8.95.23.23 0 0 0 .09-.16c1.47-15.27-2.47-28.65-10.46-40.47a.18.18 0 0 0-.09-.09ZM23.73 37.55c-3.49 0-6.37-3.21-6.37-7.15s2.82-7.15 6.37-7.15c3.58 0 6.42 3.24 6.37 7.15 0 3.94-2.82 7.15-6.37 7.15Zm23.54 0c-3.49 0-6.37-3.21-6.37-7.15s2.82-7.15 6.37-7.15c3.58 0 6.42 3.24 6.37 7.15 0 3.94-2.79 7.15-6.37 7.15Z" />
            </svg>
          </div>
          <div>
            <p className={styles.cardTitle}>Discord Account</p>
            <p className={styles.cardSub}>Link your Discord to earn community roles</p>
          </div>
        </div>

        {loadingUser ? (
          <p className={styles.notice}>Loading…</p>
        ) : user ? (
          <>
            <div className={styles.userRow}>
              {avatarUrl ? (
                <img className={styles.avatar} src={avatarUrl} alt={user.username} />
              ) : (
                <div className={styles.avatarPlaceholder}>👤</div>
              )}
              <div>
                <p className={styles.userName}>{user.username}</p>
                <p className={styles.userId}>ID: {user.id}</p>
              </div>
              <button
                className={styles.btnUnlink}
                onClick={handleUnlink}
                title="Disconnect your Discord account"
              >
                Disconnect
              </button>
            </div>

            <p className={styles.notice}>
              The following data is shared with the Dango community service to assign roles:
            </p>
            <ul className={styles.shareList}>
              <li>Total watch time (hours)</li>
              <li>Top 3 watched genres</li>
              <li>Discord user ID + username</li>
            </ul>
          </>
        ) : (
          <>
            <p className={styles.description}>
              Sign in with Discord (OAuth) to link your account. Only your public username and ID
              are stored — no email or DMs.
            </p>
            <div className={styles.actions}>
              <button
                className={styles.btnPrimary}
                onClick={() => {
                  const returnUrl = encodeURIComponent(
                    window.location.origin + '/settings?tab=community'
                  )
                  const loginUrl = `${workerUrl}/auth/login?return_to=${returnUrl}`
                  window.location.href = loginUrl
                }}
              >
                Login with Discord
              </button>
              <a
                className={styles.btnSecondary}
                href="https://discord.gg/2FTSPXCsvn"
                target="_blank"
                rel="noopener noreferrer"
              >
                Join Server
              </a>
            </div>
          </>
        )}
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <p className={styles.cardTitle}>Your Roles</p>
            <p className={styles.cardSub}>Based on your current Dango watch history</p>
          </div>
        </div>

        {stats ? (
          <>
            <div className={styles.statsRow}>
              <div className={styles.statBox}>
                <span className={styles.statValue}>{totalHours}h</span>
                <span className={styles.statLabel}>Watch Time</span>
              </div>
              <div className={styles.statBox}>
                <span className={styles.statValue}>{stats.topGenre || '—'}</span>
                <span className={styles.statLabel}>Top Genre</span>
              </div>
            </div>

            <div className={styles.rolePreview}>
              <span className={`${styles.badge} ${styles.badgeRank}`}>{currentRank}</span>
              <span className={`${styles.badge} ${styles.badgeDere}`}>{currentDere}</span>
            </div>

            <div className={styles.progressSection}>
              <div className={styles.progressLabel}>
                <span>Progress to {next}</span>
                <span>{next === 'MAX' ? 'MAX' : `${nextHours}h remaining`}</span>
              </div>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${pct}%` }} />
              </div>
              <div className={styles.tierList}>
                <span>0h (F)</span>
                <span>5h (E)</span>
                <span>20h (D)</span>
                <span>50h (C)</span>
                <span>100h (B)</span>
                <span>200h (A)</span>
                <span>400h (S)</span>
              </div>
            </div>

            <div className={styles.dereSection}>
              <p className={styles.sectionHeading}>Personality Archetypes</p>
              <div className={styles.dereGrid}>
                {DERE_ARCHETYPES.map((d) => {
                  const isActive = activeDereTypes.includes(d.name)
                  return (
                    <div
                      key={d.name}
                      className={`${styles.dereCard} ${isActive ? styles.dereCardActive : ''}`}
                    >
                      <span className={styles.dereName}>{d.name}</span>
                      <span className={styles.dereGenre}>{d.genres}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <hr className={styles.divider} />

            <div className={styles.actions}>
              <button
                className={styles.btnPrimary}
                onClick={handleSync}
                disabled={!user || syncing}
                id="discord-roles-sync-btn"
              >
                {syncing ? 'Syncing…' : 'Sync Roles'}
              </button>
              {!user && (
                <span
                  style={{
                    fontSize: '0.78rem',
                    color: 'var(--text-tertiary)',
                    alignSelf: 'center',
                  }}
                >
                  Login first to sync
                </span>
              )}
            </div>

            {status && (
              <p
                className={`${styles.statusMsg} ${
                  status.type === 'success'
                    ? styles.statusSuccess
                    : status.type === 'error'
                      ? styles.statusError
                      : styles.statusInfo
                }`}
              >
                {status.text}
              </p>
            )}
          </>
        ) : (
          <p className={styles.notice}>No watch data yet — start watching to earn roles!</p>
        )}
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <p className={styles.cardTitle}>Dango Discord Server</p>
            <p className={styles.cardSub}>Community, announcements and support</p>
          </div>
        </div>
        <div className={styles.actions}>
          <a
            className={styles.btnPrimary}
            href="https://discord.gg/2FTSPXCsvn"
            target="_blank"
            rel="noopener noreferrer"
          >
            Join the Server
          </a>
        </div>
      </div>
    </>
  )
}
