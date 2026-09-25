import React, { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../common/Button'
import Icon from '../common/Icon'
import { useMangaBrowse, mangaCoverSrc, type MangaCard } from '../../hooks/useManga'
import {
  mangaLibraryId,
  useAddMangaBookmark,
  useLinkMangaAnilist,
  useMangaLibraryEntry,
} from '../../hooks/useMangaLibrary'

interface AnilistLinkPanelProps {
  libId: string
  anilistId: number
}

const AnilistLinkPanel: React.FC<AnilistLinkPanelProps> = ({ libId, anilistId }) => {
  const navigate = useNavigate()
  const entryQuery = useMangaLibraryEntry(libId)
  const entry = entryQuery.data?.item
  const [customQuery, setCustomQuery] = useState<string | null>(null)
  const [linkingId, setLinkingId] = useState<string | null>(null)

  const effectiveQuery = customQuery ?? entry?.title ?? ''

  const dexQuery = useMangaBrowse(
    {
      provider: 'mangadex',
      query: effectiveQuery,
      page: 1,
      sort: '',
      status: '',
      type: '',
      rating: 'safe',
      mature: false,
    },
    !!effectiveQuery
  )
  const pillQuery = useMangaBrowse(
    {
      provider: 'mangapill',
      query: effectiveQuery,
      page: 1,
      sort: '',
      status: '',
      type: '',
      rating: 'safe',
      mature: false,
    },
    !!effectiveQuery
  )

  const addBookmark = useAddMangaBookmark()
  const linkAnilist = useLinkMangaAnilist()

  const handleLink = async (card: MangaCard) => {
    const targetId = mangaLibraryId(card.provider, card.id)
    setLinkingId(targetId)
    try {
      await addBookmark.mutateAsync({
        provider: card.provider,
        mangaId: card.id,
        title: card.title,
        cover: card.cover,
        altTitle: card.altTitle,
        contentRating: card.contentRating,
        silent: true,
      })
      await linkAnilist.mutateAsync({ id: targetId, anilistId })
      navigate(`/manga/${card.provider}/${encodeURIComponent(card.id)}`)
    } catch {
      return
    } finally {
      setLinkingId(null)
    }
  }

  const renderResults = (provider: string, cards: MangaCard[] | undefined, isLoading: boolean) => (
    <div style={{ marginTop: '12px' }}>
      <div style={{ fontWeight: 600, textTransform: 'capitalize', marginBottom: '6px' }}>
        {provider}
      </div>
      {isLoading ? (
        <div style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>Searching…</div>
      ) : !cards || cards.length === 0 ? (
        <div style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>No matches.</div>
      ) : (
        cards.slice(0, 6).map((card) => {
          const targetId = mangaLibraryId(card.provider, card.id)
          const busy = linkingId === targetId
          return (
            <div
              key={targetId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '6px 0',
                borderTop: '1px solid var(--border, #223)',
              }}
            >
              {card.cover && (
                <img
                  src={mangaCoverSrc(card.provider, card.cover)}
                  alt=""
                  loading="lazy"
                  style={{ width: '34px', height: '48px', objectFit: 'cover', borderRadius: '4px' }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {card.title}
                </div>
                {card.latestChapter && (
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                    {card.latestChapter}
                  </div>
                )}
              </div>
              <Button onClick={() => handleLink(card)} disabled={busy}>
                <Icon name="external-link-alt" size={12} /> {busy ? 'Linking…' : 'Link'}
              </Button>
            </div>
          )
        })
      )}
    </div>
  )

  return (
    <div>
      <button
        onClick={() => navigate('/manga')}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--accent)',
          cursor: 'pointer',
          marginBottom: '12px',
        }}
      >
        <Icon name="chevron-left" size={12} /> Back to browse
      </button>

      {entryQuery.isLoading ? (
        <div style={{ color: 'var(--text-tertiary)' }}>Loading library entry…</div>
      ) : !entry ? (
        <div style={{ color: 'var(--text-tertiary)' }}>
          This AniList entry is no longer in your library.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {entry.cover && (
              <img
                src={entry.cover}
                alt=""
                style={{ width: '64px', height: '90px', objectFit: 'cover', borderRadius: '6px' }}
              />
            )}
            <div>
              <h2 style={{ margin: '0 0 4px' }}>{entry.title}</h2>
              <div style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                Tracked on AniList
                {entry.lastChapterNumber ? ` · Ch. ${entry.lastChapterNumber}` : ''}
                {entry.status ? ` · ${entry.status}` : ''}
              </div>
            </div>
          </div>

          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: '12px' }}>
            AniList doesn&apos;t host chapters. Search your providers below and link the matching
            manga — your AniList status and chapter progress will sync to it from now on.
          </p>

          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <input
              type="text"
              value={customQuery ?? entry.title}
              onChange={(e) => setCustomQuery(e.target.value)}
              placeholder="Search providers…"
              style={{
                flex: 1,
                padding: '8px 10px',
                borderRadius: '6px',
                border: '1px solid var(--border, #223)',
                background: 'var(--bg-secondary, transparent)',
                color: 'inherit',
              }}
            />
          </div>

          {renderResults('mangadex', dexQuery.data?.items, dexQuery.isLoading)}
          {renderResults('mangapill', pillQuery.data?.items, pillQuery.isLoading)}
        </>
      )}
    </div>
  )
}

export default AnilistLinkPanel
