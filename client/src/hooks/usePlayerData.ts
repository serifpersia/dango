import { useEffect, useCallback, useReducer, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type {
  DetailedShowMeta,
  VideoSource,
  VideoLink,
  SkipInterval,
  PlayerState,
} from '../types/player'
import { playerReducer, createInitialState, type Action } from '../reducers/playerReducer'
import { fetchApi } from '../lib/fetchApi'
import { useShowMeta } from './useShowMeta'

interface UsePlayerDataReturn {
  state: PlayerState
  dispatch: React.Dispatch<Action>
  toggleWatchlist: () => Promise<void>
  moveToCompleted: () => Promise<void>
  setPreferredSource: (sourceName: string) => Promise<void>
  handleToggleDetails: () => Promise<void>
  markEpisodeWatched: (episodeNumber: string, duration: number) => Promise<void>
  prefetchEpisodeSources: (episodeNumber: string, targetShowId?: string) => void
  isMarkingWatched: boolean
  isUpdatingWatchlistStatus: boolean
}

interface RawSkipInterval {
  skip_id?: string
  skip_type?: string
  interval?: {
    start_time: number
    end_time: number
  }
  start_time?: number
  end_time?: number
}

interface VideoFetchUiState {
  selectedProvider: PlayerState['selectedProvider']
  currentMode: 'sub' | 'dub'
}

export interface FetchedVideoData {
  videoSources: VideoSource[]
  selectedSource: VideoSource | null
  selectedLink: VideoLink | null
  resumeTime: number
  resumeDuration: number
  showResumeModal: boolean
  skipIntervals: SkipInterval[]
  fetchedEpisodeNumber: string
}

async function fetchVideoSources(
  showId: string | undefined,
  episodeNumber: string | undefined,
  ui: VideoFetchUiState,
  dispatch: React.Dispatch<Action>,
  silentToast: boolean = false
): Promise<FetchedVideoData> {
  if (!showId || !episodeNumber) throw new Error('Missing params')

  try {
    const [sources, progress, preferredSourceData, skipTimesData] = await Promise.all([
      fetchApi(
        `/api/video?showId=${showId}&episodeNumber=${episodeNumber}&mode=${ui.currentMode}&provider=${ui.selectedProvider}`
      ).catch(() => null),
      fetchApi(`/api/episode-progress/${showId}/${episodeNumber}`).catch(() => null),
      fetchApi(`/api/settings?key=preferredSource`).catch(() => null),
      fetchApi(`/api/skip-times/${showId}/${episodeNumber}`).catch(() => []),
    ])

    const preferredSourceName = preferredSourceData?.value

    const modeMatchedSources =
      (sources as VideoSource[] | null)?.filter((s) => {
        const name = s.sourceName.toLowerCase()
        if (ui.currentMode === 'dub') {
          return name.includes('eng') || name.includes('dub')
        } else {
          return (
            name.includes('jpn') ||
            name.includes('sub') ||
            (!name.includes('eng') && !name.includes('dub'))
          )
        }
      }) ?? []

    const pool =
      modeMatchedSources.length > 0 ? modeMatchedSources : ((sources as VideoSource[] | null) ?? [])
    let sourceToSelect: VideoSource | null = pool.length > 0 ? pool[0] : null

    if (preferredSourceName) {
      const found = pool.find((s: VideoSource) => s.sourceName === preferredSourceName)
      if (found) sourceToSelect = found
    }

    const selectedLink =
      sourceToSelect && sourceToSelect.links.length > 0
        ? sourceToSelect.links.sort(
            (a: VideoLink, b: VideoLink) =>
              (parseInt(b.resolutionStr) || 0) - (parseInt(a.resolutionStr) || 0)
          )[0]
        : null

    const resumeTime = progress?.currentTime || 0
    const resumeDuration = progress?.duration || 0
    const rawSkips = Array.isArray(skipTimesData) ? skipTimesData : skipTimesData?.results || []

    const skipIntervals: SkipInterval[] = rawSkips
      .map((item: RawSkipInterval) => ({
        skip_id: item.skip_id || '',
        skip_type: item.skip_type || '',
        start_time: item.interval?.start_time ?? item.start_time ?? 0,
        end_time: item.interval?.end_time ?? item.end_time ?? 0,
      }))
      .filter((i: SkipInterval) => i.end_time > 0)

    if (!sources || sources.length === 0) {
      if (!silentToast) {
        toast.error(`No video sources found for ${ui.selectedProvider}`)
      }
    }

    return {
      videoSources: sources as VideoSource[],
      selectedSource: sourceToSelect,
      selectedLink,
      resumeTime,
      resumeDuration,
      showResumeModal: resumeTime > 5 && sourceToSelect?.type !== 'iframe',
      skipIntervals,
      fetchedEpisodeNumber: episodeNumber,
    }
  } catch (e) {
    const error = e as Error & { provider?: string }
    if (error.message === 'AUTH_REQUIRED') {
      dispatch({
        type: 'SET_STATE',
        payload: { showCookieModal: true, cookieProvider: error.provider },
      })
      return {
        videoSources: [],
        selectedSource: null,
        selectedLink: null,
        resumeTime: 0,
        resumeDuration: 0,
        showResumeModal: false,
        skipIntervals: [],
        fetchedEpisodeNumber: episodeNumber,
      }
    }
    throw e
  }
}

export const usePlayerData = (
  showId: string | undefined,
  episodeNumber: string | undefined,
  initialMeta?: Record<string, unknown> | null,
  options?: { hasMatureConsent?: boolean }
): UsePlayerDataReturn => {
  const [uiState, dispatch] = useReducer(playerReducer, initialMeta, (meta) => ({
    ...createInitialState(),
    showMeta: meta?.name
      ? {
          name: meta.name as string,
          thumbnail: meta.thumbnail as string,
          nativeName: meta.nativeName as string,
          englishName: meta.englishName as string,
          names: {
            romaji: (meta.englishName as string) || (meta.name as string),
            english: (meta.englishName as string) || (meta.name as string),
            native: meta.nativeName as string,
          },
        }
      : {},
  }))
  const queryClient = useQueryClient()
  const hasForcedProvider = useRef<string | null>(null)
  const hasForcedAdultProvider = useRef<string | null>(null)

  const currentEpisode = episodeNumber || uiState.initialEpisode

  const previousEpisodeRef = useRef(currentEpisode)

  useEffect(() => {
    if (previousEpisodeRef.current !== currentEpisode) {
      previousEpisodeRef.current = currentEpisode
      dispatch({ type: 'SET_STATE', payload: { selectedSource: null, selectedLink: null } })
    }
  }, [currentEpisode, dispatch])

  useEffect(() => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (
      showId &&
      UUID_RE.test(showId) &&
      uiState.selectedProvider !== 'animepahe' &&
      hasForcedProvider.current !== showId
    ) {
      hasForcedProvider.current = showId
      dispatch({ type: 'SET_PROVIDER', payload: 'animepahe' })
    }
  }, [showId, uiState.selectedProvider])

  const { data: showMeta, isLoading: loadingShowData, error: showDataError } = useShowMeta(showId)

  const { data: playerData } = useQuery({
    queryKey: ['player-data', showId, uiState.currentMode],
    queryFn: async () => {
      if (!showId) throw new Error('No showId')

      const fetchEpisodes = async (): Promise<{
        episodes: string[]
        description?: string
      } | null> => {
        try {
          const data = await fetchApi(`/api/episodes?showId=${showId}&mode=${uiState.currentMode}`)
          if (data?.episodes?.length) return data
        } catch {
          // ignore
        }
        return null
      }

      const [episodeData, watchlistStatus, watchedEpisodes] = await Promise.all([
        fetchEpisodes(),
        fetchApi(`/api/watchlist/check/${showId}`).catch(() => ({ inWatchlist: false })),
        fetchApi(`/api/watched-episodes/${showId}`).catch(() => []),
      ])

      const episodes = episodeData?.episodes
        ? episodeData.episodes.sort((a: string, b: string) => parseFloat(a) - parseFloat(b))
        : []

      return {
        description: episodeData?.description || '',
        episodes,
        inWatchlist: watchlistStatus.inWatchlist,
        watchlistStatus: watchlistStatus.status ?? null,
        watchedEpisodes,
      }
    },
    enabled: !!showId,
  })

  useEffect(() => {
    if (
      !episodeNumber &&
      playerData?.episodes &&
      playerData.episodes.length > 0 &&
      !episodeNumber
    ) {
      dispatch({ type: 'SET_STATE', payload: { initialEpisode: playerData.episodes[0] } })
    }
  }, [playerData, episodeNumber])

  useEffect(() => {
    if (showMeta?.isAdult === undefined) return
    const matureProvider =
      uiState.selectedProvider === 'wh' ||
      uiState.selectedProvider === 'hn' ||
      uiState.selectedProvider === 'ht' ||
      uiState.selectedProvider === 'op'
    if (hasForcedAdultProvider.current === showId) return
    if (showMeta.isAdult && !matureProvider) {
      hasForcedAdultProvider.current = showId
      dispatch({ type: 'SET_PROVIDER', payload: 'wh' })
    }
    if (!showMeta.isAdult && matureProvider) {
      hasForcedAdultProvider.current = showId
      dispatch({ type: 'SET_PROVIDER', payload: 'animepahe' })
    }
  }, [showMeta?.isAdult, uiState.selectedProvider, showId])

  const {
    data: videoData,
    isLoading: loadingVideo,
    error: videoError,
  } = useQuery({
    queryKey: [
      'video-sources',
      showId,
      currentEpisode,
      uiState.selectedProvider,
      uiState.currentMode,
    ],
    queryFn: () => fetchVideoSources(showId, currentEpisode, uiState, dispatch),
    enabled:
      !!showId &&
      !!currentEpisode &&
      !(uiState.showMeta?.isAdult === true && !options?.hasMatureConsent),
  })

  const loadingDetails = false

  const { mutateAsync: toggleWatchlistMutation } = useMutation({
    mutationFn: async ({ wasIn, showMeta }: { wasIn: boolean; showMeta: DetailedShowMeta }) => {
      const endpoint = wasIn ? '/api/watchlist/remove' : '/api/watchlist/add'
      const payload = {
        id: showId,
        name: showMeta.name || showMeta.names?.romaji,
        thumbnail: showMeta.thumbnail,
        nativeName: showMeta.names?.native,
        englishName: showMeta.names?.english,
        type: showMeta.type,
      }
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return !wasIn
    },
    onSuccess: (newInWatchlist) => {
      toast.success(newInWatchlist ? 'Added to watchlist' : 'Removed from watchlist')
      queryClient.invalidateQueries({ queryKey: ['player-data', showId] })
      queryClient.invalidateQueries({ queryKey: ['show-data', showId] })
      queryClient.invalidateQueries({ queryKey: ['watchlist'] })
    },
    onError: () => toast.error('Failed to update watchlist'),
  })

  const toggleWatchlist = useCallback(async () => {
    if (!showId || !showMeta) return
    await toggleWatchlistMutation({
      wasIn: !!playerData?.inWatchlist,
      showMeta: showMeta as DetailedShowMeta,
    })
  }, [showId, showMeta, playerData?.inWatchlist, toggleWatchlistMutation])

  const setPreferredSource = useCallback(async (sourceName: string) => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'preferredSource', value: sourceName }),
      })
    } catch (e) {
      console.error(e)
    }
  }, [])

  const { mutateAsync: updateWatchlistStatusMutation, isPending: isUpdatingWatchlistStatus } =
    useMutation({
      mutationFn: async ({ status }: { status: string }) => {
        if (!showId) throw new Error('Missing showId')

        const response = await fetch('/api/watchlist/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: showId, status }),
        })

        if (!response.ok) {
          throw new Error('Failed to update watchlist status')
        }

        return status
      },
      onSuccess: (status) => {
        dispatch({ type: 'SET_STATE', payload: { inWatchlist: true, watchlistStatus: status } })
        toast.success(`Moved to ${status}`)
        queryClient.invalidateQueries({ queryKey: ['show-data', showId] })
        queryClient.invalidateQueries({ queryKey: ['watchlist'] })
        queryClient.invalidateQueries({ queryKey: ['continueWatchingFast'] })
        queryClient.invalidateQueries({ queryKey: ['continueWatchingUpNext'] })
        queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
      },
      onError: () => toast.error('Failed to update watchlist status'),
    })

  const moveToCompleted = useCallback(async () => {
    await updateWatchlistStatusMutation({ status: 'Completed' })
  }, [updateWatchlistStatusMutation])

  const { mutateAsync: markEpisodeWatchedMutation } = useMutation({
    mutationFn: async ({
      episodeNumber,
      duration,
      showMeta,
      episodes,
    }: {
      episodeNumber: string
      duration: number
      showMeta: DetailedShowMeta
      episodes: string[]
    }) => {
      await fetch('/api/update-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          showId,
          episodeNumber,
          currentTime: duration,
          duration: duration,
          showName: showMeta.name,
          showThumbnail: showMeta.thumbnail,
          nativeName: showMeta.names?.native,
          englishName: showMeta.names?.english,
          genres: showMeta.genres?.map((genre) => genre.name),
          popularityScore: showMeta.score ?? showMeta.stats?.averageScore,
          type: showMeta.type,
          status: showMeta.status,
          episodeCount: episodes.length,
          isAdult: showMeta.isAdult,
        }),
        keepalive: true,
      })
    },
    onSuccess: (data, variables) => {
      toast.success(`Episode ${variables.episodeNumber} marked as watched`)
      queryClient.invalidateQueries({ queryKey: ['player-data', showId] })
      queryClient.invalidateQueries({ queryKey: ['show-meta', showId] })
      queryClient.invalidateQueries({
        queryKey: ['video-sources', showId, variables.episodeNumber],
      })
      queryClient.invalidateQueries({ queryKey: ['continueWatchingFast'] })
      queryClient.invalidateQueries({ queryKey: ['continueWatchingUpNext'] })
    },
    onError: () => toast.error('Failed to mark episode as watched'),
  })

  const markEpisodeWatched = useCallback(
    async (episodeNumber: string, duration: number) => {
      if (!showId || !showMeta) return
      await markEpisodeWatchedMutation({
        episodeNumber,
        duration,
        showMeta: showMeta as DetailedShowMeta,
        episodes: playerData?.episodes || [],
      })
    },
    [showId, showMeta, playerData?.episodes, markEpisodeWatchedMutation]
  )

  const handleToggleDetails = useCallback(async () => {
    dispatch({ type: 'SET_STATE', payload: { showCombinedDetails: !uiState.showCombinedDetails } })
  }, [uiState.showCombinedDetails])

  // DERIVED STATE
  const state = useMemo(() => {
    const error = showDataError || videoError
    const errorMessage = error ? (error as Error).message : null
    const finalError = errorMessage === 'AUTH_REQUIRED' ? null : errorMessage

    const videoDataForEpisode =
      videoData && videoData.fetchedEpisodeNumber === currentEpisode ? videoData : null
    const videoDataMismatched = !!videoData && !videoDataForEpisode

    return {
      ...uiState,
      currentEpisode,
      showMeta: {
        ...(uiState.showMeta || {}),
        ...(showMeta || {}),
      },
      episodes: playerData?.episodes || [],
      watchedEpisodes: playerData?.watchedEpisodes || [],
      inWatchlist: !!playerData?.inWatchlist,
      watchlistStatus: playerData?.watchlistStatus ?? uiState.watchlistStatus ?? null,
      videoSources: videoDataForEpisode?.videoSources || [],
      selectedSource: uiState.selectedSource || videoDataForEpisode?.selectedSource || null,
      selectedLink: uiState.selectedLink || videoDataForEpisode?.selectedLink || null,
      resumeTime: videoDataForEpisode?.resumeTime || 0,
      resumeDuration: videoDataForEpisode?.resumeDuration || 0,
      showResumeModal: uiState.showResumeModal && (videoDataForEpisode?.showResumeModal ?? false),
      skipIntervals: videoDataForEpisode?.skipIntervals || [],
      loadingShowData,
      loadingVideo: loadingVideo || videoDataMismatched,
      loadingDetails,
      error: finalError,
      fetchedEpisodeNumber: videoDataForEpisode?.fetchedEpisodeNumber,
    }
  }, [
    uiState,
    showMeta,
    playerData,
    videoData,
    loadingShowData,
    loadingVideo,
    loadingDetails,
    showDataError,
    videoError,
    currentEpisode,
  ])

  const prefetchEpisodeSources = useCallback(
    (episodeNumber: string, targetShowId?: string) => {
      const id = targetShowId || showId
      if (!id || !episodeNumber) return
      if (id === showId && episodeNumber === currentEpisode) return

      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      const provider =
        UUID_RE.test(id) && uiState.selectedProvider !== 'animepahe'
          ? 'animepahe'
          : uiState.selectedProvider

      const queryKey = ['video-sources', id, episodeNumber, provider, uiState.currentMode] as const

      if (queryClient.getQueryState(queryKey)?.status === 'success') return

      void queryClient.prefetchQuery({
        queryKey,
        queryFn: () =>
          fetchVideoSources(
            id,
            episodeNumber,
            { selectedProvider: provider, currentMode: uiState.currentMode },
            dispatch,
            true
          ),
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
      })
    },
    [showId, currentEpisode, queryClient, uiState, dispatch]
  )

  return {
    state: state as PlayerState,
    dispatch,
    toggleWatchlist,
    moveToCompleted,
    setPreferredSource,
    handleToggleDetails,
    markEpisodeWatched,
    prefetchEpisodeSources,
    isMarkingWatched: markEpisodeWatchedMutation.isPending,
    isUpdatingWatchlistStatus,
  }
}
