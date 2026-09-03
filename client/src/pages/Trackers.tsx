import React, { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useSidebar } from '../hooks/useSidebar'
import { Button } from '../components/common/Button'
import {
  FaFileAlt,
  FaUpload,
  FaSyncAlt,
  FaSignOutAlt,
  FaDownload,
  FaExternalLinkAlt,
} from 'react-icons/fa'
import { SiAnilist, SiMyanimelist } from 'react-icons/si'
import styles from './Trackers.module.css'

interface ProgressEvent {
  current: number
  total: number
  title: string
  matchedTitle: string | null
  status: string
  source: 'anilist' | 'kitsu' | null
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
  const { setIsOpen } = useSidebar()
  const queryClient = useQueryClient()

  React.useEffect(() => {
    document.title = 'Trackers - dango'
  }, [])

  // --- AniList state ---
  const [publicUsername, setPublicUsername] = useState<string>('')
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null)
  const [clientIdInput, setClientIdInput] = useState<string>('')
  const [pendingToken, setPendingToken] = useState<string | null>(null)

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
  const anilistUser = trackerStatus?.anilist?.user ?? null

  const hasShipped = !!SHIPPED_ANILIST_CLIENT_ID
  const savedTrim = (savedClientId || '').trim()
  const isUsingShipped = !savedTrim && hasShipped
  const effectiveClientId = savedTrim || SHIPPED_ANILIST_CLIENT_ID

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
    const backendOrigin = isDevFrontend
      ? `${window.location.protocol}//${window.location.hostname}:3000`
      : window.location.origin
    const state = encodeURIComponent(frontendBase)
    window.location.href = `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token&state=${state}`
  }

  const handleUseShipped = async () => {
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

  React.useEffect(() => {
    const hash = window.location.hash
    if (!hash || !hash.includes('access_token')) return
    const params = new URLSearchParams(hash.substring(1))
    const token = params.get('access_token')
    if (!token) {
      const err = params.get('error')
      if (err) toast.error(`AniList error: ${err}`)
      return
    }
    setPendingToken(token)
    history.replaceState(null, '', window.location.pathname + window.location.search)
    ;(async () => {
      try {
        const res = await fetch('/api/tracker/anilist/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Authentication failed')
        queryClient.invalidateQueries({ queryKey: ['trackerStatus'] })
        toast.success(`Connected as ${data.user?.name ?? 'AniList user'}`)
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setPendingToken(null)
      }
    })()
  }, [queryClient])

  React.useEffect(() => {
    const qp = new URLSearchParams(window.location.search)
    if (qp.get('anilist') === 'error') {
      toast.error(`AniList auth failed: ${qp.get('reason') || 'unknown'}`)
      qp.delete('anilist')
      qp.delete('reason')
      const qs = qp.toString()
      history.replaceState(
        null,
        '',
        window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
      )
    }
  }, [])

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
        body: JSON.stringify({ username: publicUsername.trim() }),
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

  // --- MAL XML import state (existing flow) ---
  const [eraseWatchlist, setEraseWatchlist] = useState<boolean>(false)
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
          // response body is not JSON, keep default message
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
              // ignore malformed SSE data lines
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
  }, [eraseWatchlist, queryClient])

  const handleCancel = () => {
    abortRef.current?.abort()
  }

  const progressPercent = progress ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div className="page-container">
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>Trackers</h1>
        <p className={styles.pageSubtitle}>
          Import &amp; sync your anime watchlists with tracking services
        </p>
      </div>

      {/* --- AniList --- */}
      <div className={styles.importCard}>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitleRow}>
            <SiAnilist className={styles.anilistIcon} />
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
              <img src={anilistUser.avatar} alt="Avatar" className={styles.avatar} />
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
              <FaSignOutAlt /> Disconnect
            </button>
          </div>
        ) : (
          <div className={styles.loginSection}>
            <p className={styles.loginText}>
              Log in with AniList to enable bidirectional progress &amp; status synchronization.
              {pendingToken && (
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
                create your own app <FaExternalLinkAlt size={9} />
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
                <FaExternalLinkAlt /> Connect
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

        <hr className={styles.divider} />

        <div className={styles.actionSection}>
          <h4>Two-way Sync</h4>
          <p>
            Merges progress non-destructively: pushes shows and episodes you watched on dango to
            AniList, and pulls anything you updated on AniList into dango.
          </p>
          <p
            style={{
              fontSize: '0.8rem',
              color: 'var(--text-tertiary)',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-primary)',
              borderRadius: '6px',
              padding: '8px 10px',
              marginBottom: '12px',
              lineHeight: 1.5,
            }}
          >
            <strong>Note:</strong> AniList <code>Rewatching (REPEATING)</code> is not tracked —
            entries with this status are ignored and left unchanged on AniList.
          </p>
          <button
            className={styles.syncBtn}
            onClick={() => syncMutation.mutate()}
            disabled={!anilistConnected || syncMutation.isPending}
          >
            <FaSyncAlt className={syncMutation.isPending ? styles.spin : ''} />
            {syncMutation.isPending ? 'Syncing...' : 'Start Sync'}
          </button>
          {syncSummary && (
            <div className={styles.syncSummary}>
              Pushed: {syncSummary.pushed} · Pulled: {syncSummary.pulled} · Merged:{' '}
              {syncSummary.merged} · Unchanged: {syncSummary.unchanged}
              {syncSummary.errors.length > 0 && (
                <span className={styles.syncErrors}>
                  {' '}
                  · {syncSummary.errors.length} error{syncSummary.errors.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
        </div>

        <hr className={styles.divider} />

        <div className={styles.actionSection}>
          <h4>Quick Import</h4>
          <p>Import all public anime list entries directly from any AniList username.</p>
          <div className={styles.inputGroup}>
            <input
              type="text"
              placeholder="Enter AniList username"
              value={publicUsername}
              onChange={(e) => setPublicUsername(e.target.value)}
              className={styles.input}
              disabled={importMutation.isPending}
            />
            <button
              className={styles.secondaryBtn}
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending}
            >
              <FaDownload /> {importMutation.isPending ? 'Importing...' : 'Import List'}
            </button>
          </div>
        </div>
      </div>

      {/* --- MyAnimeList XML import --- */}
      <div className={styles.importCard}>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitleRow}>
            <SiMyanimelist className={styles.malIcon} />
            <h3>MyAnimeList</h3>
          </div>
          <p>Upload your exported MyAnimeList XML file to import your watchlist into dango.</p>
        </div>

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
              <FaFileAlt className={styles.fileIcon} />
              <span className={styles.fileName}>{selectedFileName || 'Choose XML file...'}</span>
            </div>
            <label htmlFor="malFile" className={styles.browseButton}>
              Browse
            </label>
          </div>
        </div>

        <div className={styles.optionsArea}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              id="eraseWatchlistToggle"
              checked={eraseWatchlist}
              onChange={(e) => setEraseWatchlist(e.target.checked)}
              className={styles.checkbox}
              disabled={importing}
            />
            <span className={styles.checkboxCustom}></span>
            <div className={styles.optionText}>
              <span className={styles.optionTitle}>Erase current watchlist</span>
              <span className={styles.optionDesc}>
                Warning: This will permanently delete your existing dango watchlist before
                importing.
              </span>
            </div>
          </label>
        </div>

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
              <FaUpload /> Start Import
            </Button>
          )}
        </div>

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
                      {progress.source === 'kitsu' ? 'Kitsu' : 'AniList'}
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
