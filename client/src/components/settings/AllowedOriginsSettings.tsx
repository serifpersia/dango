import React, { useEffect, useState } from 'react'
import { Button } from '../common/Button'
import { trpcClient } from '../../lib/trpc'
import styles from './LanAuthSettings.module.css'
import sharedStyles from './Settings.module.css'

const AllowedOriginsSettings: React.FC = () => {
  const [origins, setOrigins] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    trpcClient.auth.allowedOrigins
      .query()
      .then((data) => setOrigins(data.origins.join(', ')))
      .catch(() => setStatus('Failed to load allowed origins'))
      .finally(() => setIsLoading(false))
  }, [])

  const handleSave = async () => {
    setIsSubmitting(true)
    setStatus('')
    try {
      const result = await trpcClient.auth.setAllowedOrigins.mutate({ origins })
      setOrigins(result.origins.join(', '))
      setStatus('Saved.')
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
      <h3>Allowed Origins</h3>
      <p>
        Extra browser origins allowed to call the API, comma-separated. Include the scheme (e.g.{' '}
        <code>https://example.com</code>). Same-origin access and reverse proxies that forward
        X-Forwarded-Host/X-Forwarded-Proto work automatically.
      </p>

      <div className={styles.settingItem}>
        <div className={styles.field}>
          <label htmlFor="allowed-origins">Origins</label>
          <input
            id="allowed-origins"
            value={origins}
            onChange={(e) => setOrigins(e.currentTarget.value)}
            className={styles.input}
            placeholder="https://example.com"
          />
        </div>
        <div className={styles.actions}>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={isSubmitting}
            disabled={isSubmitting}
          >
            Save Origins
          </Button>
        </div>
        {status && <p className={styles.status}>{status}</p>}
      </div>
    </div>
  )
}

export default AllowedOriginsSettings
