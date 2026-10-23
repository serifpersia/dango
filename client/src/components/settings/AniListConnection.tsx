import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { trpcClient } from '../../lib/trpc'
import { qk } from '../../lib/queryKeys'
import { useAnilistAuthCallback } from '../../hooks/useAnilistAuthCallback'
import Icon from '../common/Icon'
import styles from '../../pages/Trackers.module.css'

const CLIENT_ID_SETTING = 'tracker_anilist_client_id'
const SHIPPED_ANILIST_CLIENT_ID = (import.meta.env.VITE_ANILIST_CLIENT_ID || '').trim()
const hasShipped = !!SHIPPED_ANILIST_CLIENT_ID

export default function AniListConnection() {
  const queryClient = useQueryClient()
  const [clientIdInput, setClientIdInput] = useState('')
  const initialized = useRef(false)
  const isExchangingToken = useAnilistAuthCallback()
  const { data: status } = useQuery({
    queryKey: [qk.trackerStatus],
    queryFn: () => trpcClient.tracker.status.query(),
  })
  const { data: savedClientId } = useQuery({
    queryKey: [qk.anilistClientId],
    queryFn: async () =>
      (await trpcClient.settings.getByKey.query({ key: CLIENT_ID_SETTING })).value || '',
  })
  useEffect(() => {
    if (initialized.current || savedClientId === undefined) return
    if (savedClientId) setClientIdInput(savedClientId)
    initialized.current = true
  }, [savedClientId])

  const disconnect = useMutation({
    mutationFn: () => trpcClient.tracker.anilistDisconnect.mutate(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [qk.trackerStatus] })
      toast.success('Disconnected from AniList')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const resetClient = useMutation({
    mutationFn: () => trpcClient.settings.set.mutate({ key: CLIENT_ID_SETTING, value: '' }),
    onSuccess: () => {
      setClientIdInput('')
      queryClient.invalidateQueries({ queryKey: [qk.anilistClientId] })
      toast.success("Switched to dango's AniList app")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const login = async () => {
    const inputTrim = clientIdInput.trim()
    const clientId = inputTrim || SHIPPED_ANILIST_CLIENT_ID
    if (!clientId) {
      toast.error('Enter your AniList client ID first')
      return
    }
    const savedTrim = (savedClientId || '').trim()
    try {
      if (inputTrim) {
        if (inputTrim !== savedClientId)
          await trpcClient.settings.set.mutate({ key: CLIENT_ID_SETTING, value: inputTrim })
      } else if (hasShipped && savedTrim) {
        await trpcClient.settings.set.mutate({ key: CLIENT_ID_SETTING, value: '' })
      }
      queryClient.invalidateQueries({ queryKey: [qk.anilistClientId] })
    } catch (err) {
      toast.error((err as Error).message)
      return
    }
    const state = encodeURIComponent(window.location.origin + window.location.pathname)
    window.location.href = `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token&state=${state}`
  }

  const user = (status?.anilist?.user ?? null) as { name: string; avatar?: string } | null
  if (status?.anilist?.connected && user)
    return (
      <div className={styles.connectedProfile}>
        {user.avatar && (
          <img
            src={user.avatar}
            alt="Avatar"
            className={styles.avatar}
            loading="lazy"
            decoding="async"
          />
        )}
        <div className={styles.connectedInfo}>
          <span className={styles.connectedName}>{user.name}</span>
          <span className={styles.connectedHint}>2-way sync is ready</span>
        </div>
        <button
          className={styles.secondaryBtn}
          onClick={() => disconnect.mutate()}
          disabled={disconnect.isPending}
        >
          <Icon name="sign-out-alt" /> Disconnect
        </button>
      </div>
    )

  return (
    <div className={styles.loginSection}>
      <p className={styles.loginText}>
        Log in with AniList to enable bidirectional progress &amp; status synchronization.
        {isExchangingToken && (
          <span style={{ marginLeft: 8, color: 'var(--accent)' }}>Finishing login…</span>
        )}
      </p>
      <div className={styles.fieldLabel}>
        AniList client ID - defaults to dango's app{' '}
        <a href="https://anilist.co/settings/developer" target="_blank" rel="noopener noreferrer">
          create your own app <Icon name="external-link-alt" size={9} />
        </a>
      </div>
      <div className={styles.inputGroup}>
        <input
          type="text"
          placeholder="Client ID"
          value={clientIdInput}
          onChange={(e) => setClientIdInput(e.currentTarget.value)}
          className={styles.input}
        />
        <button
          className={styles.primaryBtn}
          onClick={login}
          disabled={!(clientIdInput.trim() || hasShipped)}
        >
          <Icon name="external-link-alt" /> Connect
        </button>
      </div>
      {hasShipped && savedClientId && (
        <button
          className={styles.resetBtn}
          onClick={() => resetClient.mutate()}
          disabled={resetClient.isPending}
        >
          Use dango&apos;s app instead
        </button>
      )}
      <p className={styles.helpText}>
        {hasShipped ? (
          <>
            By default uses dango's client. To use your own AniList app: create it at{' '}
            <a
              href="https://anilist.co/settings/developer"
              target="_blank"
              rel="noopener noreferrer"
            >
              anilist.co/settings/developer
            </a>
            , set its <strong>Redirect URL</strong> to{' '}
            <code>{`${window.location.origin}/api/tracker/anilist/callback`}</code>, then paste only
            the <strong>Client ID</strong> above (leave empty to use dango's).
          </>
        ) : (
          <>
            No shipped client in this build - create your own app at{' '}
            <a
              href="https://anilist.co/settings/developer"
              target="_blank"
              rel="noopener noreferrer"
            >
              anilist.co/settings/developer
            </a>
            , set <strong>Redirect URL</strong> to{' '}
            <code>{`${window.location.origin}/api/tracker/anilist/callback`}</code>, then paste the{' '}
            <strong>Client ID</strong> above.
          </>
        )}
      </p>
    </div>
  )
}
