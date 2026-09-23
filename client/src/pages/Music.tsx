import React, { useEffect, useMemo, useRef, useState } from 'react'
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
  useMusicUpNext,
  useMusicLikedIds,
  useMusicRate,
  type MusicTrack,
  type MusicPlaylist,
} from '../hooks/useMusic'
import { fetchApi } from '../lib/fetchApi'
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
  const [shuffle, setShuffle] = useState(() => localStorage.getItem('musicShuffle') === 'true')
  const [radio, setRadio] = useState(() => localStorage.getItem('musicRadio') !== 'false')
  const [selected, setSelected] = useState<MusicTrack | null>(null)
  const [queue, setQueue] = useState<MusicTrack[]>([])
  const [openPlaylist, setOpenPlaylist] = useState<MusicPlaylist | null>(null)
  const [likeOverrides, setLikeOverrides] = useState<Record<string, boolean>>({})

  const queueRef = useRef<MusicTrack[]>([])
  queueRef.current = queue
  const selectedRef = useRef<MusicTrack | null>(null)
  selectedRef.current = selected
  const extendingRef = useRef(false)
  const failedRef = useRef<Set<string>>(new Set())

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
  const { data: upnextData, isLoading: upnextLoading } = useMusicUpNext(selected?.id ?? null)
  const { data: likesData } = useMusicLikedIds(auth?.authenticated === true)
  const rate = useMusicRate()

  const tracks = useMemo(() => searchData?.tracks || [], [searchData])
  const libPlaylists = useMemo(() => libraryData?.playlists || [], [libraryData])
  const libraryTracks = useMemo(() => libraryData?.tracks || [], [libraryData])
  const openPlaylistTracks = useMemo(() => playlistData?.tracks || [], [playlistData])
  const upnextTracks = useMemo(() => {
    const all = upnextData?.tracks || []
    return selected ? all.filter((t) => t.id !== selected.id) : all
  }, [upnextData, selected])
  const likedSet = useMemo(() => new Set(likesData?.likedIds || []), [likesData])
  const isLiked = (t: MusicTrack): boolean =>
    likeOverrides[t.id] ?? (likedSet.has(t.id) || t.liked === true)

  useEffect(() => {
    if (auth?.authenticated !== true) setLikeOverrides({})
  }, [auth?.authenticated])
  const knownTracks = useMemo(
    () => [...tracks, ...openPlaylistTracks, ...libraryTracks, ...upnextTracks],
    [tracks, openPlaylistTracks, libraryTracks, upnextTracks]
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
        // Preserve the existing queue (radio/search context) when it already
        // contains the track — otherwise resolving the URL would clobber it.
        setQueue((q) => (q.some((t) => t.id === paramId) ? q : list.length > 0 ? list : [found]))
        return true
      }
      return false
    }
    if (pick(tracks) || pick(openPlaylistTracks) || pick(libraryTracks)) return
    const upHit = upnextTracks.find((t) => t.id === paramId)
    if (upHit) {
      setSelected(upHit)
      setQueue((q) => (q.some((t) => t.id === upHit.id) ? q : [upHit]))
      return
    }
    const fetched = trackData?.track
    if (fetched && fetched.id === paramId) {
      setSelected(fetched)
      setQueue((q) => (q.some((t) => t.id === fetched.id) ? q : [fetched]))
    }
  }, [paramId, selectedId, tracks, openPlaylistTracks, libraryTracks, upnextTracks, trackData])

  const playTrack = (track: MusicTrack, from: MusicTrack[]) => {
    failedRef.current.delete(track.id)
    setSelected(track)
    setQueue(from.length > 0 ? from : [track])
    setSearchParams({ v: track.id })
  }

  const handleTrackFailed = (track: MusicTrack) => {
    failedRef.current.add(track.id)
    toast.error(`Couldn't play “${track.title}” — skipped.`)
  }

  const extendRadio = async () => {
    if (extendingRef.current) return
    const currentQueue = queueRef.current
    const anchor = currentQueue[currentQueue.length - 1] ?? selectedRef.current
    if (!anchor) return
    extendingRef.current = true
    try {
      const data = await fetchApi<{ tracks: MusicTrack[] }>(
        `/api/music/upnext?id=${encodeURIComponent(anchor.id)}`
      )
      const known = new Set(currentQueue.map((t) => t.id))
      const fresh = (data.tracks || []).filter(
        (t) => !known.has(t.id) && !failedRef.current.has(t.id)
      )
      if (fresh.length === 0) {
        const first = queueRef.current[0]
        if (first) {
          setSelected(first)
          setSearchParams({ v: first.id })
        }
        return
      }
      setQueue([...queueRef.current, ...fresh])
      setSelected(fresh[0])
      setSearchParams({ v: fresh[0].id })
    } catch {
      const first = queueRef.current[0]
      if (first) {
        setSelected(first)
        setSearchParams({ v: first.id })
      }
    } finally {
      extendingRef.current = false
    }
  }

  const stepTrack = (delta: number) => {
    const currentQueue = queueRef.current
    const current = selectedRef.current
    if (!current || currentQueue.length === 0) return
    const idx = currentQueue.findIndex((t) => t.id === current.id)
    if (delta > 0 && radio && (idx < 0 || idx === currentQueue.length - 1)) {
      void extendRadio()
      return
    }
    // Skip tracks that failed to load (bounded so an all-failed queue stops).
    const isBad = (t: MusicTrack) => failedRef.current.has(t.id)
    const len = currentQueue.length
    let next: MusicTrack
    if (shuffle && len > 1) {
      let j = Math.floor(Math.random() * len)
      for (let tries = 0; tries < len && (j === idx || isBad(currentQueue[j])); tries++) {
        j = Math.floor(Math.random() * len)
      }
      next = currentQueue[j]
    } else {
      const dir = delta > 0 ? 1 : -1
      const start = idx < 0 ? (dir > 0 ? -1 : 0) : idx
      let nextIdx = (((start + dir) % len) + len) % len
      for (let tries = 1; tries < len && isBad(currentQueue[nextIdx]); tries++) {
        nextIdx = (((nextIdx + dir) % len) + len) % len
      }
      next = currentQueue[nextIdx]
    }
    setSelected(next)
    setSearchParams({ v: next.id })
  }

  const toggleRadio = () => {
    if (radio) {
      setRadio(false)
      localStorage.setItem('musicRadio', 'false')
      return
    }
    const current = selectedRef.current
    if (!current) return
    if (upnextTracks.length === 0) {
      toast.error('No radio suggestions for this song yet.')
      return
    }
    const seen = new Set<string>()
    const seeded: MusicTrack[] = []
    for (const t of [current, ...upnextTracks]) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      seeded.push(t)
    }
    setRadio(true)
    localStorage.setItem('musicRadio', 'true')
    setQueue(seeded)
    toast.success(`Radio started — ${upnextTracks.length} songs queued.`)
  }

  const toggleLike = (track: MusicTrack) => {
    if (auth?.authenticated !== true) {
      toast.error('Sign in to like songs.')
      return
    }
    const like = !isLiked(track)
    setLikeOverrides((prev) => ({ ...prev, [track.id]: like }))
    rate.mutate(
      { id: track.id, like },
      {
        onError: () => {
          setLikeOverrides((prev) => {
            const next = { ...prev }
            delete next[track.id]
            return next
          })
          toast.error('Like action failed — try again.')
        },
      }
    )
  }

  const toggleShuffle = () => {
    setShuffle((v) => {
      localStorage.setItem('musicShuffle', String(!v))
      return !v
    })
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

  const renderTrack = (t: MusicTrack, from: MusicTrack[], onPlay?: (t: MusicTrack) => void) => {
    const isActive = selected?.id === t.id
    const liked = isLiked(t)
    const sub = [t.album, t.duration].filter(Boolean).join(' · ')
    return (
      <div
        key={t.id}
        className={`${radioStyles.stationRow} ${isActive ? radioStyles.stationRowActive : ''}`}
        style={{ cursor: 'default' }}
      >
        <button
          onClick={() => (onPlay ? onPlay(t) : playTrack(t, from))}
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
        {auth?.authenticated === true && (
          <button
            className={`${musicStyles.likeBtn} ${liked ? musicStyles.likeActive : ''}`}
            onClick={() => toggleLike(t)}
            disabled={rate.isPending}
            title={liked ? 'Remove from Liked Music' : 'Add to Liked Music'}
            aria-label={
              liked ? `Remove ${t.title} from Liked Music` : `Add ${t.title} to Liked Music`
            }
            aria-pressed={liked}
          >
            <Icon name="heart" />
          </button>
        )}
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

  const suggestionContext = useMemo(() => {
    if (!selected) return upnextTracks
    const seen = new Set<string>()
    const out: MusicTrack[] = []
    for (const t of [selected, ...upnextTracks]) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      out.push(t)
    }
    return out
  }, [selected, upnextTracks])

  const playSuggestion = (track: MusicTrack) => {
    playTrack(track, suggestionContext)
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

      <div className={selected ? musicStyles.contentLayout : undefined}>
        <div className={musicStyles.mainCol}>
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
                  {libraryTracks.length > 0 && !openPlaylist && (
                    <>
                      <h3 className={radioStyles.sectionTitle}>
                        Liked songs ({libraryTracks.length})
                      </h3>
                      <div style={{ marginBottom: 8 }}>
                        <button
                          className={musicStyles.btnGhost}
                          onClick={() => playTrack(libraryTracks[0], libraryTracks)}
                          aria-label="Play all liked songs"
                        >
                          <Icon name="play" /> Play all
                        </button>
                      </div>
                      <div className={radioStyles.stationList}>
                        {libraryTracks.map((t) => renderTrack(t, libraryTracks))}
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
        </div>

        {selected && (
          <aside className={musicStyles.upnextAside} aria-label="Up next">
            <div className={musicStyles.upnextHeader}>
              <span className={musicStyles.upnextTitle}>
                <Icon name="list-ul" /> Up Next
              </span>
            </div>
            <div className={musicStyles.nowPlayingWrap}>
              <p className={musicStyles.nowPlayingLabel}>Now playing</p>
              {renderTrack(selected, queue.length > 0 ? queue : [selected])}
            </div>
            <div className={musicStyles.upnextActions}>
              <button
                className={musicStyles.btnGhost}
                onClick={toggleRadio}
                disabled={!radio && (upnextLoading || upnextTracks.length === 0)}
                aria-pressed={radio}
                title={
                  radio
                    ? 'Stop the radio — the queue will loop instead of fetching more songs'
                    : 'Queue these suggestions after the current song and keep the mix going'
                }
              >
                {radio ? 'Stop radio' : 'Start radio'}
              </button>
            </div>
            {upnextLoading ? (
              <p className={asmrStyles.statusMsg}>Loading suggestions…</p>
            ) : upnextTracks.length === 0 ? (
              <p className={asmrStyles.statusMsg}>No suggestions for this song.</p>
            ) : (
              <div className={radioStyles.stationList}>
                {upnextTracks.map((t) => renderTrack(t, suggestionContext, playSuggestion))}
              </div>
            )}
          </aside>
        )}
      </div>

      {selected && (
        <MusicPlayer
          track={selected}
          queue={queue}
          shuffle={shuffle}
          onToggleShuffle={toggleShuffle}
          onTrackStep={stepTrack}
          onTrackFailed={handleTrackFailed}
          onClose={() => {
            setSelected(null)
            setSearchParams({})
          }}
          liked={selected ? isLiked(selected) : false}
          likeVisible={auth?.authenticated === true}
          likePending={rate.isPending}
          onToggleLike={() => toggleLike(selected)}
        />
      )}
    </div>
  )
}

export default Music
