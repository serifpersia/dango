import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useSidebar } from '../hooks/useSidebar'
import { useAnilistAuthCallback } from '../hooks/useAnilistAuthCallback'
import { Button } from '../components/common/Button'
import Icon from '../components/common/Icon'

import styles from './Trackers.module.css'

interface ProgressEvent {
  current: number
  total: number
  title: string
  matchedTitle: string | null
  status: string
  source: 'offline' | 'anilist' | 'kitsu' | null
  found: boolean
}

interface CompleteEvent {
  imported: number
  skipped: number
}

interface TrackerStatus {
  anilist: {
    connected: boolean
    user: { id: number; name: string; avatar?: string } | null
  }
}

interface SyncSummary {
  pushed: number
  pulled: number
  merged: number
  unchanged: number
  errors: string[]
}

const CLIENT_ID_SETTING = 'tracker_anilist_client_id'
const SHIPPED_ANILIST_CLIENT_ID = (import.meta.env.VITE_ANILIST_CLIENT_ID || '').trim()

const Trackers: React.FC = () => {
  const { setIsOpen: _setIsOpen } = useSidebar()
  const queryClient = useQueryClient()

  React.useEffect(() => {
    document.title = 'Trackers - dango'
  }, [])

  const [publicUsername, setPublicUsername] = useState<string>('')
  const [anilistImportMode, setAnilistImportMode] = useState<'username' | 'sync'>('username')
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null)
  const [clientIdInput, setClientIdInput] = useState<string>('')
  const isExchangingToken = useAnilistAuthCallback()

  const { data: trackerStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['trackerStatus'],
    queryFn: async (): Promise<TrackerStatus> => {
      const res = await fetch('/api/tracker/status')
      if (!res.ok) throw new Error('Failed to load tracker status')
      return res.json()
    },
  })

  const { data: savedClientId } = useQuery({
    queryKey: ['anilistClientId'],
    queryFn: async (): Promise<string> => {
      const res = await fetch(`/api/settings?key=${CLIENT_ID_SETTING}`)
      const data = await res.json()
      return data.value || ''
    },
  })

  const initializedRef = useRef(false)
  React.useEffect(() => {
    if (initializedRef.current) return
    if (savedClientId === undefined) return
    if (savedClientId) setClientIdInput(savedClientId)
    initializedRef.current = true
  }, [savedClientId])

  const anilistConnected = trackerStatus?.anilist?.connected ?? false

  useEffect(() => {
    if (anilistConnected) setAnilistImportMode('sync')
  }, [anilistConnected])
  const anilistUser = trackerStatus?.anilist?.user ?? null

  const hasShipped = !!SHIPPED_ANILIST_CLIENT_ID
  const savedTrim = (savedClientId || '').trim()
  const _isUsingShipped = !savedTrim && hasShipped
  const _effectiveClientId = savedTrim || SHIPPED_ANILIST_CLIENT_ID

  const handleAniListLogin = async () => {
    const inputTrim = clientIdInput.trim()
    const clientId = inputTrim || SHIPPED_ANILIST_CLIENT_ID
    if (!clientId) {
      toast.error('Enter your AniList client ID first')
      return
    }
    const saveSetting = async (key: string, value: string) => {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      if (!res.ok) throw new Error(`Failed to save ${key}`)
    }
    try {
      if (inputTrim) {
        if (inputTrim !== savedClientId) await saveSetting(CLIENT_ID_SETTING, inputTrim)
      } else if (hasShipped && savedTrim) {
        await saveSetting(CLIENT_ID_SETTING, '')
      }
      queryClient.invalidateQueries({ queryKey: ['anilistClientId'] })
    } catch (err) {
      toast.error((err as Error).message)
      return
    }
    const frontendBase = window.location.origin + window.location.pathname
    const isDevFrontend = window.location.port === '5173'
    const _backendOrigin = isDevFrontend
      ? `${window.location.protocol}//${window.location.hostname}:3000`
      : window.location.origin
    const state = encodeURIComponent(frontendBase)
    window.location.href = `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token&state=${state}`
  }

  const _handleUseShipped = async () => {
    setClientIdInput('')
    if (!savedTrim) {
      toast.success('Using Dango app client')
      return
    }
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: CLIENT_ID_SETTING, value: '' }),
      })
      if (!res.ok) throw new Error('Failed to clear')
      queryClient.invalidateQueries({ queryKey: ['anilistClientId'] })
      toast.success('Reverted to Dango app client — hidden ID will be used')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/tracker/anilist/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to disconnect')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trackerStatus'] })
      toast.success('Disconnected from AniList')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const syncMutation = useMutation({
    mutationFn: async (): Promise<SyncSummary> => {
      const res = await fetch('/api/tracker/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'anilist' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      return data.summary
    },
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: ['watchlist'] })
      queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
      setSyncSummary(summary)
      toast.success(
        `Sync complete — pushed ${summary.pushed}, pulled ${summary.pulled}, merged ${summary.merged}, unchanged ${summary.unchanged}`,
        { duration: 6000 }
      )
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const importMutation = useMutation({
    mutationFn: async (): Promise<number> => {
      if (!publicUsername.trim()) throw new Error('Please enter a username')
      const res = await fetch('/api/tracker/anilist/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: publicUsername.trim(), erase: eraseWatchlist }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      return data.count
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['watchlist'] })
      queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
      toast.success(`Imported ${count} anime entries from AniList`)
      setPublicUsername('')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const [malUsername, setMalUsername] = useState<string>('')

  const malUsernameImport = useMutation({
    mutationFn: async (opts: {
      erase: boolean
      useOfflineDb: boolean
      skipFallback: boolean
    }): Promise<number> => {
      if (!malUsername.trim()) throw new Error('Please enter a MAL username')
      const res = await fetch('/api/tracker/mal/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: malUsername.trim(),
          erase: opts.erase,
          useOfflineDb: opts.useOfflineDb,
          skipFallback: opts.skipFallback,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      return data.count
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['watchlist'] })
      queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
      toast.success(`Imported ${count} anime entries from MAL`)
      setMalUsername('')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const [eraseWatchlist, setEraseWatchlist] = useState<boolean>(false)
  const [useOfflineDb, setUseOfflineDb] = useState<boolean>(true)
  const [skipFallback, setSkipFallback] = useState<boolean>(false)
  const [selectedFileName, setSelectedFileName] = useState<string>('')
  const [importing, setImporting] = useState<boolean>(false)
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [result, setResult] = useState<CompleteEvent | null>(null)
  const [error, setError] = useState<string>('')
  const abortRef = useRef<AbortController | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFileName(e.target.files[0].name)
    } else {
      setSelectedFileName('')
    }
  }

  const handleMalImport = useCallback(async () => {
    const fileInput = document.getElementById('malFile') as HTMLInputElement
    if (!fileInput.files || fileInput.files.length === 0) {
      setError('Please select a file first.')
      return
    }

    const file = fileInput.files[0]
    setImporting(true)
    setProgress(null)
    setResult(null)
    setError('')

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const formData = new FormData()
      formData.append('xmlfile', file)
      formData.append('erase', String(eraseWatchlist))
      formData.append('useOfflineDb', String(useOfflineDb))
      formData.append('skipFallback', String(skipFallback))

      const response = await fetch('/api/import/mal-xml', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text()
        let msg = 'Failed to import'
        try {
          msg = JSON.parse(text).error || msg
        } catch {
          // ignore
        }
        throw new Error(msg)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response stream')

      const decoder = new TextDecoder()
      let buffer = ''
      let eventType = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6)
            try {
              const parsed = JSON.parse(data)
              if (eventType === 'progress') {
                setProgress(parsed)
              } else if (eventType === 'complete') {
                setResult(parsed)
              }
            } catch {
              // ignore
            }
          } else if (line === '') {
            eventType = ''
          }
        }
      }
      queryClient.invalidateQueries({ queryKey: ['watchlist'] })
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Import cancelled.')
      } else {
        setError((err as Error).message)
      }
    } finally {
      setImporting(false)
      abortRef.current = null
    }
  }, [eraseWatchlist, useOfflineDb, skipFallback, queryClient])

  const handleCancel = () => {
    abortRef.current?.abort()
    fetch('/api/import/mal-xml/cancel', { method: 'POST' }).catch(() => {})
  }

  const progressPercent = progress ? Math.round((progress.current / progress.total) * 100) : 0

  const [malImportMode, setMalImportMode] = useState<'username' | 'xml'>('username')

  return (
    <div className="page-container">
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>Trackers</h1>
        <p className={styles.pageSubtitle}>
          Import &amp; sync your anime watchlists with tracking services
        </p>
      </div>

      <div className={styles.importCard}>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitleRow}>
            <Icon name="anilist" className={styles.anilistIcon} />
            <h3>AniList</h3>
            {statusLoading ? null : anilistConnected ? (
              <span className={styles.badgeOnline}>Connected</span>
            ) : (
              <span className={styles.badgeOffline}>Not connected</span>
            )}
          </div>
        </div>

        {anilistConnected && anilistUser ? (
          <div className={styles.connectedProfile}>
            {anilistUser.avatar && (
              <img
                src={anilistUser.avatar}
                alt="Avatar"
                className={styles.avatar}
                loading="lazy"
                decoding="async"
              />
            )}
            <div className={styles.connectedInfo}>
              <span className={styles.connectedName}>{anilistUser.name}</span>
              <span className={styles.connectedHint}>2-way sync is ready</span>
            </div>
            <button
              className={styles.secondaryBtn}
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              <Icon name="sign-out-alt" /> Disconnect
            </button>
          </div>
        ) : (
          <div className={styles.loginSection}>
            <p className={styles.loginText}>
              Log in with AniList to enable bidirectional progress &amp; status synchronization.
              {isExchangingToken && (
                <span style={{ marginLeft: 8, color: 'var(--accent)' }}>Finishing login…</span>
              )}
            </p>
            <div className={styles.fieldLabel}>
              AniList client ID — defaults to Dango's app{' '}
              <a
                href="https://anilist.co/settings/developer"
                target="_blank"
                rel="noopener noreferrer"
              >
                create your own app <Icon name="external-link-alt" size={9} />
              </a>
            </div>
            <div className={styles.inputGroup}>
              <input
                type="text"
                placeholder="Client ID"
                value={clientIdInput}
                onChange={(e) => setClientIdInput(e.target.value)}
                className={styles.input}
              />
              <button
                className={styles.primaryBtn}
                onClick={handleAniListLogin}
                disabled={!(clientIdInput.trim() || hasShipped)}
              >
                <Icon name="external-link-alt" /> Connect
              </button>
            </div>
            <p className={styles.helpText}>
              {hasShipped ? (
                <>
                  By default uses Dango's client. To use your own AniList app: create it at{' '}
                  <a
                    href="https://anilist.co/settings/developer"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    anilist.co/settings/developer
                  </a>
                  , set its <strong>Redirect URL</strong> to{' '}
                  <code>
                    {window.location.port === '5173'
                      ? `${window.location.protocol}//${window.location.hostname}:3000/api/tracker/anilist/callback`
                      : `${window.location.origin}/api/tracker/anilist/callback`}
                  </code>
                  , then paste only the <strong>Client ID</strong> above (leave empty to use
                  Dango's).
                </>
              ) : (
                <>
                  No shipped client in this build — create your own app at{' '}
                  <a
                    href="https://anilist.co/settings/developer"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    anilist.co/settings/developer
                  </a>
                  , set <strong>Redirect URL</strong> to{' '}
                  <code>
                    {window.location.port === '5173'
                      ? `${window.location.protocol}//${window.location.hostname}:3000/api/tracker/anilist/callback`
                      : `${window.location.origin}/api/tracker/anilist/callback`}
                  </code>
                  , then paste the <strong>Client ID</strong> above.
                </>
              )}
            </p>
          </div>
        )}

        {anilistConnected && (
          <>
            <hr className={styles.divider} />

            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="anilistMode"
                  value="username"
                  checked={anilistImportMode === 'username'}
                  onChange={() => setAnilistImportMode('username')}
                />
                <span>Quick Import</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="anilistMode"
                  value="sync"
                  checked={anilistImportMode === 'sync'}
                  onChange={() => setAnilistImportMode('sync')}
                />
                <span>Two-way Sync</span>
              </label>
            </div>

            {anilistImportMode === 'username' ? (
              <div className={styles.inputGroup}>
                <input
                  type="text"
                  placeholder="Enter AniList username"
                  value={publicUsername}
                  onChange={(e) => setPublicUsername(e.target.value)}
                  className={styles.input}
                  disabled={importMutation.isPending}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && publicUsername.trim()) importMutation.mutate()
                  }}
                />
              </div>
            ) : (
              <p className={styles.syncHint}>
                Merges progress non-destructively: pushes shows and episodes you watched on dango to
                AniList, and pulls anything you updated on AniList into dango.
              </p>
            )}

            {anilistImportMode === 'username' && (
              <div className={styles.optionsArea}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={eraseWatchlist}
                    onChange={(e) => setEraseWatchlist(e.target.checked)}
                    className={styles.checkbox}
                    disabled={importMutation.isPending}
                  />
                  <span className={styles.checkboxCustom}></span>
                  <div className={styles.optionText}>
                    <span className={styles.optionTitle}>Erase current watchlist</span>
                    <span className={styles.optionDesc}>
                      Delete existing watchlist before importing.
                    </span>
                  </div>
                </label>
              </div>
            )}

            {anilistImportMode === 'username' ? (
              <button
                className={styles.syncBtn}
                onClick={() => importMutation.mutate()}
                disabled={!publicUsername.trim() || importMutation.isPending}
              >
                <Icon name="download" />
                {importMutation.isPending ? 'Importing...' : 'Start Import'}
              </button>
            ) : (
              <>
                <button
                  className={styles.syncBtn}
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                >
                  <Icon name="sync-alt" className={syncMutation.isPending ? styles.spin : ''} />
                  {syncMutation.isPending ? 'Syncing...' : 'Start Sync'}
                </button>
                {syncSummary && (
                  <div className={styles.syncSummary}>
                    Pushed: {syncSummary.pushed} · Pulled: {syncSummary.pulled} · Merged:{' '}
                    {syncSummary.merged} · Unchanged: {syncSummary.unchanged}
                    {syncSummary.errors.length > 0 && (
                      <span className={styles.syncErrors}>
                        {' '}
                        · {syncSummary.errors.length} error
                        {syncSummary.errors.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                )}
              </>
            )}

            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-tertiary)',
                marginTop: '8px',
              }}
            >
              AniList <code>Rewatching (REPEATING)</code> is not tracked — entries with this status
              are ignored.
            </p>
          </>
        )}
      </div>

      <div className={styles.importCard}>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitleRow}>
            <Icon name="myanimelist" className={styles.malIcon} />
            <h3>MyAnimeList</h3>
          </div>
        </div>

        <div className={styles.radioGroup}>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="malMode"
              value="username"
              checked={malImportMode === 'username'}
              onChange={() => setMalImportMode('username')}
            />
            <span>Username</span>
          </label>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="malMode"
              value="xml"
              checked={malImportMode === 'xml'}
              onChange={() => setMalImportMode('xml')}
            />
            <span>XML File</span>
          </label>
        </div>

        {malImportMode === 'username' ? (
          <>
            <div className={styles.inputGroup}>
              <input
                type="text"
                placeholder="Enter MAL username"
                value={malUsername}
                onChange={(e) => setMalUsername(e.target.value)}
                className={styles.input}
                disabled={malUsernameImport.isPending}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && malUsername.trim())
                    malUsernameImport.mutate({ erase: eraseWatchlist, useOfflineDb, skipFallback })
                }}
              />
            </div>
            {malUsernameImport.isPending && (
              <div className={styles.importLoading}>
                <Icon name="sync-alt" className={styles.spin} />
                <span>Importing from MAL...</span>
              </div>
            )}
          </>
        ) : (
          <div className={styles.uploadArea}>
            <div className={styles.fileInputWrapper}>
              <input
                type="file"
                id="malFile"
                accept=".xml,application/xml"
                className={styles.fileInput}
                onChange={handleFileChange}
                disabled={importing}
              />
              <div className={styles.fileDisplay}>
                <Icon name="file-alt" className={styles.fileIcon} />
                <span className={styles.fileName}>{selectedFileName || 'Choose XML file...'}</span>
              </div>
              <label htmlFor="malFile" className={styles.browseButton}>
                Browse
              </label>
            </div>
          </div>
        )}

        <div className={styles.optionsArea}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={eraseWatchlist}
              onChange={(e) => setEraseWatchlist(e.target.checked)}
              className={styles.checkbox}
              disabled={importing || malUsernameImport.isPending}
            />
            <span className={styles.checkboxCustom}></span>
            <div className={styles.optionText}>
              <span className={styles.optionTitle}>Erase current watchlist</span>
              <span className={styles.optionDesc}>Delete existing watchlist before importing.</span>
            </div>
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={useOfflineDb}
              onChange={(e) => setUseOfflineDb(e.target.checked)}
              className={styles.checkbox}
              disabled={importing || malUsernameImport.isPending}
            />
            <span className={styles.checkboxCustom}></span>
            <div className={styles.optionText}>
              <span className={styles.optionTitle}>Use offline database (fast)</span>
              <span className={styles.optionDesc}>
                Match by MAL ID locally first — instant and avoids AniList rate limits.
              </span>
            </div>
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={skipFallback}
              onChange={(e) => setSkipFallback(e.target.checked)}
              className={styles.checkbox}
              disabled={importing || malUsernameImport.isPending}
            />
            <span className={styles.checkboxCustom}></span>
            <div className={styles.optionText}>
              <span className={styles.optionTitle}>Skip online fallback</span>
              <span className={styles.optionDesc}>
                Only import offline matches. Unmatched titles are skipped without API calls.
              </span>
            </div>
          </label>
        </div>

        {malImportMode === 'username' ? (
          <button
            className={styles.syncBtn}
            onClick={() =>
              malUsernameImport.mutate({ erase: eraseWatchlist, useOfflineDb, skipFallback })
            }
            disabled={!malUsername.trim() || malUsernameImport.isPending}
          >
            <Icon name="download" />
            {malUsernameImport.isPending ? 'Importing...' : 'Start Import'}
          </button>
        ) : (
          <div className={styles.actions}>
            {importing ? (
              <Button onClick={handleCancel} className={styles.cancelBtn}>
                Cancel Import
              </Button>
            ) : (
              <Button
                onClick={handleMalImport}
                className={styles.importBtn}
                disabled={!selectedFileName}
              >
                <Icon name="upload" /> Start Import
              </Button>
            )}
          </div>
        )}

        {malImportMode === 'username' && malUsernameImport.isError && (
          <div className={`${styles.statusMessage} ${styles.error}`}>
            {malUsernameImport.error.message}
          </div>
        )}

        {importing && progress && (
          <div className={styles.progressSection}>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
            </div>
            <div className={styles.progressInfo}>
              <span className={styles.progressCount}>
                {progress.current} / {progress.total}
              </span>
              <span className={styles.progressTitle}>
                {progress.found ? (
                  <>
                    {progress.matchedTitle}
                    <span
                      className={`${styles.sourceBadge} ${styles[progress.source || 'anilist']}`}
                    >
                      {progress.source === 'kitsu'
                        ? 'Kitsu'
                        : progress.source === 'offline'
                          ? 'Offline DB'
                          : 'AniList'}
                    </span>
                  </>
                ) : (
                  <span className={styles.skipped}>Skipped: {progress.title}</span>
                )}
              </span>
            </div>
          </div>
        )}

        {result && (
          <div className={`${styles.statusMessage} ${styles.success}`}>
            Import complete! Imported: {result.imported}, Skipped: {result.skipped}.
          </div>
        )}

        {error && <div className={`${styles.statusMessage} ${styles.error}`}>{error}</div>}
      </div>
    </div>
  )
}

export default Trackers
