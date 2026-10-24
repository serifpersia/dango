import { useState } from 'react'
import { useLocation } from 'react-router'
import { useWatchAlong } from '../contexts/WatchAlongContext'
import { Button } from '../components/common/Button'
import WatchAlongPanel, { WatchAlongName } from '../components/player/WatchAlongPanel'
import styles from '../components/player/WatchAlongPanel.module.css'

export default function WatchAlong() {
  const watch = useWatchAlong()
  const location = useLocation()
  const [invite, setInvite] = useState(location.hash.slice(1))
  const [error, setError] = useState('')
  return (
    <div style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Watch along</h1>
      <p>
        Watch with friends across the internet. The host chooses the episode, provider, and source,
        and controls playback. Your dango streams your own video.
      </p>
      {watch.session && <WatchAlongPanel />}
      {!watch.session && (
        <form
          className={styles.panel}
          onSubmit={(event) => {
            event.preventDefault()
            try {
              watch.join(invite)
              setError('')
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Could not join room')
            }
          }}
        >
          <WatchAlongName />
          <label htmlFor="watch-invite">Invite link or room code</label>
          <input
            id="watch-invite"
            value={invite}
            onChange={(e) => setInvite(e.currentTarget.value)}
            required
            autoComplete="off"
          />
          <p>
            Joining shares your connection and playback readiness with the room service. Start a
            room from an episode using a direct HLS source.
          </p>
          <Button type="submit" disabled={!watch.workerUrl} style={{ marginTop: '1rem' }}>
            Join room
          </Button>
          {!watch.workerUrl && (
            <p>Watch along is unavailable. The server needs a watch-along service URL.</p>
          )}
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </div>
  )
}
