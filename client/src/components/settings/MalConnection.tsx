import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { trpcClient } from '../../lib/trpc'
import { qk } from '../../lib/queryKeys'
import Icon from '../common/Icon'
import styles from '../../pages/Trackers.module.css'

export default function MalConnection({
  kind = 'anime',
  active = true,
}: {
  kind?: 'anime' | 'manga'
  active?: boolean
}) {
  const queryClient = useQueryClient()
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [error, setError] = useState('')
  const [summary, setSummary] = useState('')
  const initialized = useRef(false)
  const { data: config } = useQuery({
    queryKey: [qk.malClientConfig],
    queryFn: () => trpcClient.tracker.malConfig.query(),
  })
  const { data: status } = useQuery({
    queryKey: [qk.trackerStatus],
    queryFn: () => trpcClient.tracker.status.query(),
    refetchInterval: 15000,
  })
  useEffect(() => {
    if (config && !initialized.current) {
      setClientId(config.clientId)
      initialized.current = true
    }
  }, [config])

  const connect = useMutation({
    mutationFn: async () => {
      setError('')
      if (clientSecret.trim() || (clientId.trim() && clientId.trim() !== config?.clientId)) {
        await trpcClient.tracker.malSaveConfig.mutate({
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim() || undefined,
        })
      }
      setClientSecret('')
      const result = await trpcClient.tracker.malLogin.mutate({
        redirectUri: `${window.location.origin}/api/tracker/mal/callback`,
      })
      window.location.assign(result.url)
    },
    onError: (err: Error) => setError(err.message),
  })
  const disconnect = useMutation({
    mutationFn: () => trpcClient.tracker.malDisconnect.mutate(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [qk.trackerStatus] })
      setSummary('')
      setError('')
      toast.success('Disconnected from MyAnimeList')
    },
    onError: (err: Error) => setError(err.message),
  })
  const resetApp = useMutation({
    mutationFn: () => trpcClient.tracker.malClearConfig.mutate(),
    onSuccess: () => {
      setClientId('')
      setClientSecret('')
      setSummary('')
      setError('')
      queryClient.invalidateQueries({ queryKey: [qk.trackerStatus] })
      queryClient.invalidateQueries({ queryKey: [qk.malClientConfig] })
      toast.success("Switched to dango's MyAnimeList app - reconnect to finish")
    },
    onError: (err: Error) => setError(err.message),
  })
  const sync = useMutation({
    mutationFn: () =>
      kind === 'manga'
        ? trpcClient.tracker.mangaMalSync.mutate()
        : trpcClient.tracker.sync.mutate({ provider: 'mal' }),
    onSuccess: (data) => {
      const s = data.summary
      setSummary(
        `Pushed: ${s.pushed} · Pulled: ${s.pulled} · Merged: ${s.merged} · Unchanged: ${s.unchanged}` +
          (s.errors.length > 0
            ? ` · ${s.errors.length} error${s.errors.length > 1 ? 's' : ''}`
            : '')
      )
      for (const queryKey of kind === 'manga'
        ? [[qk.trackerStatus], [qk.mangaLibrary], [qk.mangaContinueReading]]
        : [[qk.trackerStatus], [qk.watchlist], [qk.continueWatching]])
        queryClient.invalidateQueries({ queryKey })
    },
    onError: (err: Error) => setError(err.message),
  })
  const mal = status?.mal
  return (
    <div>
      {mal?.connected ? (
        <>
          <div className={styles.connectedProfile}>
            {mal.user?.avatar && (
              <img
                src={mal.user.avatar}
                alt="Avatar"
                className={styles.avatar}
                loading="lazy"
                decoding="async"
              />
            )}
            <div className={styles.connectedInfo}>
              <span className={styles.connectedName}>{mal.user?.name || 'MyAnimeList user'}</span>
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

          {active ? (
            <>
              <button
                className={styles.syncBtn}
                onClick={() => sync.mutate()}
                disabled={sync.isPending}
              >
                <Icon name="sync-alt" className={sync.isPending ? styles.spin : ''} />
                {sync.isPending ? 'Syncing...' : 'Start Sync'}
              </button>
              {summary && <div className={styles.syncSummary}>{summary}</div>}
            </>
          ) : (
            <p className={styles.connectedHint} style={{ color: 'var(--color-warning)' }}>
              Not the active tracker - sync disabled.
            </p>
          )}
        </>
      ) : (
        <div className={styles.loginSection}>
          <p className={styles.loginText}>
            Log in with MyAnimeList to enable bidirectional progress &amp; status synchronization.
          </p>
          <div className={styles.credentialFields}>
            <label className={`${styles.fieldLabel} ${styles.credentialField}`}>
              <span>
                Client ID{' '}
                <a
                  href="https://myanimelist.net/apiconfig"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  create your own app <Icon name="external-link-alt" size={9} />
                </a>
                {config?.mode === 'worker' && (
                  <span className={styles.helpText}> — defaults to dango&apos;s app</span>
                )}
              </span>
              <input
                className={styles.input}
                placeholder={config?.mode === 'worker' ? "dango's app (leave empty)" : 'Client ID'}
                value={clientId}
                onChange={(e) => setClientId(e.currentTarget.value)}
                autoComplete="off"
              />
            </label>
            <label className={`${styles.fieldLabel} ${styles.credentialField}`}>
              <span>
                Client secret{' '}
                {config?.hasSecret && !clientSecret && (
                  <span className={styles.helpText}>— saved</span>
                )}
              </span>
              <input
                className={styles.input}
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.currentTarget.value)}
                placeholder={
                  config?.mode === 'worker'
                    ? "dango's app (leave empty)"
                    : config?.hasSecret
                      ? 'Saved — leave blank to keep'
                      : 'Client secret'
                }
                autoComplete="new-password"
              />
            </label>
          </div>
          {config?.hasCustomId && config?.hasWorker && (
            <button
              className={styles.resetBtn}
              onClick={() => resetApp.mutate()}
              disabled={resetApp.isPending}
            >
              Use dango&apos;s app instead
            </button>
          )}
          <p className={styles.helpText}>
            {config?.mode === 'worker' ? (
              <>
                By default uses dango&apos;s client. To use your own MyAnimeList app: create it at{' '}
                <a
                  href="https://myanimelist.net/apiconfig"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  myanimelist.net/apiconfig
                </a>
                , set its <strong>Redirect URL</strong> to{' '}
                <code>{window.location.origin}/api/tracker/mal/callback</code>, then paste its{' '}
                <strong>Client ID</strong> and <strong>Client secret</strong> above (leave both
                empty to use dango&apos;s).
              </>
            ) : (
              <>
                No shipped client in this build - create your own app at{' '}
                <a
                  href="https://myanimelist.net/apiconfig"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  myanimelist.net/apiconfig
                </a>
                , set its <strong>Redirect URL</strong> to{' '}
                <code>{window.location.origin}/api/tracker/mal/callback</code>, then paste the{' '}
                <strong>Client ID</strong> and <strong>Client secret</strong> above. MAL requires
                the secret even for PKCE apps; it stays on your dango server and is never returned
                to the browser.
              </>
            )}
          </p>
          <button
            className={styles.primaryBtn}
            onClick={() => connect.mutate()}
            disabled={
              !(
                (clientId.trim() && clientSecret.trim()) ||
                (!!config?.clientId && clientId.trim() === config.clientId && config.hasSecret) ||
                (!clientId.trim() && !clientSecret.trim() && config?.mode === 'worker')
              ) || connect.isPending
            }
          >
            {connect.isPending ? 'Connecting...' : 'Connect to MyAnimeList'}
          </button>
        </div>
      )}

      {error && (
        <p className={`${styles.helpText} ${styles.syncErrors}`} role="alert">
          {error}
        </p>
      )}
      <hr className={styles.divider} />
      <p className={styles.syncHint}>
        You can also import a public list or XML file without connecting an account:
      </p>
    </div>
  )
}
