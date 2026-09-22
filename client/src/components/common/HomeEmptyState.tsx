import React from 'react'
import Icon, { type IconName } from './Icon'
import { Button } from './Button'
import styles from './HomeEmptyState.module.css'

interface HomeEmptyStateProps {
  icon: IconName
  text: string
  actionLabel: string
  onAction: () => void
  title?: string
}

const HomeEmptyState: React.FC<HomeEmptyStateProps> = ({
  icon,
  text,
  actionLabel,
  onAction,
  title = 'Nothing is here...',
}) => {
  return (
    <div className={styles.emptyState}>
      <Icon name={icon} size={48} className={styles.emptyStateIcon} />
      <div>
        <h3 className={styles.emptyStateTitle}>{title}</h3>
        <p className={styles.emptyStateText}>{text}</p>
      </div>
      <Button variant="primary" size="sm" onClick={onAction} style={{ marginTop: '1rem' }}>
        {actionLabel}
      </Button>
    </div>
  )
}

export default HomeEmptyState
