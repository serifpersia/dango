import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router'
import ErrorMessage from '../components/common/ErrorMessage'
import MangaReader from '../components/manga/MangaReader'
import { useMangaDetail, type MangaChapter } from '../hooks/useManga'
import { resolveMangaTitle } from '../lib/manga'
import { useTitlePreference } from '../contexts/TitlePreferenceContext'
import {
  mangaLibraryId,
  useAddMangaBookmark,
  useMangaProgress,
  useSaveMangaProgress,
} from '../hooks/useMangaLibrary'
import styles from '../components/manga/Manga.module.css'

const SAVE_DEBOUNCE_MS = 1200

export default function MangaReadPage() {
  const { provider = '', id = '' } = useParams<{ provider: string; id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const chapterId = searchParams.get('chapter') || ''
  const rating = searchParams.get('rating') || 'safe'
  const hasConsent =
    typeof localStorage !== 'undefined' && localStorage.getItem('agreedToViewMature') === 'true'
  const activeRating = hasConsent ? rating : 'safe'

  const libId = provider && id ? mangaLibraryId(provider, id) : ''
  const detailQuery = useMangaDetail(provider || null, id || null, activeRating, hasConsent)
  const detail = detailQuery.data
  const { titlePreference } = useTitlePreference()
  const displayTitle = detail ? resolveMangaTitle(detail, titlePreference) : 'Manga'
  const progressQuery = useMangaProgress(libId || undefined)
  const saveProgress = useSaveMangaProgress()
  const addBookmark = useAddMangaBookmark()

  const activeChapter: MangaChapter | null =
    detail && chapterId ? (detail.chapters.find((c) => c.id === chapterId) ?? null) : null

  const savedPage = useMemo(() => {
    const row = (progressQuery.data?.progress ?? []).find((p) => p.chapterId === chapterId)
    return row && row.page > 0 ? row.page : 0
  }, [progressQuery.data, chapterId])

  const savedPageIndex = savedPage > 1 ? savedPage - 1 : 0

  const ensuredBookmark = useRef('')
  useEffect(() => {
    if (!detail || !libId || ensuredBookmark.current === libId) return
    ensuredBookmark.current = libId
    addBookmark.mutate({
      provider,
      mangaId: id,
      title: detail.title,
      cover: detail.cover,
      author: detail.author,
      altTitle: detail.altTitle,
      contentRating: detail.contentRating,
      silent: true,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, libId])

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef<{
    chapterId: string
    chapterNumber: string
    page: number
    pageCount: number
  } | null>(null)

  const flushSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const pending = pendingSave.current
    pendingSave.current = null
    if (pending && libId) {
      saveProgress.mutate({
        mangaId: libId,
        chapterId: pending.chapterId,
        chapterNumber: pending.chapterNumber,
        page: pending.page,
        pageCount: pending.pageCount,
      })
    }
  }, [libId, saveProgress])

  const handleProgress = useCallback(
    (page: number, pageCount: number) => {
      if (!activeChapter) return
      pendingSave.current = {
        chapterId: activeChapter.id,
        chapterNumber: activeChapter.number,
        page,
        pageCount,
      }
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS)
    },
    [activeChapter, flushSave]
  )

  useEffect(() => {
    flushSave()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId])

  useEffect(() => () => flushSave(), [flushSave])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushSave()
    }
    const onPageHide = () => flushSave()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [flushSave])

  const discordSessionRef = useRef<string>('')
  if (!discordSessionRef.current) {
    discordSessionRef.current = `manga-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  useEffect(() => {
    if (!detail || !activeChapter) return
    const isAdult =
      detail.contentRating === 'erotica' ||
      detail.contentRating === 'pornographic' ||
      detail.type === 'doujinshi'
    const send = () => {
      fetch('/api/discord/manga', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: detail.title,
          chapterLabel: `Chapter ${activeChapter.number}`,
          isPlaying: true,
          thumbnail: detail.cover || '',
          thumbnails: [detail.cover].filter(Boolean),
          isAdult,
          sessionId: discordSessionRef.current,
        }),
      }).catch(() => {})
      fetch('/api/discord/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: discordSessionRef.current }),
      }).catch(() => {})
    }
    send()
    const timer = window.setInterval(send, 60000)
    return () => window.clearInterval(timer)
  }, [detail, activeChapter])

  const openChapter = (ch: MangaChapter) => {
    flushSave()
    if (ch.externalUrl) {
      window.open(ch.externalUrl, '_blank', 'noopener,noreferrer')
      return
    }
    const params = new URLSearchParams()
    params.set('chapter', ch.id)
    if (hasConsent && rating !== 'safe') params.set('rating', rating)
    navigate(`/manga/${provider}/${encodeURIComponent(id)}/read?${params.toString()}`)
  }

  const backToDetail = () => {
    flushSave()
    const params = new URLSearchParams()
    if (hasConsent && rating !== 'safe') params.set('rating', rating)
    const suffix = params.toString() ? `?${params.toString()}` : ''
    navigate(`/manga/${provider}/${encodeURIComponent(id)}${suffix}`)
  }

  return (
    <div className={styles.page}>
      {detailQuery.isLoading ? (
        <div className={styles.readerPages} aria-hidden>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className={`${styles.skeletonThumb} ${styles.shimmer}`}
              style={{ width: '100%', maxWidth: '56rem', aspectRatio: '3 / 4' }}
            />
          ))}
        </div>
      ) : !detail || !activeChapter ? (
        <>
          <button className={styles.backBtn} onClick={backToDetail}>
            Back to title
          </button>
          <ErrorMessage message="Failed to load this chapter. Please try again." />
        </>
      ) : (
        <MangaReader
          key={activeChapter.id}
          provider={provider}
          mangaTitle={displayTitle}
          chapter={activeChapter}
          chapters={detail.chapters}
          onBack={backToDetail}
          onOpenChapter={openChapter}
          initialPage={savedPageIndex}
          onProgress={handleProgress}
          savedPage={savedPage}
        />
      )}
    </div>
  )
}
