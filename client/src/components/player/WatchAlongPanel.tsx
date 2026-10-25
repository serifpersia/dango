import { Link } from 'react-router'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../common/Button'
import { useWatchAlong } from '../../contexts/WatchAlongContext'
import type { WatchPlayback } from '../../lib/watchAlong'
import styles from './WatchAlongPanel.module.css'

export function WatchAlongName() {
  const watch = useWatchAlong()
  return (
    <label className={styles.name}>
      Display name
      <input
        value={watch.displayName}
        onChange={(e) => watch.setDisplayName(e.currentTarget.value)}
        maxLength={32}
        placeholder="Your name (optional)"
        autoComplete="nickname"
      />
      <small>Remembered for this profile on this browser.</small>
    </label>
  )
}

export default function WatchAlongPanel({
  playback,
  onCreate,
  needsPlayback,
  onEnablePlayback,
}: {
  playback?: WatchPlayback | null
  onCreate?: () => void
  needsPlayback?: boolean
  onEnablePlayback?: () => void
}) {
  const watch = useWatchAlong()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const panelRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (panelRef.current && (watch.session || needsPlayback)) panelRef.current.open = true
  }, [watch.session, needsPlayback])
  const invite = watch.session
    ? `${watch.workerUrl}/join#${watch.session.id}.${watch.session.guestToken}`
    : ''

  return (
    <details ref={panelRef} className={styles.panel} aria-label="Watch along">
      <summary className={styles.summary}>
        Watch along
        {watch.session ? (watch.session.host ? ' · You are hosting' : ' · Following host') : ''}
      </summary>
      <div className={styles.heading}>
        {watch.session ? (
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                setShowInvite(true)
                try {
                  await navigator.clipboard.writeText(invite)
                  setMessage('Invite copied')
                } catch {
                  setMessage('Copy the invite below')
                }
              }}
            >
              Copy invite
            </Button>
            <Button size="sm" variant="ghost" onClick={watch.leave}>
              {watch.session.host ? 'End room' : 'Leave room'}
            </Button>
          </div>
        ) : (
          <div className={styles.actions}>
            {onCreate && (
              <Button
                size="sm"
                loading={busy}
                disabled={!playback || !watch.workerUrl}
                onClick={async () => {
                  if (!playback) return
                  setBusy(true)
                  setMessage('')
                  try {
                    onCreate()
                    await watch.create({ ...playback, playing: false })
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : 'Could not create room')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Create room
              </Button>
            )}
            <Link to="/watch-along">Join a room</Link>
          </div>
        )}
      </div>
      <WatchAlongName />
      {!watch.session && (
        <p>
          Direct HLS only. Each viewer needs their own dango. Room controls use the shared
          watch-along service.
        </p>
      )}
      {watch.session && (
        <p>
          {watch.connected
            ? watch.room?.hostOnline
              ? 'Connected'
              : 'Host disconnected. Room closes after 60 seconds unless they reconnect'
            : 'Connecting…'}{' '}
          · Provider and source follow the host. Volume and subtitles stay yours.
        </p>
      )}
      {watch.room && (
        <p>
          {watch.session?.host && 'End the room when you are finished watching. '}
          Rooms automatically close six hours after creation. This room expires at{' '}
          <time dateTime={new Date(watch.room.expiresAt).toISOString()}>
            {new Date(watch.room.expiresAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
          , even if playback is still active.
        </p>
      )}
      {watch.room && (
        <ul className={styles.members}>
          {watch.room.members.map((member, index) => (
            <li key={member.id}>
              {member.name || (member.host ? 'Host' : `Guest ${index + 1}`)}
              {member.name && member.host ? ' (host)' : ''}
              {member.id === watch.selfId ? ' (you)' : ''}: {member.status}
            </li>
          ))}
        </ul>
      )}
      {needsPlayback && (
        <Button size="sm" onClick={onEnablePlayback}>
          Enable playback
        </Button>
      )}
      {showInvite && watch.session && (
        <input
          aria-label="Room invite"
          readOnly
          value={invite}
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      {(watch.error || message) && <p role="status">{watch.error || message}</p>}
    </details>
  )
}
