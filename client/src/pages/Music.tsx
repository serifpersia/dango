import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import toast from 'react-hot-toast'
import Icon from '../components/common/Icon'
import MusicPlayer from '../components/music/MusicPlayer'
import MusicCookieHelp from '../components/music/MusicCookieHelp'
import {
  useMusicAuthStatus,
  useMusicSaveCookie,
  useMusicSignOut,
  useMusicSearch,
  useMusicLibrary,
  useMusicPlaylist,
  useMusicTrack,
  type MusicTrack,
  type MusicPlaylist,
} from '../hooks/useMusic'
import asmrStyles from '../components/asmr/Asmr.module.css'
import radioStyles from '../components/radio/Radio.module.css'
import musicStyles from '../components/music/Music.module.css'

function extractVideoId(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  const fromUrl =
    s.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] ??
    s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)?.[1] ??
    null
  if (fromUrl) return fromUrl
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s
  return null
}

const EXTENSION_ZIP_URL =
  'https://github.com/serifpersia/dango/releases/latest/download/dango-extension.zip'

const Music: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const paramId = extractVideoId(searchParams.get('v') ?? '')

  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [cookieInput, setCookieInput] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [selected, setSelected] = useState<MusicTrack | null>(null)
  const [queue, setQueue] = useState<MusicTrack[]>([])
  const [openPlaylist, setOpenPlaylist] = useState<MusicPlaylist | null>(null)

  const { data: auth } = useMusicAuthStatus()
  const saveCookie = useMusicSaveCookie()
  const signOut = useMusicSignOut()

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isAndroid = /android/i.test(ua)
  const isFirefoxDesktop = /firefox|fxios/i.test(ua) && !isAndroid
  const isChromeDesktop = !isFirefoxDesktop && !isAndroid && /chrome|chromium|edg|brave/i.test(ua)
  const showHelper = isFirefoxDesktop || isChromeDesktop

  const handleExtractYtMusic = () => {
    if (extracting) return
    setExtracting(true)
    const timer = window.setTimeout(() => {
      window.removeEventListener('dango:ytmusic-cookie', onReply)
      setExtracting(false)
      toast.error('Helper not detected — install the Dango Helper extension first.')
    }, 3000)
    const onReply = (e: Event) => {
      window.clearTimeout(timer)
      window.removeEventListener('dango:ytmusic-cookie', onReply)
      setExtracting(false)
      try {
        const detail = JSON.parse((e as CustomEvent<string>).detail) as {
          ok?: boolean
          cookie?: string
          error?: string
          storeId?: string
          count?: number
          names?: string[]
          dropped?: string[]
        }
        if (detail?.ok && detail.cookie) {
          const raw = detail.cookie
            .replace(/^cookie\s*:\s*/i, '')
            .replace(/^["']+|["']+$/g, '')
            .trim()
          if (raw.includes('…') || raw.includes('...')) {
            toast.error(
              `Helper returned a truncated cookie (${raw.length} chars) — reload music.youtube.com and Extract again.`
            )
            return
          }
          setCookieInput(raw)
          toast.success('Cookie extracted from helper — signing in…')
          saveCookie.mutate(raw)
        } else if (detail?.error === 'NO_COOKIE') {
          toast.error('Helper found no YouTube login — log in on a music.youtube.com tab first.')
        } else {
          toast.error('Helper request failed — try again.')
        }
      } catch {
        toast.error('Helper request failed — try again.')
      }
    }
    window.addEventListener('dango:ytmusic-cookie', onReply)
    window.dispatchEvent(new CustomEvent('dango:get-ytmusic-cookie'))
  }
  const { data: searchData, isLoading: searchLoading } = useMusicSearch(query)
  const { data: libraryData, isLoading: libraryLoading } = useMusicLibrary(
    auth?.authenticated === true
  )
  const { data: playlistData, isLoading: playlistLoading } = useMusicPlaylist(
    openPlaylist?.id ?? null
  )

  const tracks = useMemo(() => searchData?.tracks || [], [searchData])
  const libPlaylists = useMemo(() => libraryData?.playlists || [], [libraryData])
  const libraryTracks = useMemo(() => libraryData?.tracks || [], [libraryData])
  const openPlaylistTracks = useMemo(() => playlistData?.tracks || [], [playlistData])
  const knownTracks = useMemo(
    () => [...tracks, ...openPlaylistTracks, ...libraryTracks],
    [tracks, openPlaylistTracks, libraryTracks]
  )

  const unresolvedId =
    paramId && selected?.id !== paramId && !knownTracks.some((t) => t.id === paramId)
      ? paramId
      : null
  const { data: trackData } = useMusicTrack(unresolvedId)

  const selectedId = selected?.id
  useEffect(() => {
    document.title = selected ? `${selected.title} - dango` : 'Music - dango'
  }, [selected])
  useEffect(() => {
    if (!paramId) {
      if (selectedId) setSelected(null)
      return
    }
    if (selectedId === paramId) return
    const pick = (list: MusicTrack[]) => {
      const found = list.find((t) => t.id === paramId)
      if (found) {
        setSelected(found)
        setQueue(list.length > 0 ? list : [found])
        return true
      }
      return false
    }
    if (pick(tracks) || pick(openPlaylistTracks) || pick(libraryTracks)) return
    const fetched = trackData?.track
    if (fetched && fetched.id === paramId) {
      setSelected(fetched)
      setQueue([fetched])
    }
  }, [paramId, selectedId, tracks, openPlaylistTracks, libraryTracks, trackData])

  const playTrack = (track: MusicTrack, from: MusicTrack[]) => {
    setSelected(track)
    setQueue(from.length > 0 ? from : [track])
    setSearchParams({ v: track.id })
  }

  const stepTrack = (delta: number) => {
    if (!selected || queue.length === 0) return
    const idx = queue.findIndex((t) => t.id === selected.id)
    const next = queue[(idx < 0 ? 0 : idx + delta + queue.length) % queue.length]
    setSelected(next)
    setSearchParams({ v: next.id })
  }

  const renderPlaylist = (p: MusicPlaylist) => (
    <button
      key={p.id}
      className={radioStyles.stationRow}
      onClick={() => setOpenPlaylist(p)}
      aria-label={`Open ${p.title}`}
    >
      {p.thumbnails?.[0]?.url ? (
        <img
          src={p.thumbnails[0].url}
          alt=""
          className={radioStyles.stationThumb}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className={radioStyles.stationThumbPlaceholder}>
          <Icon name="headphones" />
        </span>
      )}
      <span className={radioStyles.stationMeta}>
        <span className={radioStyles.stationName}>{p.title}</span>
        {p.subtitle && <span className={radioStyles.stationSub}>{p.subtitle}</span>}
      </span>
    </button>
  )

  const renderTrack = (t: MusicTrack, from: MusicTrack[]) => {
    const isActive = selected?.id === t.id
    const sub = [t.album, t.duration].filter(Boolean).join(' · ')
    return (
      <div
        key={t.id}
        className={`${radioStyles.stationRow} ${isActive ? radioStyles.stationRowActive : ''}`}
        style={{ cursor: 'default' }}
      >
        <button
          onClick={() => playTrack(t, from)}
          className={radioStyles.stationRow}
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 0, padding: 0 }}
          aria-label={`Play ${t.title}`}
        >
          {t.thumbnails?.[0]?.url ? (
            <img
              src={t.thumbnails[0].url}
              alt=""
              className={radioStyles.stationThumb}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className={radioStyles.stationThumbPlaceholder}>
              <Icon name="headphones" />
            </span>
          )}
          <span className={radioStyles.stationMeta}>
            <span className={radioStyles.stationName}>{t.title}</span>
            <span className={radioStyles.stationSub}>
              {t.artists}
              {sub ? ` · ${sub}` : ''}
            </span>
          </span>
        </button>
        <a
          href={`https://music.youtube.com/watch?v=${encodeURIComponent(t.id)}`}
          target="_blank"
          rel="noreferrer"
          title="Open in YouTube Music"
          aria-label={`Open ${t.title} in YouTube Music`}
          style={{ padding: 8, color: 'inherit', opacity: 0.7, flexShrink: 0 }}
        >
          <Icon name="external-link-alt" />
        </a>
      </div>
    )
  }

  return (
    <div className={`${asmrStyles.page} ${selected ? asmrStyles.pageWithPlayer : ''}`}>
      <div className={asmrStyles.header}>
        <h1 className={asmrStyles.pageTitle}>
          <Icon name="headphones" /> Music
        </h1>
        <form
          className={asmrStyles.searchForm}
          onSubmit={(e) => {
            e.preventDefault()
            const direct = extractVideoId(queryInput)
            if (direct) {
              setQuery('')
              setSearchParams({ v: direct })
            } else {
              setQuery(queryInput)
            }
          }}
        >
          <input
            className={asmrStyles.searchInput}
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Search YouTube Music…"
            aria-label="Search music"
          />
          <button className={asmrStyles.searchBtn} type="submit" aria-label="Search">
            <Icon name="search" />
          </button>
        </form>
      </div>

      <div className={musicStyles.authRow}>
        {auth?.authenticated ? (
          <>
            <span className={asmrStyles.statusMsg}>
              Signed in to YouTube Music
              {libraryData &&
                ` — ${libraryData.tracks.length} songs, ${libraryData.playlists.length} playlists`}
            </span>
            <button
              className={musicStyles.btnGhost}
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const raw = cookieInput
                  .replace(/^cookie\s*:\s*/i, '')
                  .replace(/^["']+|["']+$/g, '')
                  .trim()
                if (!raw) return
                if (raw.includes('…') || raw.includes('...')) {
                  toast.error(
                    'That cookie is truncated (contains …). Right-click the Cookie header → Copy value, not the wrapped preview.'
                  )
                  return
                }
                if (raw !== cookieInput) setCookieInput(raw)
                saveCookie.mutate(raw)
              }}
              className={musicStyles.cookieForm}
            >
              <input
                className={musicStyles.cookieInput}
                value={cookieInput}
                onChange={(e) => setCookieInput(e.target.value)}
                placeholder="Paste music.youtube.com Cookie header…"
                aria-label="YouTube Music cookie"
                type="password"
              />
              <button
                className={musicStyles.btn}
                type="submit"
                disabled={saveCookie.isPending || !cookieInput.trim()}
              >
                {saveCookie.isPending ? 'Checking…' : 'Sign in'}
              </button>
              {showHelper && (
                <button
                  className={musicStyles.btnGhost}
                  type="button"
                  onClick={handleExtractYtMusic}
                  disabled={extracting || saveCookie.isPending}
                  title="Read the YouTube Music cookie via the Dango Helper extension (same zip as AnimePahe/JapaneseASMR)"
                >
                  {extracting ? 'Extracting…' : 'Extract from helper'}
                </button>
              )}
            </form>
            {showHelper && (
              <p className={asmrStyles.statusMsg}>
                Two ways to sign in: paste the Cookie header manually (steps below), or download{' '}
                <a
                  href={EXTENSION_ZIP_URL}
                  target="_blank"
                  rel="noreferrer"
                  className={musicStyles.link}
                >
                  dango-extension.zip
                </a>{' '}
                then{' '}
                {isFirefoxDesktop ? (
                  <>
                    <code>about:debugging</code> → <strong>This Firefox</strong> →{' '}
                    <strong>Load Temporary Add-on</strong> →{' '}
                    <code>dango-extension/firefox/manifest.json</code>
                  </>
                ) : (
                  <>
                    <code>chrome://extensions</code> → <strong>Developer mode</strong> →{' '}
                    <strong>Load unpacked</strong> → <code>dango-extension/chrome</code>
                  </>
                )}
                , log in on a music.youtube.com tab, and click Extract.
              </p>
            )}
            <MusicCookieHelp />
          </>
        )}
        {saveCookie.isSuccess && (
          <p className={asmrStyles.statusMsg}>
            Signed in — found {saveCookie.data.tracks} songs and {saveCookie.data.playlists}{' '}
            playlists.
          </p>
        )}
        {saveCookie.isError && (
          <p className={asmrStyles.statusMsg}>
            {(saveCookie.error as Error | null)?.message ||
              'Sign-in failed. Paste a fresh Cookie header from music.youtube.com.'}
          </p>
        )}
        {!auth?.authenticated && !saveCookie.isError && !saveCookie.isSuccess && (
          <p className={asmrStyles.statusMsg}>
            Sign in with your YouTube Music cookie to see your library. Search and playback work
            without sign-in.
          </p>
        )}
      </div>

      {query ? (
        <>
          <h2 className={radioStyles.sectionTitle}>Results for “{query}”</h2>
          {searchLoading ? (
            <p className={asmrStyles.statusMsg}>Searching…</p>
          ) : tracks.length === 0 ? (
            <p className={asmrStyles.statusMsg}>No tracks found.</p>
          ) : (
            <div className={radioStyles.stationList}>
              {tracks.map((t) => renderTrack(t, tracks))}
            </div>
          )}
        </>
      ) : auth?.authenticated ? (
        <>
          <h2 className={radioStyles.sectionTitle}>Your library</h2>
          {libraryLoading ? (
            <p className={asmrStyles.statusMsg}>Loading library…</p>
          ) : (
            <>
              {libPlaylists.length > 0 && !openPlaylist && (
                <>
                  <h3 className={radioStyles.sectionTitle}>Playlists</h3>
                  <div className={radioStyles.stationList}>
                    {libPlaylists.map((p) => renderPlaylist(p))}
                  </div>
                </>
              )}
              {openPlaylist ? (
                <>
                  <button
                    className={musicStyles.btnGhost}
                    onClick={() => setOpenPlaylist(null)}
                    style={{ marginBottom: 8 }}
                  >
                    ← Back to library
                  </button>
                  <h3 className={radioStyles.sectionTitle}>{openPlaylist.title}</h3>
                  {playlistLoading ? (
                    <p className={asmrStyles.statusMsg}>Loading playlist…</p>
                  ) : openPlaylistTracks.length === 0 ? (
                    <p className={asmrStyles.statusMsg}>No tracks in this playlist.</p>
                  ) : (
                    <div className={radioStyles.stationList}>
                      {openPlaylistTracks.map((t) => renderTrack(t, openPlaylistTracks))}
                    </div>
                  )}
                </>
              ) : null}
            </>
          )}
        </>
      ) : (
        <p className={asmrStyles.statusMsg}>Search above, or sign in to see your library.</p>
      )}

      {selected && (
        <MusicPlayer
          track={selected}
          queue={queue}
          onTrackStep={stepTrack}
          onClose={() => {
            setSelected(null)
            setSearchParams({})
          }}
        />
      )}
    </div>
  )
}

export default Music
