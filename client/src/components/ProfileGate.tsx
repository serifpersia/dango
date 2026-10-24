import { useEffect, useState, type ReactNode } from 'react'
import { Toaster } from 'react-hot-toast'
import type { Profile } from '../../../server/src/profile.types'
import { fetchApi } from '../lib/fetchApi'
import { setActiveProfileId, reloadProfiles } from '../lib/profileStorage'
import LanAuthModal from './modals/LanAuthModal'
import { Button } from './common/Button'
import ProfileAvatar from './common/ProfileAvatar'
import styles from './settings/Profiles.module.css'

export default function ProfileGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [lanLocked, setLanLocked] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selected, setSelected] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError('')
    const check = async () => {
      const lan = await fetchApi('/api/auth/app-status')
      if (cancelled) return
      if (lan.hasPassword && !lan.isAuthenticated) {
        setLanLocked(true)
        return
      }
      const status: { profiles: Profile[]; current: Profile | null } =
        await fetchApi('/api/profiles/status')
      if (cancelled) return
      if (status.current) {
        setActiveProfileId(status.current.id)
        setReady(true)
      } else {
        setProfiles(status.profiles)
        setSelected(status.profiles[0]?.id ?? '')
      }
    }
    check().catch((error) => {
      if (!cancelled) setError(error.message)
    })
    return () => {
      cancelled = true
    }
  }, [retry])

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === 'dango:profile-session-change') window.location.reload()
    }
    const expired = () => {
      setReady(false)
      setRetry((value) => value + 1)
    }
    window.addEventListener('storage', changed)
    window.addEventListener('dango:profile-auth-required', expired)
    return () => {
      window.removeEventListener('storage', changed)
      window.removeEventListener('dango:profile-auth-required', expired)
    }
  }, [])

  if (ready) return children
  const profile = profiles.find((profile) => profile.id === selected)
  return (
    <div className={styles.gate}>
      <Toaster />
      <LanAuthModal
        isOpen={lanLocked}
        onClose={() => {}}
        onSuccess={() => {
          setLanLocked(false)
          setRetry((value) => value + 1)
        }}
      />
      <section className={styles.panel}>
        <h1>{profiles.length ? 'Choose your profile' : 'Connecting to Dango…'}</h1>
        {profile && (
          <>
            <div className={styles.avatarRow}>
              <ProfileAvatar image={profile.avatar ?? profile.cloudAvatar} name={profile.name} />
            </div>
            <form
              className={styles.form}
              onSubmit={async (event) => {
                event.preventDefault()
                setBusy(true)
                setError('')
                try {
                  await fetchApi('/api/profiles/login', {
                    method: 'POST',
                    body: JSON.stringify({ id: selected, password }),
                  })
                  reloadProfiles()
                } catch (error) {
                  setError((error as Error).message)
                  setBusy(false)
                }
              }}
            >
              <label className={styles.field}>
                Profile
                <select
                  value={selected}
                  onChange={(event) => {
                    setSelected(event.currentTarget.value)
                    setPassword('')
                    setError('')
                  }}
                >
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                      {profile.owner ? ' (owner)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {profile.protected && (
                <label className={styles.field}>
                  Password
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={256}
                    value={password}
                    onChange={(event) => setPassword(event.currentTarget.value)}
                  />
                </label>
              )}
              <Button type="submit" loading={busy}>
                Continue
              </Button>
            </form>
          </>
        )}
        {error && (
          <>
            <p role="alert">{error}</p>
            <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>
              Retry
            </Button>
          </>
        )}
      </section>
    </div>
  )
}
