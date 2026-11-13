import React, { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../common/Button'
import { trpcClient } from '../../lib/trpc'
import { fetchApi } from '../../lib/fetchApi'
import { qk } from '../../lib/queryKeys'
import styles from './LanAuthSettings.module.css'
import sharedStyles from './Settings.module.css'

const ProviderRegistrySettings: React.FC = () => {
  const [url, setUrl] = useState('')
  const [defaultUrl, setDefaultUrl] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState('')
  const queryClient = useQueryClient()

  useEffect(() => {
    trpcClient.settings.providerRegistry
      .query()
      .then((data) => {
        setUrl(data.url || '')
        setDefaultUrl(data.defaultUrl || '')
      })
      .catch(() => setStatus('Failed to load provider registry'))
      .finally(() => setIsLoading(false))
  }, [])

  const handleSave = async (next = url) => {
    const value = next.trim()
    setIsSubmitting(true)
    setStatus('')
    try {
      await trpcClient.settings.setProviderRegistry.mutate({ url: value })
      await fetchApi('/api/providers/refresh', { method: 'POST' }).catch(() => {})
      await queryClient.invalidateQueries({ queryKey: [qk.providers] })
      setUrl(value)
      setStatus(value ? 'Saved and refreshed.' : 'Reset to default and refreshed.')
    } catch (err) {
      setStatus((err as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className={sharedStyles.sectionCard}>
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div className={sharedStyles.sectionCard}>
      <h3>Provider Registry</h3>
      <p>Custom provider registry URL or local path. Leave empty to use the default registry.</p>
      <div className={styles.settingItem}>
        <div className={styles.field}>
          <label htmlFor="provider-registry-url">Registry URL</label>
          <input
            id="provider-registry-url"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            className={styles.input}
            placeholder={defaultUrl || 'https://.../registry.json'}
          />
        </div>
        <div className={styles.actions}>
          <Button
            variant="primary"
            onClick={() => handleSave()}
            loading={isSubmitting}
            disabled={isSubmitting}
          >
            Save & Refresh
          </Button>
          <Button variant="secondary" onClick={() => handleSave('')} disabled={isSubmitting}>
            Use Default
          </Button>
        </div>
        {status && <p className={styles.status}>{status}</p>}
      </div>
    </div>
  )
}

export default ProviderRegistrySettings
