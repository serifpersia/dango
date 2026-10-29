import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '../../lib/fetchApi'
import { reloadProfiles } from '../../lib/profileStorage'
import { profileQuery } from '../../hooks/useProfile'
import { Button } from '../common/Button'
import ProfileAvatar from '../common/ProfileAvatar'
import { Modal } from '../common/Modal'
import Icon from '../common/Icon'
import type { Profile } from '../../../../server/src/profile.types'
import styles from './Profiles.module.css'
import sharedStyles from './Settings.module.css'

export default function ProfileSettings() {
  const { data: profile } = useQuery(profileQuery)
  const { data: status } = useQuery({
    queryKey: ['profiles'],
    queryFn: (): Promise<{ profiles: Profile[] }> => fetchApi('/api/profiles/status'),
    enabled: !!profile?.owner,
  })
  const queryClient = useQueryClient()
  const [name, setName] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newName, setNewName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<Profile | null>(null)

  const update = async (body: Record<string, unknown>) => {
    setBusy(true)
    setMessage('')
    try {
      await fetchApi('/api/profiles/update', { method: 'POST', body: JSON.stringify(body) })
      await queryClient.invalidateQueries({ queryKey: profileQuery.queryKey })
      setPassword('')
      setCurrentPassword('')
      setMessage('Profile saved')
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!profile) return null
  return (
    <section className={sharedStyles.sectionCard}>
      <h3>Your profile</h3>
      <p>
        Keep using this profile, rename it, or add another person with their own library and
        connections.
      </p>
      <div className={styles.avatarRow}>
        <ProfileAvatar image={profile.image} name={profile.name} />
        <label className={styles.uploadButton}>
          <Icon name="upload" />
          <span>Upload image</span>
          <input
            className={styles.fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={busy}
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (!file) return
              if (file.size > 2 * 1024 * 1024) {
                setMessage('Image must be smaller than 2 MB')
                return
              }
              const reader = new FileReader()
              reader.onerror = () => setMessage('Could not read image')
              reader.onload = () => {
                void update({ avatar: reader.result })
              }
              reader.readAsDataURL(file)
            }}
          />
        </label>
        {profile.avatar && (
          <Button variant="secondary" disabled={busy} onClick={() => update({ avatar: null })}>
            Clear uploaded image
          </Button>
        )}
      </div>
      <p>
        Your uploaded image takes priority, followed by your active cloud account image, then the
        default user icon.
      </p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          void update({ name: name ?? profile.name })
        }}
      >
        <label className={styles.field}>
          Profile name
          <input
            value={name ?? profile.name}
            maxLength={60}
            required
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <Button type="submit" disabled={busy}>
          Save name
        </Button>
      </form>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          void update({ password, currentPassword })
        }}
      >
        {profile.protected && (
          <label className={styles.field}>
            Current password
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              required
              maxLength={256}
              onChange={(event) => setCurrentPassword(event.currentTarget.value)}
            />
          </label>
        )}
        <label className={styles.field}>
          {profile.protected ? 'New password (empty removes protection)' : 'Protect this profile'}
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            minLength={8}
            maxLength={256}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
        </label>
        <Button type="submit" disabled={busy}>
          Save password
        </Button>
      </form>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await fetchApi('/api/profiles/logout', { method: 'POST' })
            reloadProfiles()
          } catch (error) {
            setMessage((error as Error).message)
            setBusy(false)
          }
        }}
      >
        Switch profile / sign out
      </Button>
      {profile.owner && (
        <form
          className={styles.form}
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setMessage('')
            try {
              await fetchApi('/api/profiles/create', {
                method: 'POST',
                body: JSON.stringify({ name: newName, password: newPassword }),
              })
              setNewName('')
              setNewPassword('')
              await queryClient.invalidateQueries({ queryKey: ['profiles'] })
              setMessage('Profile created. Sign out to switch to it.')
            } catch (error) {
              setMessage((error as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <h3>Add another profile</h3>
          <p>
            Protect your owner profile first. New profiles start empty and do not inherit your
            accounts. A profile without a password is accessible to anyone who passes the LAN lock.
          </p>
          <label className={styles.field}>
            Name
            <input
              required
              maxLength={60}
              value={newName}
              onChange={(event) => setNewName(event.currentTarget.value)}
            />
          </label>
          <label className={styles.field}>
            Password (optional)
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={256}
              value={newPassword}
              onChange={(event) => setNewPassword(event.currentTarget.value)}
            />
          </label>
          <Button type="submit" disabled={busy || !profile.protected}>
            Create profile
          </Button>
        </form>
      )}
      {profile.owner && status?.profiles.some((other) => !other.owner) && (
        <>
          <h3>Other profiles</h3>
          <ul className={styles.profileList}>
            {status.profiles
              .filter((other) => !other.owner)
              .map((other) => (
                <li key={other.id}>
                  <span className={styles.smallAvatar}>
                    <ProfileAvatar image={other.avatar ?? other.cloudAvatar} name={other.name} />
                  </span>
                  <span className={styles.profileName}>{other.name}</span>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setMessage('')
                      setDeleting(other)
                    }}
                  >
                    Delete
                  </Button>
                </li>
              ))}
          </ul>
        </>
      )}
      <Modal
        isOpen={!!deleting}
        onClose={busy ? undefined : () => setDeleting(null)}
        title="Delete profile?"
        width="sm"
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                if (!deleting) return
                setBusy(true)
                try {
                  await fetchApi('/api/profiles/delete', {
                    method: 'POST',
                    body: JSON.stringify({ id: deleting.id, confirm: true }),
                  })
                  await queryClient.invalidateQueries({ queryKey: ['profiles'] })
                  setDeleting(null)
                  setMessage('Profile deleted. Local files will be removed when Dango restarts.')
                } catch (error) {
                  setMessage((error as Error).message)
                  setDeleting(null)
                } finally {
                  setBusy(false)
                }
              }}
            >
              Delete profile
            </Button>
          </>
        }
      >
        <p>
          Delete <strong>{deleting?.name}</strong>? This signs them out immediately. Their local
          libraries, settings and connections will be removed when Dango next restarts.
        </p>
        <p>
          Cloud backups and tracker lists will stay intact. Export any library you want to keep
          before deleting.
        </p>
      </Modal>
      {message && <p role="status">{message}</p>}
    </section>
  )
}
