import { useEffect, useState, type ReactNode } from 'react'
import { Toaster } from 'react-hot-toast'
import type { Profile } from '../../../server/src/profile.types'
import { fetchApi } from '../lib/fetchApi'
import { setActiveProfileId, reloadProfiles } from '../lib/profileStorage'
import LanAuthModal from './modals/LanAuthModal'
import { Button } from './common/Button'
import Icon from './common/Icon'
import ProfileAvatar from './common/ProfileAvatar'
import styles from './settings/Profiles.module.css'

type View = 'pick' | 'password' | 'create'

export default function ProfileGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [lanLocked, setLanLocked] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selected, setSelected] = useState('')
  const [view, setView] = useState<View>('pick')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const [ownerPassword, setOwnerPassword] = useState('')
  const [newName, setNewName] = useState('')
  const [newPassword, setNewPassword] = useState('')

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

  const login = async (id: string, value: string) => {
    setBusy(true)
    setError('')
    try {
      await fetchApi('/api/profiles/login', {
        method: 'POST',
        body: JSON.stringify({ id, password: value }),
      })
      reloadProfiles()
    } catch (error) {
      setError((error as Error).message)
      setBusy(false)
    }
  }

  const choose = (profile: Profile) => {
    setError('')
    setPassword('')
    setSelected(profile.id)
    if (profile.protected) setView('password')
    else void login(profile.id, '')
  }

  const back = () => {
    setView('pick')
    setPassword('')
    setError('')
  }

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

      {view === 'pick' && (
        <section className={styles.gateInner}>
          <h1 className={styles.gateTitle}>
            {profiles.length ? "Who's watching?" : 'Connecting to Dango…'}
          </h1>
          {profiles.length > 0 && (
            <div className={styles.profileGrid}>
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  className={styles.profileCard}
                  disabled={busy}
                  onClick={() => choose(profile)}
                >
                  <span className={styles.profileCardAvatar}>
                    <ProfileAvatar
                      image={profile.avatar ?? profile.cloudAvatar}
                      name={profile.name}
                      size="100%"
                      radius="18%"
                    />
                    {profile.protected && (
                      <span className={styles.lockBadge} aria-hidden="true">
                        <Icon name="lock" size="0.85rem" />
                      </span>
                    )}
                  </span>
                  <span className={styles.profileCardName}>
                    {profile.name}
                    {profile.owner && <span className={styles.ownerTag}>Owner</span>}
                  </span>
                </button>
              ))}
              <button
                type="button"
                className={styles.profileCard}
                disabled={busy}
                onClick={() => {
                  setError('')
                  setView('create')
                }}
              >
                <span className={`${styles.profileCardAvatar} ${styles.addAvatar}`}>
                  <Icon name="plus" size={40} />
                </span>
                <span className={styles.profileCardName}>Add profile</span>
              </button>
            </div>
          )}
          {error && (
            <>
              <p role="alert" className={styles.gateError}>
                {error}
              </p>
              {!profiles.length && (
                <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>
                  Retry
                </Button>
              )}
            </>
          )}
        </section>
      )}

      {view === 'password' && profile && (
        <section className={styles.gatePanel}>
          <button type="button" className={styles.backButton} onClick={back}>
            <Icon name="chevron-left" />
            Back
          </button>
          <div className={styles.panelAvatar}>
            <ProfileAvatar
              image={profile.avatar ?? profile.cloudAvatar}
              name={profile.name}
              size="100%"
              radius="18%"
            />
          </div>
          <h2 className={styles.panelTitle}>{profile.name}</h2>
          <form
            className={styles.gateForm}
            onSubmit={(event) => {
              event.preventDefault()
              void login(selected, password)
            }}
          >
            <label className={styles.gateField}>
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
            <Button type="submit" className="btn-block" loading={busy}>
              Continue
            </Button>
          </form>
          {error && (
            <p role="alert" className={styles.gateError}>
              {error}
            </p>
          )}
        </section>
      )}

      {view === 'create' && (
        <section className={styles.gatePanel}>
          <button type="button" className={styles.backButton} onClick={back}>
            <Icon name="chevron-left" />
            Back
          </button>
          <h2 className={styles.panelTitle}>Add a profile</h2>
          <p className={styles.gateHint}>Enter the owner password to create a new profile.</p>
          <form
            className={styles.gateForm}
            onSubmit={async (event) => {
              event.preventDefault()
              setBusy(true)
              setError('')
              try {
                const created: Profile = await fetchApi('/api/profiles/create', {
                  method: 'POST',
                  body: JSON.stringify({
                    name: newName,
                    password: newPassword,
                    ownerPassword,
                  }),
                })
                setProfiles((profiles) => [...profiles, created])
                setOwnerPassword('')
                setNewName('')
                setNewPassword('')
                setView('pick')
                setSelected(created.id)
                if (created.protected) setView('password')
                else await login(created.id, '')
              } catch (error) {
                setError((error as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            <label className={styles.gateField}>
              Owner password
              <input
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
                value={ownerPassword}
                onChange={(event) => setOwnerPassword(event.currentTarget.value)}
              />
            </label>
            <label className={styles.gateField}>
              Profile name
              <input
                required
                maxLength={60}
                value={newName}
                onChange={(event) => setNewName(event.currentTarget.value)}
              />
            </label>
            <label className={styles.gateField}>
              Profile password (optional)
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={256}
                value={newPassword}
                onChange={(event) => setNewPassword(event.currentTarget.value)}
              />
            </label>
            <Button type="submit" className="btn-block" loading={busy}>
              Create profile
            </Button>
          </form>
          {error && (
            <p role="alert" className={styles.gateError}>
              {error}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
