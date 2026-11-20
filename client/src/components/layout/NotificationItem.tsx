import React from 'react'
import { Link } from 'react-router'
import Icon from '../common/Icon'
import FadeImage from '../common/FadeImage'
import { fixThumbnailUrl } from '../../lib/utils'
import type { InfoNotification, Notification } from '../../hooks/useAnimeData'
import type { TvInfoNotification, TvNotification } from '../../hooks/useTv'
import { tvDetailPath, tvWatchPath } from '../../lib/tv'
import { useTitlePreference } from '../../contexts/TitlePreferenceContext'
import {
  useAddToQueue,
  useDismissInfoNotification,
  useDismissNotification,
} from '../../hooks/useAnimeData'
import { useDismissTvInfoNotification, useDismissTvNotification } from '../../hooks/useTv'
import styles from './Notification.module.css'

interface NotificationItemProps {
  notification: Notification
}

const NotificationItem: React.FC<NotificationItemProps> = ({ notification }) => {
  const dismissMutation = useDismissNotification()
  const addQueueMutation = useAddToQueue()
  const [justQueued, setJustQueued] = React.useState(false)

  const handleDismiss = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dismissMutation.mutate({
      showId: notification.showId,
      episodeNumber: notification.episodeNumber,
    })
  }

  const handleQueue = (e: React.MouseEvent<HTMLElement>) => {
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
    <div className={styles.item}>
      <span className={styles.thumbWrap}>
        <FadeImage
          src={fixThumbnailUrl(notification.thumbnail, 48, 64)}
          alt={notification.name}
          className={styles.thumbnail}
          loading="lazy"
          decoding="async"
        />
      </span>
      <div className={styles.itemInfo}>
        <Link
          to={`/watch/${notification.showId}/${notification.episodeNumber}`}
          className={styles.itemTitleLink}
          onClick={() =>
            dismissMutation.mutate({
              showId: notification.showId,
              episodeNumber: notification.episodeNumber,
            })
          }
        >
          <span className={styles.itemTitle}>{displayTitle}</span>
        </Link>
        <span className={styles.itemMeta}>
          {notification.pendingCount > 1
            ? `Episode ${notification.episodeNumber}/${notification.latestEpisodeNumber} (${notification.pendingCount} new)`
            : `New Episode ${notification.episodeNumber}`}
        </span>
      </div>
      <button
        className={`${styles.removeItem} ${styles.queueItem}`}
        onClick={handleQueue}
        title="Add to queue"
        aria-label="Add notification to queue"
      >
        {justQueued ? <Icon name="check" /> : <Icon name="plus" />}
      </button>
      <button
        className={styles.removeItem}
        onClick={handleDismiss}
        title="Dismiss"
        aria-label="Remove notification"
      >
        <Icon name="times" />
      </button>
    </div>
  )
}

export const InfoNotificationItem: React.FC<{ notification: InfoNotification }> = ({
  notification,
}) => {
  const dismissMutation = useDismissInfoNotification()
  const { titlePreference } = useTitlePreference()
  const displayTitle =
    titlePreference === 'nativeName'
      ? notification.nativeName || notification.name
      : titlePreference === 'englishName'
        ? notification.englishName || notification.name
        : notification.name

  const airsLabel = new Date(notification.airingAt * 1000).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const handleDismiss = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dismissMutation.mutate({
      showId: notification.showId,
      episodeNumber: notification.episodeNumber,
    })
  }

  return (
    <div className={styles.item}>
      <span className={styles.thumbWrap}>
        <FadeImage
          src={fixThumbnailUrl(notification.thumbnail, 48, 64)}
          alt={notification.name}
          className={styles.thumbnail}
          loading="lazy"
          decoding="async"
        />
      </span>
      <div className={styles.itemInfo}>
        <Link to={`/anime/${notification.showId}`} className={styles.itemTitleLink}>
          <span className={styles.itemTitle}>{displayTitle}</span>
        </Link>
        <span className={styles.infoMeta}>
          Episode {notification.episodeNumber} · {airsLabel}
        </span>
      </div>
      <button
        className={styles.removeItem}
        onClick={handleDismiss}
        title="Dismiss"
        aria-label="Dismiss upcoming episode"
      >
        <Icon name="times" />
      </button>
    </div>
  )
}

export const TvNotificationItem: React.FC<{ notification: TvNotification }> = ({
  notification,
}) => {
  const dismissMutation = useDismissTvNotification()

  const handleDismiss = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dismissMutation.mutate({
      mediaId: notification.mediaId,
      season: notification.season,
      episode: notification.episode,
    })
  }

  const episodeLabel =
    notification.pendingCount > 1
      ? `S${notification.season}E${notification.episode} – S${notification.latestSeason}E${notification.latestEpisode} (${notification.pendingCount} new)`
      : `New Episode S${notification.season}E${notification.episode}`

  return (
    <div className={styles.item}>
      <span className={styles.thumbWrap}>
        <FadeImage
          src={fixThumbnailUrl(notification.thumbnail, 48, 64)}
          alt={notification.name}
          className={styles.thumbnail}
          loading="lazy"
          decoding="async"
        />
      </span>
      <div className={styles.itemInfo}>
        <Link
          to={tvWatchPath(
            notification.mediaType,
            notification.tmdbId,
            notification.season,
            notification.episode
          )}
          className={styles.itemTitleLink}
          onClick={() =>
            dismissMutation.mutate({
              mediaId: notification.mediaId,
              season: notification.season,
              episode: notification.episode,
            })
          }
        >
          <span className={styles.itemTitle}>{notification.name}</span>
        </Link>
        <span className={styles.itemMeta}>{episodeLabel}</span>
      </div>
      <button
        className={styles.removeItem}
        onClick={handleDismiss}
        title="Dismiss"
        aria-label="Remove notification"
      >
        <Icon name="times" />
      </button>
    </div>
  )
}

export const TvInfoNotificationItem: React.FC<{ notification: TvInfoNotification }> = ({
  notification,
}) => {
  const dismissMutation = useDismissTvInfoNotification()

  const airsLabel = new Date(notification.airingAt * 1000).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const handleDismiss = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dismissMutation.mutate({
      mediaId: notification.mediaId,
      season: notification.season,
      episode: notification.episode,
    })
  }

  return (
    <div className={styles.item}>
      <span className={styles.thumbWrap}>
        <FadeImage
          src={fixThumbnailUrl(notification.thumbnail, 48, 64)}
          alt={notification.name}
          className={styles.thumbnail}
          loading="lazy"
          decoding="async"
        />
      </span>
      <div className={styles.itemInfo}>
        <Link
          to={tvDetailPath(notification.mediaType, notification.tmdbId)}
          className={styles.itemTitleLink}
        >
          <span className={styles.itemTitle}>{notification.name}</span>
        </Link>
        <span className={styles.infoMeta}>
          S{notification.season}E{notification.episode} · {airsLabel}
        </span>
      </div>
      <button
        className={styles.removeItem}
        onClick={handleDismiss}
        title="Dismiss"
        aria-label="Dismiss upcoming episode"
      >
        <Icon name="times" />
      </button>
    </div>
  )
}

export default NotificationItem
