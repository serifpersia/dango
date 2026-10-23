import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useSidebar } from '../contexts/SidebarContext'
import { useContentType } from '../contexts/ContentTypeContext'
import { useMalAuthCallback } from '../hooks/useMalAuthCallback'
import AniListConnection from '../components/settings/AniListConnection'
import { trpcClient } from '../lib/trpc'
import { fetchWithLocalHeaders } from '../lib/fetchApi'
import { Button } from '../components/common/Button'
import Icon from '../components/common/Icon'
import MalConnection from '../components/settings/MalConnection'

import styles from './Trackers.module.css'
import { qk } from '../lib/queryKeys'

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
  mal: {
    connected: boolean
    user: { id: number; name: string; avatar?: string } | null
  }
}

interface SyncSummary {
  pushed: number
  pulled: number
  merged: number
  unchanged: number
  skipped?: number
  errors: string[]
  warnings?: string[]
}

const Trackers: React.FC = () => {
  const { setIsOpen: _setIsOpen } = useSidebar()
  const { contentType } = useContentType()
  const showMangaTrackers = contentType === 'manga'
  const queryClient = useQueryClient()

  React.useEffect(() => {
    document.title = 'Trackers - dango'
  }, [])

  const [publicUsername, setPublicUsername] = useState<string>('')
  const [anilistImportMode, setAnilistImportMode] = useState<'username' | 'sync'>('username')
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null)
  const [eraseManga, setEraseManga] = useState<boolean>(false)
  useMalAuthCallback()

  const { data: trackerStatus, isLoading: statusLoading } = useQuery({
    queryKey: [qk.trackerStatus],
    queryFn: async (): Promise<TrackerStatus> => {
      const data = await trpcClient.tracker.status.query()
      return data as unknown as TrackerStatus
    },
  })

  const anilistConnected = trackerStatus?.anilist?.connected ?? false
  const malConnected = trackerStatus?.mal?.connected ?? false

  const { data: activeTrackerData } = useQuery({
    queryKey: ['activeTrackerProvider'],
    queryFn: async () => {
      const res = await trpcClient.settings.getByKey.query({ key: 'active_tracker_provider' })
      return (res?.value as string) || ''
    },
  })

  const activeTrackerMutation = useMutation({
    mutationFn: async (provider: string) => {
      await trpcClient.settings.set.mutate({ key: 'active_tracker_provider', value: provider })
      return provider
    },
    onSuccess: (provider) => {
      queryClient.invalidateQueries({ queryKey: ['activeTrackerProvider'] })
      toast.success(`Active tracker set to ${provider === 'mal' ? 'MyAnimeList' : 'AniList'}`)
    },
    onError: () => toast.error('Failed to update active tracker'),
  })

  const activeTracker =
    activeTrackerData &&
    ((activeTrackerData === 'anilist' && anilistConnected) ||
      (activeTrackerData === 'mal' && malConnected))
      ? activeTrackerData
      : anilistConnected && !malConnected
        ? 'anilist'
        : malConnected && !anilistConnected
          ? 'mal'
          : anilistConnected
            ? 'anilist'
            : ''
  const showTrackerSelector = anilistConnected || malConnected

  useEffect(() => {
    if (anilistConnected) setAnilistImportMode('sync')
  }, [anilistConnected])

  const syncMutation = useMutation({
    mutationFn: async (): Promise<SyncSummary> => {
      const data = await trpcClient.tracker.sync.mutate({ provider: 'anilist' })
      return data.summary as unknown as SyncSummary
    },
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: [qk.watchlist] })
      queryClient.invalidateQueries({ queryKey: [qk.continueWatching] })
      setSyncSummary(summary)
      toast.success(
        `Sync complete - pushed ${summary.pushed}, pulled ${summary.pulled}, merged ${summary.merged}, unchanged ${summary.unchanged}`,
        { duration: 6000 }
      )
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const [mangaUsername, setMangaUsername] = useState<string>('')
  const [mangaImportMode, setMangaImportMode] = useState<'username' | 'sync'>('sync')
  const [mangaDirection, setMangaDirection] = useState<'two-way' | 'pull-only'>('two-way')
  const [mangaSyncSummary, setMangaSyncSummary] = useState<SyncSummary | null>(null)

  const mangaSyncMutation = useMutation({
    mutationFn: async (): Promise<SyncSummary> => {
      const data = await trpcClient.tracker.mangaSync.mutate({ direction: mangaDirection })
      return data.summary as unknown as SyncSummary
    },
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: [qk.mangaLibrary] })
      queryClient.invalidateQueries({ queryKey: [qk.mangaContinueReading] })
      setMangaSyncSummary(summary)
      const warningSuffix =
        (summary.warnings?.length ?? 0) > 0 ? `, ${summary.warnings!.length} warning(s)` : ''
      toast.success(
        `Manga sync complete - pushed ${summary.pushed}, pulled ${summary.pulled}, merged ${summary.merged}, unchanged ${summary.unchanged}${warningSuffix}`,
        { duration: 6000 }
      )
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const mangaImportMutation = useMutation({
    mutationFn: async (): Promise<number> => {
      if (!mangaUsername.trim()) throw new Error('Please enter a username')
      const data = await trpcClient.tracker.mangaImport.mutate({
        username: mangaUsername.trim(),
        erase: eraseManga,
      })
      return data.count
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: [qk.mangaLibrary] })
      queryClient.invalidateQueries({ queryKey: [qk.mangaContinueReading] })
      toast.success(`Imported ${count} manga entries from AniList`)
      setMangaUsername('')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const [malMangaUsername, setMalMangaUsername] = useState<string>('')
  const [malMangaImportMode, setMalMangaImportMode] = useState<'username' | 'xml'>('username')
  const [malMangaXmlResult, setMalMangaXmlResult] = useState<{
    imported: number
    skipped: number
  } | null>(null)
  const [malMangaXmlBusy, setMalMangaXmlBusy] = useState<boolean>(false)
  const [malMangaXmlError, setMalMangaXmlError] = useState<string>('')
  const [malMangaFileName, setMalMangaFileName] = useState<string>('')

  const malMangaUsernameImport = useMutation({
    mutationFn: async (): Promise<{ imported: number; skipped: number }> => {
      if (!malMangaUsername.trim()) throw new Error('Please enter a MAL username')
      const data = await trpcClient.tracker.mangaMalImport.mutate({
        username: malMangaUsername.trim(),
        erase: eraseManga,
      })
      return { imported: data.imported ?? 0, skipped: data.skipped ?? 0 }
    },
    onSuccess: ({ imported, skipped }) => {
      queryClient.invalidateQueries({ queryKey: [qk.mangaLibrary] })
      queryClient.invalidateQueries({ queryKey: [qk.mangaContinueReading] })
      toast.success(
        `Imported ${imported} manga entries from MAL${skipped > 0 ? `, skipped ${skipped}` : ''}`
      )
      setMalMangaUsername('')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const handleMalMangaXmlImport = useCallback(async () => {
    const fileInput = document.getElementById('malMangaFile') as HTMLInputElement
    if (!fileInput.files || fileInput.files.length === 0) {
      setMalMangaXmlError('Please select a file first.')
      return
    }
    setMalMangaXmlBusy(true)
    setMalMangaXmlError('')
    setMalMangaXmlResult(null)
    try {
      const formData = new FormData()
      formData.append('xmlfile', fileInput.files[0])
      formData.append('erase', String(eraseManga))
      const res = await fetchWithLocalHeaders('/api/import/mal-xml-manga', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Import failed')
      setMalMangaXmlResult({ imported: data.imported ?? 0, skipped: data.skipped ?? 0 })
      queryClient.invalidateQueries({ queryKey: [qk.mangaLibrary] })
      queryClient.invalidateQueries({ queryKey: [qk.mangaContinueReading] })
    } catch (err: unknown) {
      setMalMangaXmlError((err as Error).message)
    } finally {
      setMalMangaXmlBusy(false)
    }
  }, [eraseManga, queryClient])

  const importMutation = useMutation({
    mutationFn: async (): Promise<number> => {
      if (!publicUsername.trim()) throw new Error('Please enter a username')
      const data = await trpcClient.tracker.anilistImport.mutate({
        username: publicUsername.trim(),
        erase: eraseWatchlist,
      })
      return data.count
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: [qk.watchlist] })
      queryClient.invalidateQueries({ queryKey: [qk.continueWatching] })
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
      const data = await trpcClient.tracker.malImport.mutate({
        username: malUsername.trim(),
        erase: opts.erase,
        useOfflineDb: opts.useOfflineDb,
        skipFallback: opts.skipFallback,
      })
      return data.count
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: [qk.watchlist] })
      queryClient.invalidateQueries({ queryKey: [qk.continueWatching] })
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
    if (e.currentTarget.files && e.currentTarget.files.length > 0) {
      setSelectedFileName(e.currentTarget.files[0].name)
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

      const response = await fetchWithLocalHeaders('/api/import/mal-xml', {
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
      queryClient.invalidateQueries({ queryKey: [qk.watchlist] })
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
    trpcClient.settings.malImportCancel.mutate().catch(() => {})
  }

  const progressPercent = progress ? Math.round((progress.current / progress.total) * 100) : 0

  const [malImportMode, setMalImportMode] = useState<'username' | 'xml'>('username')

  return (
    <div className="page-container">
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>Trackers</h1>
        <p className={styles.pageSubtitle}>
          Import &amp; sync your anime watchlists and manga reading lists with tracking services
        </p>
      </div>

      <div
        style={{
          marginBottom: '16px',
          padding: '10px 14px',
          borderRadius: '8px',
          fontSize: '0.85rem',
          background: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)',
          color: 'var(--text-secondary)',
        }}
      >
        ⚠ Syncing writes directly to your AniList and MyAnimeList entries, and dango may not always
        handle anime/manga lists correctly - always keep a backup of your lists before syncing.
      </div>

      {showTrackerSelector && (
        <div
          style={{
            marginBottom: '16px',
            padding: '10px 14px',
            borderRadius: '8px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--glass-border)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '0.85rem',
          }}
        >
          <label htmlFor="active-tracker-select" style={{ fontWeight: 600 }}>
            Active tracker:
          </label>
          <select
            id="active-tracker-select"
            value={activeTracker}
            onChange={(e) => activeTrackerMutation.mutate(e.currentTarget.value)}
            style={{
              padding: '0.4rem 0.6rem',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(255, 255, 255, 0.05)',
              color: 'var(--text-primary)',
              border: '1px solid var(--glass-border)',
              fontSize: 'var(--font-size-sm)',
              cursor: 'pointer',
            }}
          >
            {anilistConnected && <option value="anilist">AniList</option>}
            {malConnected && <option value="mal">MyAnimeList</option>}
          </select>
        </div>
      )}

      {!showMangaTrackers && (
        <>
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

            <AniListConnection />
            {anilistConnected && activeTracker !== 'anilist' && (
              <p style={{ color: 'var(--color-warning)', marginTop: '8px', fontSize: '0.85rem' }}>
                Not the active tracker - sync disabled.
              </p>
            )}

            {anilistConnected && activeTracker === 'anilist' && (
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
                      onChange={(e) => setPublicUsername(e.currentTarget.value)}
                      className={styles.input}
                      disabled={importMutation.isPending}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && publicUsername.trim()) importMutation.mutate()
                      }}
                    />
                  </div>
                ) : (
                  <p className={styles.syncHint}>
                    Merges progress non-destructively: pushes shows and episodes you watched on
                    dango to AniList, and pulls anything you updated on AniList into dango.
                  </p>
                )}

                {anilistImportMode === 'username' && (
                  <div className={styles.optionsArea}>
                    <label className={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={eraseWatchlist}
                        onChange={(e) => setEraseWatchlist(e.currentTarget.checked)}
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
              </>
            )}
          </div>
        </>
      )}
      {showMangaTrackers && (
        <>
          <div className={styles.importCard}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitleRow}>
                <Icon name="anilist" className={styles.anilistIcon} />
                <h3>AniList Manga</h3>
                {statusLoading ? null : anilistConnected ? (
                  <span className={styles.badgeOnline}>Connected</span>
                ) : (
                  <span className={styles.badgeOffline}>Not connected</span>
                )}
              </div>
            </div>

            <AniListConnection />
            {anilistConnected && activeTracker !== 'anilist' && (
              <p style={{ color: 'var(--color-warning)', marginTop: '8px', fontSize: '0.85rem' }}>
                Not the active tracker - sync disabled.
              </p>
            )}

            {anilistConnected && activeTracker === 'anilist' && (
              <>
                <hr className={styles.divider} />
                <div className={styles.radioGroup}>
                  <label className={styles.radioLabel}>
                    <input
                      type="radio"
                      name="mangaMode"
                      value="username"
                      checked={mangaImportMode === 'username'}
                      onChange={() => setMangaImportMode('username')}
                    />
                    <span>Quick Import</span>
                  </label>
                  <label className={styles.radioLabel}>
                    <input
                      type="radio"
                      name="mangaMode"
                      value="sync"
                      checked={mangaImportMode === 'sync'}
                      onChange={() => setMangaImportMode('sync')}
                    />
                    <span>Two-way Sync</span>
                  </label>
                </div>

                {mangaImportMode === 'username' ? (
                  <>
                    <div className={styles.inputGroup}>
                      <input
                        type="text"
                        placeholder="Enter AniList username"
                        value={mangaUsername}
                        onChange={(e) => setMangaUsername(e.currentTarget.value)}
                        className={styles.input}
                        disabled={mangaImportMutation.isPending}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && mangaUsername.trim())
                            mangaImportMutation.mutate()
                        }}
                      />
                    </div>
                    <div className={styles.optionsArea}>
                      <label className={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={eraseManga}
                          onChange={(e) => setEraseManga(e.currentTarget.checked)}
                          className={styles.checkbox}
                          disabled={mangaImportMutation.isPending}
                        />
                        <span className={styles.checkboxCustom}></span>
                        <div className={styles.optionText}>
                          <span className={styles.optionTitle}>Replace AniList-linked manga</span>
                          <span className={styles.optionDesc}>
                            Clears previously imported (anilist:) entries before importing. Your
                            provider bookmarks are never touched.
                          </span>
                        </div>
                      </label>
                    </div>
                  </>
                ) : (
                  <>
                    <p className={styles.syncHint}>
                      Merges chapter progress non-destructively: pushes manga and chapters you read
                      on dango to AniList, and pulls anything you updated on AniList into dango.
                      Local titles are linked only on exact title matches, and bookmarks with no
                      chapters read are never pushed.
                    </p>
                    <div className={styles.radioGroup}>
                      <label className={styles.radioLabel}>
                        <input
                          type="radio"
                          name="mangaDirection"
                          value="two-way"
                          checked={mangaDirection === 'two-way'}
                          onChange={() => setMangaDirection('two-way')}
                        />
                        <span>Two-way</span>
                      </label>
                      <label className={styles.radioLabel}>
                        <input
                          type="radio"
                          name="mangaDirection"
                          value="pull-only"
                          checked={mangaDirection === 'pull-only'}
                          onChange={() => setMangaDirection('pull-only')}
                        />
                        <span>Pull only (never writes to AniList)</span>
                      </label>
                    </div>
                  </>
                )}

                {mangaImportMode === 'username' ? (
                  <button
                    className={styles.syncBtn}
                    onClick={() => mangaImportMutation.mutate()}
                    disabled={!mangaUsername.trim() || mangaImportMutation.isPending}
                  >
                    <Icon name="download" />
                    {mangaImportMutation.isPending ? 'Importing...' : 'Start Import'}
                  </button>
                ) : (
                  <>
                    <button
                      className={styles.syncBtn}
                      onClick={() => mangaSyncMutation.mutate()}
                      disabled={mangaSyncMutation.isPending}
                    >
                      <Icon
                        name="sync-alt"
                        className={mangaSyncMutation.isPending ? styles.spin : ''}
                      />
                      {mangaSyncMutation.isPending ? 'Syncing...' : 'Start Manga Sync'}
                    </button>
                    {mangaSyncSummary && (
                      <>
                        <div className={styles.syncSummary}>
                          Pushed: {mangaSyncSummary.pushed} · Pulled: {mangaSyncSummary.pulled} ·
                          Merged: {mangaSyncSummary.merged} · Unchanged:{' '}
                          {mangaSyncSummary.unchanged}
                          {(mangaSyncSummary.skipped ?? 0) > 0 && (
                            <span> · Skipped: {mangaSyncSummary.skipped}</span>
                          )}
                          {mangaSyncSummary.errors.length > 0 && (
                            <span className={styles.syncErrors}>
                              {' '}
                              · {mangaSyncSummary.errors.length} error
                              {mangaSyncSummary.errors.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        {(mangaSyncSummary.warnings?.length ?? 0) > 0 && (
                          <div className={styles.syncErrors} style={{ marginTop: '8px' }}>
                            {(mangaSyncSummary.warnings ?? []).slice(0, 5).map((w, i) => (
                              <div key={i}>⚠ {w}</div>
                            ))}
                            {(mangaSyncSummary.warnings?.length ?? 0) > 5 && (
                              <div>
                                +{(mangaSyncSummary.warnings?.length ?? 0) - 5} more warning(s)
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
      {!showMangaTrackers && (
        <>
          <div className={styles.importCard}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitleRow}>
                <Icon name="myanimelist" className={styles.malIcon} />
                <h3>MyAnimeList</h3>
                {statusLoading ? null : malConnected ? (
                  <span className={styles.badgeOnline}>Connected</span>
                ) : (
                  <span className={styles.badgeOffline}>Not connected</span>
                )}
              </div>
            </div>

            <MalConnection active={activeTracker === 'mal'} />

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
                    onChange={(e) => setMalUsername(e.currentTarget.value)}
                    className={styles.input}
                    disabled={malUsernameImport.isPending}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && malUsername.trim())
                        malUsernameImport.mutate({
                          erase: eraseWatchlist,
                          useOfflineDb,
                          skipFallback,
                        })
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
                    <span className={styles.fileName}>
                      {selectedFileName || 'Choose XML file...'}
                    </span>
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
                  onChange={(e) => setEraseWatchlist(e.currentTarget.checked)}
                  className={styles.checkbox}
                  disabled={importing || malUsernameImport.isPending}
                />
                <span className={styles.checkboxCustom}></span>
                <div className={styles.optionText}>
                  <span className={styles.optionTitle}>Erase current watchlist</span>
                  <span className={styles.optionDesc}>
                    Delete existing watchlist before importing.
                  </span>
                </div>
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={useOfflineDb}
                  onChange={(e) => setUseOfflineDb(e.currentTarget.checked)}
                  className={styles.checkbox}
                  disabled={importing || malUsernameImport.isPending}
                />
                <span className={styles.checkboxCustom}></span>
                <div className={styles.optionText}>
                  <span className={styles.optionTitle}>Use offline database (fast)</span>
                  <span className={styles.optionDesc}>
                    Match by MAL ID locally first - instant and avoids AniList rate limits.
                  </span>
                </div>
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={skipFallback}
                  onChange={(e) => setSkipFallback(e.currentTarget.checked)}
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
        </>
      )}
      {showMangaTrackers && (
        <div className={styles.importCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitleRow}>
              <Icon name="myanimelist" className={styles.malIcon} />
              <h3>MyAnimeList Manga</h3>
              {statusLoading ? null : malConnected ? (
                <span className={styles.badgeOnline}>Connected</span>
              ) : (
                <span className={styles.badgeOffline}>Not connected</span>
              )}
            </div>
          </div>

          <MalConnection kind="manga" active={activeTracker === 'mal'} />

          <div className={styles.radioGroup}>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="malMangaMode"
                value="username"
                checked={malMangaImportMode === 'username'}
                onChange={() => setMalMangaImportMode('username')}
              />
              <span>Username</span>
            </label>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="malMangaMode"
                value="xml"
                checked={malMangaImportMode === 'xml'}
                onChange={() => setMalMangaImportMode('xml')}
              />
              <span>XML File</span>
            </label>
          </div>

          {malMangaImportMode === 'username' ? (
            <div className={styles.inputGroup}>
              <input
                type="text"
                placeholder="Enter MAL username"
                value={malMangaUsername}
                onChange={(e) => setMalMangaUsername(e.currentTarget.value)}
                className={styles.input}
                disabled={malMangaUsernameImport.isPending}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && malMangaUsername.trim()) malMangaUsernameImport.mutate()
                }}
              />
            </div>
          ) : (
            <div className={styles.uploadArea}>
              <div className={styles.fileInputWrapper}>
                <input
                  type="file"
                  id="malMangaFile"
                  accept=".xml,application/xml"
                  className={styles.fileInput}
                  onChange={(e) => setMalMangaFileName(e.currentTarget.files?.[0]?.name ?? '')}
                  disabled={malMangaXmlBusy}
                />
                <div className={styles.fileDisplay}>
                  <Icon name="file-alt" className={styles.fileIcon} />
                  <span className={styles.fileName}>
                    {malMangaFileName || 'Choose XML file...'}
                  </span>
                </div>
                <label htmlFor="malMangaFile" className={styles.browseButton}>
                  Browse
                </label>
              </div>
            </div>
          )}

          <div className={styles.optionsArea}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={eraseManga}
                onChange={(e) => setEraseManga(e.currentTarget.checked)}
                className={styles.checkbox}
                disabled={malMangaUsernameImport.isPending || malMangaXmlBusy}
              />
              <span className={styles.checkboxCustom}></span>
              <div className={styles.optionText}>
                <span className={styles.optionTitle}>Replace AniList-linked manga</span>
                <span className={styles.optionDesc}>
                  Clears previously imported (anilist:) entries before importing. Your provider
                  bookmarks are never touched.
                </span>
              </div>
            </label>
          </div>

          {malMangaImportMode === 'username' ? (
            <button
              className={styles.syncBtn}
              onClick={() => malMangaUsernameImport.mutate()}
              disabled={!malMangaUsername.trim() || malMangaUsernameImport.isPending}
            >
              <Icon name="download" />
              {malMangaUsernameImport.isPending ? 'Importing...' : 'Start Import'}
            </button>
          ) : (
            <div className={styles.actions}>
              <Button
                onClick={handleMalMangaXmlImport}
                className={styles.importBtn}
                disabled={malMangaXmlBusy || !malMangaFileName}
              >
                <Icon name="upload" /> {malMangaXmlBusy ? 'Importing...' : 'Start Import'}
              </Button>
            </div>
          )}

          {malMangaUsernameImport.isError && (
            <div className={`${styles.statusMessage} ${styles.error}`}>
              {malMangaUsernameImport.error.message}
            </div>
          )}

          {malMangaXmlError && (
            <div className={`${styles.statusMessage} ${styles.error}`}>{malMangaXmlError}</div>
          )}

          {malMangaXmlResult && (
            <div className={`${styles.statusMessage} ${styles.success}`}>
              Import complete! Imported: {malMangaXmlResult.imported}, Skipped:{' '}
              {malMangaXmlResult.skipped}.
            </div>
          )}

          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
              marginTop: '8px',
            }}
          >
            MAL manga is matched to AniList by MAL ID with a title fallback. Unmatched titles are
            skipped. Imports land as AniList-linked entries alongside your provider bookmarks.
          </p>
        </div>
      )}
    </div>
  )
}

export default Trackers
