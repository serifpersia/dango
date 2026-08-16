import React, { useState } from 'react'
import { useSidebar } from '../hooks/useSidebar'
import { Button } from '../components/common/Button'
import { FaFileAlt, FaUpload, FaTrash } from 'react-icons/fa'
import styles from './MAL.module.css'

const MAL: React.FC = () => {
  const { setIsOpen } = useSidebar()

  React.useEffect(() => {
    document.title = 'MyAnimeList Import - dango'
  }, [])

  const [importStatus, setImportStatus] = useState<string>('')
  const [eraseWatchlist, setEraseWatchlist] = useState<boolean>(false)
  const [selectedFileName, setSelectedFileName] = useState<string>('')

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFileName(e.target.files[0].name)
    } else {
      setSelectedFileName('')
    }
  }

  const handleMalImport = async () => {
    const fileInput = document.getElementById('malFile') as HTMLInputElement
    if (!fileInput.files || fileInput.files.length === 0) {
      setImportStatus('Please select a file first.')
      return
    }

    const file = fileInput.files[0]
    setImportStatus('Importing...')

    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const response = await fetch('/api/import/mal-xml', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            xml: e.target?.result,
            erase: eraseWatchlist,
          }),
        })

        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || 'Failed to import watchlist.')
        }

        setImportStatus(
          `Import complete! Imported: ${result.imported}, Skipped: ${result.skipped}.`
        )
        setIsOpen(false)
      } catch (error: unknown) {
        setImportStatus(`Error: ${(error as Error).message}`)
      }
    }
    reader.onerror = () => {
      setImportStatus('Error reading file.')
    }
    reader.readAsText(file)
  }

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
          <Button onClick={handleMalImport} className={styles.importBtn}>
            <FaUpload /> Start Import
          </Button>
        </div>

        {importStatus && (
          <div
            className={`${styles.statusMessage} ${importStatus.includes('Error') ? styles.error : styles.success}`}
          >
            {importStatus}
          </div>
        )}
      </div>
    </div>
  )
}

export default MAL
