import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import type { Action } from '../reducers/playerReducer'
import type { QueueItem } from '../hooks/useAnimeData'
import { isShowFinishedStatus } from '../lib/playbackCompletion'

export const matchesQueueItem = (
  item: QueueItem,
  id: string | undefined,
  metaId: string | undefined
) => item.showId === id || (!!metaId && item.showId === metaId)

interface UseEpisodeEndFlowOptions {
  testClipActive: boolean
  selectedSourceType?: string
  onEnded: () => void
  queue: QueueItem[]
  removeFromQueue: (vars: { showId: string; episodeNumber: string }) => void
  showId: string | undefined
  showMetaId?: string
  showStatus?: string
  currentEpisode?: string | null
  isAutoplayEnabled: boolean
  nextEpisode: string | null
  previousEpisode: string | null
  navigate: (to: string) => void
  invalidateContinueWatching: () => void
  dispatch: React.Dispatch<Action>
}

// what happens when an episode ends: the queue, the autoplay, the next and
// the previous episode
export function useEpisodeEndFlow({
  testClipActive,
  selectedSourceType,
  onEnded,
  queue,
  removeFromQueue,
  showId,
  showMetaId,
  showStatus,
  currentEpisode,
  isAutoplayEnabled,
  nextEpisode,
  previousEpisode,
  navigate,
  invalidateContinueWatching,
  dispatch,
}: UseEpisodeEndFlowOptions) {
  const [showCompleteModal, setShowCompleteModal] = useState(false)
  const [queueCountdown, setQueueCountdown] = useState<number | null>(null)
  const [pendingQueueTransition, setPendingQueueTransition] = useState<{
    nextItem: QueueItem | null
    playedItem: QueueItem | null
  } | null>(null)
  const removeFromQueueRef = useRef(removeFromQueue)
  removeFromQueueRef.current = removeFromQueue
  const handledEndRef = useRef(false)
  const isShowFinished = isShowFinishedStatus(showStatus)

  useEffect(() => {
    handledEndRef.current = false
    setShowCompleteModal(false)
  }, [showId, currentEpisode])

  const handlePlaybackFinished = useCallback(() => {
    if (testClipActive || handledEndRef.current) return
    handledEndRef.current = true
    onEnded()

    const itemToRemove = queue.find(
      (item) => matchesQueueItem(item, showId, showMetaId) && item.episodeNumber === currentEpisode
    )

    if (queue.length > 0) {
      const activeQueueIndex = queue.findIndex(
        (item) =>
          matchesQueueItem(item, showId, showMetaId) && item.episodeNumber === currentEpisode
      )

      const nextItem = activeQueueIndex >= 0 ? queue[activeQueueIndex + 1] || null : queue[0]

      setPendingQueueTransition({ nextItem, playedItem: itemToRemove || null })
      setQueueCountdown(2)
      return
    }

    if (itemToRemove) {
      removeFromQueueRef.current({
        showId: itemToRemove.showId,
        episodeNumber: itemToRemove.episodeNumber,
      })
    }

    if (isAutoplayEnabled && nextEpisode) {
      invalidateContinueWatching()
      navigate(`/watch/${showId}/${nextEpisode}`)
      return
    }

    if (!nextEpisode && isShowFinished) setShowCompleteModal(true)
  }, [
    onEnded,
    navigate,
    queue,
    showId,
    showMetaId,
    currentEpisode,
    nextEpisode,
    isAutoplayEnabled,
    invalidateContinueWatching,
    testClipActive,
    isShowFinished,
  ])

  const handleQueueTransition = useCallback(() => {
    if (queue.length === 0) return

    onEnded()

    const itemToRemove = queue.find(
      (item) => matchesQueueItem(item, showId, showMetaId) && item.episodeNumber === currentEpisode
    )
    const activeQueueIndex = queue.findIndex(
      (item) => matchesQueueItem(item, showId, showMetaId) && item.episodeNumber === currentEpisode
    )
    const nextItem = activeQueueIndex >= 0 ? queue[activeQueueIndex + 1] || null : queue[0]

    if (itemToRemove) {
      removeFromQueue({
        showId: itemToRemove.showId,
        episodeNumber: itemToRemove.episodeNumber,
      })
    }

    if (nextItem) {
      navigate(`/watch/${nextItem.showId}/${nextItem.episodeNumber}`)
    } else if (!nextEpisode && isShowFinished) {
      setShowCompleteModal(true)
    }
  }, [
    onEnded,
    navigate,
    queue,
    removeFromQueue,
    showId,
    showMetaId,
    currentEpisode,
    nextEpisode,
    isShowFinished,
  ])

  const handleNextEpisode = useCallback(() => {
    if (nextEpisode) {
      invalidateContinueWatching()
      navigate(`/watch/${showId}/${nextEpisode}`)
    }
    setShowCompleteModal(false)
    dispatch({ type: 'SET_STATE', payload: { showResumeModal: false } })
  }, [nextEpisode, navigate, showId, dispatch, invalidateContinueWatching])

  const handleNShortcut = useCallback(() => {
    if (queue.length > 0) {
      handleQueueTransition()
    } else if (nextEpisode) {
      handleNextEpisode()
    } else {
      toast.error('No next episode available')
    }
  }, [queue.length, handleQueueTransition, handleNextEpisode, nextEpisode])

  const closeCompleteModal = useCallback(() => setShowCompleteModal(false), [])

  const cancelQueueTransition = useCallback(() => {
    setPendingQueueTransition(null)
    setQueueCountdown(null)
  }, [])

  const handlePreviousEpisode = useCallback(() => {
    if (previousEpisode) {
      navigate(`/watch/${showId}/${previousEpisode}`)
    }
  }, [previousEpisode, navigate, showId])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (selectedSourceType !== 'iframe') return
      if (event.data?.type !== 'ANI_WEB_MEDIA_ENDED') return

      handlePlaybackFinished()
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handlePlaybackFinished, selectedSourceType])

  useEffect(() => {
    if (!pendingQueueTransition || queueCountdown === null) return

    if (queueCountdown <= 0) {
      const { nextItem, playedItem } = pendingQueueTransition
      setPendingQueueTransition(null)
      setQueueCountdown(null)

      if (playedItem) {
        removeFromQueueRef.current({
          showId: playedItem.showId,
          episodeNumber: playedItem.episodeNumber,
        })
      }

      if (nextItem) {
        navigate(`/watch/${nextItem.showId}/${nextItem.episodeNumber}`)
      } else if (!nextEpisode && isShowFinished) {
        setShowCompleteModal(true)
      }
      return
    }

    const timer = window.setTimeout(() => {
      setQueueCountdown((value) => (value === null ? null : value - 1))
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [pendingQueueTransition, queueCountdown, navigate, nextEpisode, isShowFinished])

  return {
    showCompleteModal,
    queueCountdown,
    pendingQueueTransition,
    handleQueueTransition,
    handleNextEpisode,
    handleNShortcut,
    handlePreviousEpisode,
    handlePlaybackFinished,
    closeCompleteModal,
    cancelQueueTransition,
  }
}
