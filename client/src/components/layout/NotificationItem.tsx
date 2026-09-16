import React from 'react'
import { Link } from 'react-router'
import Icon from '../common/Icon'
import { fixThumbnailUrl } from '../../lib/utils'
import type { Notification } from '../../hooks/useAnimeData'
import { useTitlePreference } from '../../contexts/TitlePreferenceContext'
import { useAddToQueue, useDismissNotification } from '../../hooks/useAnimeData'
import styles from './Notification.module.css'

interface NotificationItemProps {
  notification: Notification
}

const NotificationItem: React.FC<NotificationItemProps> = ({ notification }) => {
  const dismissMutation = useDismissNotification()
  const addQueueMutation = useAddToQueue()
  const [justQueued, setJustQueued] = React.useState(false)

  const handleDismiss = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dismissMutation.mutate({
      showId: notification.showId,
      episodeNumber: notification.episodeNumber,
    })
  }

  const handleClick = () => {
    dismissMutation.mutate({
      showId: notification.showId,
      episodeNumber: notification.episodeNumber,
    })
  }

  const handleQueue = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setJustQueued(true)
    addQueueMutation.mutate({
      showId: notification.showId,
      episodeNumber: notification.episodeNumber,
      showName: notification.name,
      showThumbnail: notification.thumbnail,
      nativeName: notification.nativeName,
      englishName: notification.englishName,
    })
    dismissMutation.mutate({
      showId: notification.showId,
      episodeNumber: notification.episodeNumber,
    })
    window.setTimeout(() => setJustQueued(false), 1000)
  }

  const { titlePreference } = useTitlePreference()
  const displayTitle =
    titlePreference === 'nativeName'
      ? notification.nativeName || notification.name
      : titlePreference === 'englishName'
        ? notification.englishName || notification.name
        : notification.name

  return (
    <Link
      to={`/watch/${notification.showId}/${notification.episodeNumber}`}
      className={styles.item}
      onClick={handleClick}
    >
      <img
        src={fixThumbnailUrl(notification.thumbnail, 48, 64)}
        alt={notification.name}
        className={styles.thumbnail}
        loading="lazy"
        decoding="async"
      />
      <div className={styles.itemInfo}>
        <span className={styles.itemTitle}>{displayTitle}</span>
        <span className={styles.itemMeta}>New Episode {notification.episodeNumber}</span>
      </div>
      <button
        className={`${styles.removeItem} ${styles.queueItem}`}
        onClick={handleQueue}
        aria-label="Add notification to queue"
      >
        {justQueued ? <Icon name="check" /> : <Icon name="plus" />}
      </button>
      <button
        className={styles.removeItem}
        onClick={handleDismiss}
        aria-label="Remove notification"
      >
        <Icon name="times" />
      </button>
    </Link>
  )
}

export default NotificationItem
