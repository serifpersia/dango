import React, { useState, useCallback, useEffect } from 'react'
import {
  FaFolder,
  FaFolderOpen,
  FaSync,
  FaArrowLeft,
  FaArrowUp,
  FaSpinner,
  FaLink,
  FaPlay,
  FaSearch,
} from 'react-icons/fa'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useNavigate, useParams } from 'react-router'
import { fetchApi } from '../lib/fetchApi'
import styles from './LocalLibrary.module.css'

interface LocalSubtitle {
  language: string
  format: string
  filePath: string
}

interface LocalEpisode {
  number: string
  title: string
  filePath: string
  fileName: string
  fileSize: number | null
  durationSeconds: number | null
  subtitles: LocalSubtitle[]
  watched: boolean
  currentTime: number
  duration: number
}

interface LocalShow {
  localId: string
  anilistId: number | null
  malId: number | null
  name: string
  thumbnail: string | null
  episodeCount: number
  folderName: string
  detectedSeason: number
  folderPath?: string
  episodes?: LocalEpisode[]
}

interface ScanResult {
  libraryPath: string
  showCount: number
  shows: (LocalShow & { episodes: LocalEpisode[] })[]
}

const LocalLibrary: React.FC = () => {
  const navigate = useNavigate()
  const { localId } = useParams<{ localId: string }>()
  const queryClient = useQueryClient()
  const [libraryPathInput, setLibraryPathInput] = useState('')
  const [showBrowser, setShowBrowser] = useState(false)
  const [browserPath, setBrowserPath] = useState('')

  const { data: libraryPath, isLoading: pathLoading } = useQuery<string | null>({
    queryKey: ['localLibraryPath'],
    queryFn: async () => {
      const data = await fetchApi('/api/local/library-path')
      return data.path
    },
  })

  const { data: shows, isLoading: showsLoading } = useQuery<LocalShow[]>({
    queryKey: ['localShows'],
    queryFn: async () => {
      const data = await fetchApi('/api/local/shows')
      return data
    },
    enabled: !!libraryPath,
  })

  const { data: showDetail, isLoading: detailLoading } = useQuery<
    LocalShow & { episodes: LocalEpisode[] }
  >({
    queryKey: ['localShowDetail', localId],
    queryFn: async () => {
      const data = await fetchApi(`/api/local/shows/${localId}`)
      return data
    },
    enabled: !!localId,
  })

  useEffect(() => {
    if (localId) {
      document.title = showDetail?.name ? `${showDetail.name} - dango` : 'Local Library - dango'
    } else {
      document.title = 'Local Library - dango'
    }
  }, [localId, showDetail?.name])

  const { data: browseData } = useQuery<{
    path: string
    parent: string | null
    directories: { name: string; path: string }[]
  }>({
    queryKey: ['localBrowse', browserPath],
    queryFn: async () => {
      const data = await fetchApi(`/api/local/browse?path=${encodeURIComponent(browserPath)}`)
      return { ...data, directories: data.directories || [] }
    },
    enabled: showBrowser,
    placeholderData: { path: browserPath, parent: null, directories: [] },
  })

  const setPathMutation = useMutation({
    mutationFn: async (path: string) => {
      const res = await fetch('/api/local/library-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to set path')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Library path saved')
      queryClient.invalidateQueries({ queryKey: ['localLibraryPath'] })
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const scanMutation = useMutation({
    mutationFn: async (): Promise<ScanResult> => {
      const res = await fetch('/api/local/scan', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Scan failed')
      }
      return res.json()
    },
    onSuccess: (data) => {
      toast.success(`Found ${data.showCount} shows`)
      queryClient.invalidateQueries({ queryKey: ['localShows'] })
    },
    onError: (err: Error) => {
      toast.error(`Scan failed: ${err.message}`)
    },
  })

  const resolveMutation = useMutation({
    mutationFn: async (localId: string) => {
      const res = await fetch(`/api/local/shows/${localId}/resolve`, { method: 'POST' })
      if (!res.ok) throw new Error('Resolve failed')
      return res.json()
    },
    onSuccess: (data) => {
      toast.success(`Resolved: ${data.name}`)
      queryClient.invalidateQueries({ queryKey: ['localShows'] })
      queryClient.invalidateQueries({ queryKey: ['localShowDetail'] })
    },
    onError: (err: Error) => {
      toast.error(`Resolve failed: ${err.message}`)
    },
  })

  const unlinkMutation = useMutation({
    mutationFn: async (localId: string) => {
      const res = await fetch(`/api/local/shows/${localId}/link`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Unlink failed')
      return res.json()
    },
    onSuccess: () => {
      toast.success('Link removed — run Find Metadata again')
      queryClient.invalidateQueries({ queryKey: ['localShows'] })
      queryClient.invalidateQueries({ queryKey: ['localShowDetail'] })
    },
    onError: (err: Error) => {
      toast.error(`Unlink failed: ${err.message}`)
    },
  })

  const handleSetPath = useCallback(() => {
    if (libraryPathInput.trim()) {
      setPathMutation.mutate(libraryPathInput.trim())
    }
  }, [libraryPathInput, setPathMutation])

  const handleOpenBrowser = useCallback(() => {
    setBrowserPath(libraryPathInput || '')
    setShowBrowser(true)
  }, [libraryPathInput])

  const handleSelectDir = useCallback((dirPath: string) => {
    setLibraryPathInput(dirPath)
    setBrowserPath(dirPath)
  }, [])

  const handleConfirmBrowser = useCallback(() => {
    if (browseData?.path) {
      setPathMutation.mutate(browseData.path)
      setShowBrowser(false)
    }
  }, [browseData, setPathMutation])

  const handleScan = useCallback(() => {
    scanMutation.mutate()
  }, [scanMutation])

  const handlePlayEpisode = useCallback(
    (show: LocalShow, episode: LocalEpisode) => {
      navigate(`/watch/${show.localId}/${episode.number}`)
    },
    [navigate]
  )

  const handleResolve = useCallback(
    (localId: string) => {
      resolveMutation.mutate(localId)
    },
    [resolveMutation]
  )

  const formatFileSize = (bytes: number | null): string => {
    if (!bytes) return ''
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  if (localId) {
    const fallback = shows?.find((s) => s.localId === localId)
    const detail = showDetail || fallback
    if (!detail && !detailLoading) {
      return (
        <div className={styles.container}>
          <button className={styles.backBtn} onClick={() => navigate('/local')}>
            <FaArrowLeft /> Back to Library
          </button>
          <div className={styles.emptyState}>
            <p className={styles.emptyText}>Show not found</p>
          </div>
        </div>
      )
    }
    if (!detail) {
      return (
        <div className={styles.container}>
          <button className={styles.backBtn} onClick={() => navigate('/local')}>
            <FaArrowLeft /> Back to Library
          </button>
          <div className={styles.emptyState}>
            <FaSpinner className={`${styles.emptyIcon} ${styles.spinner}`} />
            <p className={styles.emptyText}>Loading...</p>
          </div>
        </div>
      )
    }
    return (
      <div className={styles.container}>
        <button className={styles.backBtn} onClick={() => navigate('/local')}>
          <FaArrowLeft /> Back to Library
        </button>

        <div className={styles.detailView}>
          <div className={styles.detailSidebar}>
            <img
              className={styles.detailPoster}
              src={detail.thumbnail || undefined}
              alt={detail.name}
              onError={(e) => {
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
              }}
            />
          </div>

          <div className={styles.detailContent}>
            <h1 className={styles.detailTitle}>{detail.name}</h1>
            <p className={styles.detailSub}>
              {detail.episodeCount} episodes
              {detail.detectedSeason > 1 && ` · Season ${detail.detectedSeason}`}
              {detail.folderName && ` · ${detail.folderName}`}
            </p>

            {!detail.anilistId && !detail.malId && (
              <button
                className={styles.resolveBtn}
                onClick={() => handleResolve(detail.localId)}
                disabled={resolveMutation.isPending}
              >
                {resolveMutation.isPending ? (
                  <FaSpinner className={styles.spinner} />
                ) : (
                  <FaSearch />
                )}
                Find Metadata Online
              </button>
            )}

            {detail.anilistId && (
              <p className={styles.detailSub}>
                <span className={`${styles.badge} ${styles.badgeStream}`}>AniList</span>
                Linked to AniList #{detail.anilistId}{' '}
                <button
                  className={styles.resolveBtn}
                  onClick={() => unlinkMutation.mutate(detail.localId)}
                  disabled={unlinkMutation.isPending}
                >
                  <FaLink /> Unlink
                </button>
              </p>
            )}

            <div className={styles.episodeList}>
              {detailLoading ? (
                <p className={styles.detailSub}>Loading episodes...</p>
              ) : detail.episodes && detail.episodes.length > 0 ? (
                detail.episodes.map((ep) => (
                  <div
                    key={ep.number}
                    className={styles.episodeItem}
                    onClick={() => handlePlayEpisode(detail, ep)}
                  >
                    <span className={styles.epNumber}>{ep.number}</span>
                    <span className={styles.epTitle}>{ep.title}</span>
                    {ep.fileSize && (
                      <span className={styles.detailSub}>{formatFileSize(ep.fileSize)}</span>
                    )}
                    {ep.subtitles.length > 0 && (
                      <div className={styles.epSubs}>
                        {ep.subtitles.slice(0, 3).map((sub, i) => (
                          <span key={i} className={styles.subBadge}>
                            {sub.language}
                          </span>
                        ))}
                      </div>
                    )}
                    <FaPlay size={12} style={{ opacity: 0.5 }} />
                  </div>
                ))
              ) : (
                <p className={styles.detailSub}>No episodes found</p>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <FaFolder className={styles.headerIcon} />
        <h1>Local Library</h1>
      </div>

      <div className={styles.configSection}>
        <label className={styles.configLabel}>Library Directory</label>
        <div className={styles.configRow}>
          <input
            className={styles.pathInput}
            type="text"
            placeholder={libraryPath || '/path/to/anime/folder'}
            value={libraryPathInput}
            onChange={(e) => setLibraryPathInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSetPath()}
          />
          <button className={styles.browseBtn} onClick={handleOpenBrowser} title="Browse folders">
            <FaFolderOpen />
          </button>
          <button
            className={styles.scanBtn}
            onClick={handleSetPath}
            disabled={setPathMutation.isPending || !libraryPathInput.trim()}
          >
            {setPathMutation.isPending ? <FaSpinner className={styles.spinner} /> : null}
            Set Path
          </button>
        </div>

        {libraryPath && (
          <div className={styles.statsRow}>
            <span>
              Current: <span className={styles.statValue}>{libraryPath}</span>
            </span>
          </div>
        )}

        <div className={styles.actionsRow}>
          <button
            className={styles.scanBtn}
            onClick={handleScan}
            disabled={scanMutation.isPending || !libraryPath}
          >
            {scanMutation.isPending ? <FaSpinner className={styles.spinner} /> : <FaSync />}
            {scanMutation.isPending ? 'Scanning...' : 'Scan Library'}
          </button>
        </div>
      </div>

      {showsLoading ? (
        <div className={styles.emptyState}>
          <FaSpinner className={`${styles.emptyIcon} ${styles.spinner}`} />
          <p className={styles.emptyText}>Loading...</p>
        </div>
      ) : shows && shows.length > 0 ? (
        <>
          <div className={styles.statsRow} style={{ marginBottom: 16 }}>
            <span>
              <span className={styles.statValue}>{shows.length}</span> shows in library
            </span>
          </div>
          <div className={styles.showsGrid}>
            {shows.map((show) => (
              <div
                key={show.localId}
                className={styles.showCard}
                onClick={() => navigate(`/local/${show.localId}`)}
              >
                {show.thumbnail ? (
                  <img
                    className={styles.showThumbnail}
                    src={show.thumbnail}
                    alt={show.name}
                    loading="lazy"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                    }}
                  />
                ) : (
                  <div
                    className={styles.showThumbnail}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 48,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {show.name[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <div className={styles.showInfo}>
                  <p className={styles.showTitle}>{show.name}</p>
                  <p className={styles.showMeta}>
                    {show.episodeCount} eps
                    {show.anilistId && (
                      <>
                        {' '}
                        <span className={`${styles.badge} ${styles.badgeStream}`}>AniList</span>
                      </>
                    )}
                    {!show.anilistId && !show.malId && (
                      <>
                        {' '}
                        <span className={`${styles.badge} ${styles.badgeLocal}`}>Local</span>
                      </>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className={styles.emptyState}>
          <FaFolder className={styles.emptyIcon} />
          <p className={styles.emptyText}>No shows in library</p>
          <p className={styles.emptyHint}>
            Set your library directory above and click "Scan Library"
          </p>
        </div>
      )}

      {showBrowser && (
        <div className={styles.browserOverlay}>
          <div className={styles.browserModal}>
            <div className={styles.browserHeader}>
              <FaFolderOpen className={styles.headerIcon} />
              <h2 className={styles.browserTitle}>Select Library Folder</h2>
            </div>

            <div className={styles.browserPathBar}>
              <input
                className={styles.pathInput}
                type="text"
                value={browseData?.path || browserPath}
                onChange={(e) => setBrowserPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setBrowserPath(e.currentTarget.value)}
              />
            </div>

            <div className={styles.browserList}>
              {browseData?.parent && (
                <div
                  className={styles.browserItem}
                  onClick={() => setBrowserPath(browseData.parent!)}
                >
                  <FaArrowUp className={styles.browserItemIcon} />
                  <span>..</span>
                </div>
              )}
              {browseData?.directories.map((dir) => (
                <div
                  key={dir.path}
                  className={styles.browserItem}
                  onClick={() => handleSelectDir(dir.path)}
                  onDoubleClick={() => setBrowserPath(dir.path)}
                >
                  <FaFolder className={styles.browserItemIcon} />
                  <span>{dir.name}</span>
                </div>
              ))}
              {browseData && browseData.directories.length === 0 && (
                <div className={styles.browserEmpty}>No subfolders</div>
              )}
            </div>

            <div className={styles.browserActions}>
              <button className={styles.backBtn} onClick={() => setShowBrowser(false)}>
                Cancel
              </button>
              <button
                className={styles.scanBtn}
                onClick={handleConfirmBrowser}
                disabled={!browseData?.path}
              >
                Select This Folder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default LocalLibrary
