import React, { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router'
import Icon from '../components/common/Icon'
import { Button } from '../components/common/Button'
import ErrorMessage from '../components/common/ErrorMessage'
import MangaDetail from '../components/manga/MangaDetail'
import { useMangaDetail, type MangaChapter } from '../hooks/useManga'
import { resolveMangaTitle } from '../lib/manga'
import { useTitlePreference } from '../contexts/TitlePreferenceContext'
import {
  mangaLibraryId,
  useAddMangaBookmark,
  useMangaLibraryCheck,
  useMangaProgress,
  useRemoveMangaBookmark,
  useUpdateMangaStatus,
  MANGA_LIBRARY_STATUSES,
  type MangaProgressItem,
} from '../hooks/useMangaLibrary'
import styles from '../components/manga/Manga.module.css'

export default function MangaInfoPage() {
  const { provider = '', id = '' } = useParams<{ provider: string; id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [hasConsent, setHasConsent] = useState(
    () => localStorage.getItem('agreedToViewMature') === 'true'
  )

  useEffect(() => {
    const sync = () => setHasConsent(localStorage.getItem('agreedToViewMature') === 'true')
    window.addEventListener('focus', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('focus', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const rating = searchParams.get('rating') || 'safe'
  const activeRating = hasConsent ? rating : 'safe'
  const libId = provider && id ? mangaLibraryId(provider, id) : undefined

  const detailQuery = useMangaDetail(provider || null, id || null, activeRating, hasConsent)
  const detail = detailQuery.data
  const checkQuery = useMangaLibraryCheck(libId)
  const progressQuery = useMangaProgress(libId)
  const { titlePreference } = useTitlePreference()

  const displayDetail = useMemo(
    () => (detail ? { ...detail, title: resolveMangaTitle(detail, titlePreference) } : detail),
    [detail, titlePreference]
  )

  const addBookmark = useAddMangaBookmark()
  const removeBookmark = useRemoveMangaBookmark()
  const updateStatus = useUpdateMangaStatus()

  useEffect(() => {
    if (displayDetail) document.title = `${displayDetail.title} - dango`
  }, [displayDetail])

  const progressByChapter = useMemo(() => {
    const map = new Map<string, MangaProgressItem>()
    for (const p of progressQuery.data?.progress ?? []) map.set(p.chapterId, p)
    return map
  }, [progressQuery.data])

  const inLibrary = checkQuery.data?.inLibrary ?? false
  const currentStatus = checkQuery.data?.status ?? 'Reading'

  const readableChapters = useMemo(
    () => (detail?.chapters ?? []).filter((c) => !c.externalUrl),
    [detail]
  )

  const resumeChapter: MangaChapter | null = useMemo(() => {
    if (!detail) return null
    const rows = [...(progressQuery.data?.progress ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)
    for (const row of rows) {
      const found = detail.chapters.find((c) => c.id === row.chapterId)
      if (found && !found.externalUrl) return found
    }
    return readableChapters[0] ?? null
  }, [detail, progressQuery.data, readableChapters])

  const resumeProgress = resumeChapter ? progressByChapter.get(resumeChapter.id) : undefined
  const resumeLabel = resumeProgress ? `Continue Ch. ${resumeChapter?.number}` : 'Start Reading'

  const openChapter = (ch: MangaChapter) => {
    if (ch.externalUrl) {
      window.open(ch.externalUrl, '_blank', 'noopener,noreferrer')
      return
    }
    const params = new URLSearchParams()
    params.set('chapter', ch.id)
    if (hasConsent && rating !== 'safe') params.set('rating', rating)
    navigate(`/manga/${provider}/${encodeURIComponent(id)}/read?${params.toString()}`)
  }

  const handleToggleBookmark = () => {
    if (!detail || !libId) return
    if (inLibrary) {
      removeBookmark.mutate(libId)
    } else {
      addBookmark.mutate({
        provider,
        mangaId: id,
        title: detail.title,
        cover: detail.cover,
        author: detail.author,
        altTitle: detail.altTitle,
        contentRating: detail.contentRating,
      })
    }
  }

  return (
    <div className={styles.page}>
      {detailQuery.isLoading ? (
        <div aria-hidden>
          <div
            className={`${styles.skeletonThumb} ${styles.shimmer}`}
            style={{ maxWidth: '12rem' }}
          />
          <div className={`${styles.skeletonLine} ${styles.shimmer}`} style={{ width: '40%' }} />
          <div className={`${styles.skeletonLine} ${styles.shimmer}`} style={{ width: '70%' }} />
        </div>
      ) : detailQuery.isError || !detail || !displayDetail ? (
        <>
          <button className={styles.backBtn} onClick={() => navigate('/manga')}>
            <Icon name="chevron-left" size={12} /> Back to browse
          </button>
          <ErrorMessage message="Failed to load this title. Please try again." />
        </>
      ) : (
        <MangaDetail
          detail={displayDetail}
          altTitle={detail.altTitle !== displayDetail.title ? detail.altTitle : undefined}
          onBack={() => navigate('/manga')}
          onOpenChapter={openChapter}
          progressByChapter={progressByChapter}
          primaryAction={
            resumeChapter ? (
              <Button onClick={() => resumeChapter && openChapter(resumeChapter)}>
                <Icon name="book" size={13} /> {resumeLabel}
              </Button>
            ) : undefined
          }
          bookmarkButton={
            <Button
              variant={inLibrary ? 'secondary' : 'primary'}
              onClick={handleToggleBookmark}
              disabled={addBookmark.isPending || removeBookmark.isPending}
            >
              <Icon name="bookmark" size={13} /> {inLibrary ? 'Bookmarked' : 'Bookmark'}
            </Button>
          }
          statusSelect={
            inLibrary ? (
              <select
                className={styles.detailSelect}
                value={currentStatus}
                onChange={(e) =>
                  libId && updateStatus.mutate({ id: libId, status: e.target.value })
                }
                aria-label="Reading status"
              >
                {MANGA_LIBRARY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : undefined
          }
        />
      )}
    </div>
  )
}
