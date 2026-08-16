import React, { useState, useRef, useCallback } from 'react'
import { useSidebar } from '../hooks/useSidebar'
import { Button } from '../components/common/Button'
import { FaFileAlt, FaUpload } from 'react-icons/fa'
import styles from './MAL.module.css'

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

const MAL: React.FC = () => {
  const { setIsOpen } = useSidebar()

  React.useEffect(() => {
    document.title = 'MyAnimeList Import - dango'
  }, [])

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
  }, [eraseWatchlist])

  const handleCancel = () => {
    abortRef.current?.abort()
  }

  const progressPercent = progress ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div className="page-container">
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>MyAnimeList Import</h1>
        <p className={styles.pageSubtitle}>Transfer your anime list seamlessly to dango</p>
      </div>

      <div className={styles.importCard}>
        <div className={styles.cardHeader}>
          <h3>Import XML File</h3>
          <p>Upload your exported MyAnimeList XML file to sync your watchlist.</p>
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
              <div
                className={styles.progressFill}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className={styles.progressInfo}>
              <span className={styles.progressCount}>
                {progress.current} / {progress.total}
              </span>
              <span className={styles.progressTitle}>
                {progress.found ? (
                  <>
                    {progress.matchedTitle}
                    <span className={`${styles.sourceBadge} ${styles[progress.source || 'anilist']}`}>
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

        {error && (
          <div className={`${styles.statusMessage} ${styles.error}`}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

export default MAL
