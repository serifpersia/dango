import React, { useMemo, useState } from 'react'
import { FaBroadcastTower, FaSearch } from 'react-icons/fa'
import RadioPlayer from '../components/radio/RadioPlayer'
import {
  useRadioStations,
  useRadioSearch,
  useListenMoe,
  songArtist,
  type RadioStation,
} from '../hooks/useRadio'
import asmrStyles from '../components/asmr/Asmr.module.css'
import styles from '../components/radio/Radio.module.css'

const Radio: React.FC = () => {
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<RadioStation | null>(null)
  const [playerExpanded, setPlayerExpanded] = useState(true)

  const { data: featuredData, isLoading: featuredLoading } = useRadioStations()
  const { data: searchData, isLoading: searchLoading } = useRadioSearch(query)

  const featured = useMemo(() => featuredData?.stations || [], [featuredData])
  const results = useMemo(() => searchData?.stations || [], [searchData])
  const queue = query ? results : featured

  const { nowPlaying, connected } = useListenMoe(selected?.gateway)

  const playStation = (station: RadioStation) => {
    setSelected(station)
    setPlayerExpanded(true)
  }

  const stepStation = (delta: number) => {
    const list = queue.length > 0 ? queue : featured
    if (list.length === 0 || !selected) return
    const idx = list.findIndex((s) => s.id === selected.id)
    const next = list[(idx < 0 ? 0 : idx + delta + list.length) % list.length]
    setSelected(next)
  }

  const renderRow = (station: RadioStation) => {
    const isActive = selected?.id === station.id
    const liveSong =
      isActive && nowPlaying.song
        ? `${songArtist(nowPlaying.song)} — ${nowPlaying.song.title}`
        : null
    const sub = [station.codec, station.bitrate ? `${station.bitrate}k` : '', station.tags]
      .filter(Boolean)
      .join(' · ')
    return (
      <button
        key={station.id}
        className={`${styles.stationRow} ${isActive ? styles.stationRowActive : ''}`}
        onClick={() => playStation(station)}
      >
        {station.favicon ? (
          <img
            src={station.favicon}
            alt=""
            className={styles.stationThumb}
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : (
          <span className={styles.stationThumbPlaceholder}>
            <FaBroadcastTower />
          </span>
        )}
        <span className={styles.stationMeta}>
          <span className={styles.stationName}>{station.name}</span>
          {sub && <span className={styles.stationSub}>{sub}</span>}
        </span>
        {liveSong && <span className={styles.stationNowPlaying}>{liveSong}</span>}
      </button>
    )
  }

  return (
    <div className={`${asmrStyles.page} ${selected ? asmrStyles.pageWithPlayer : ''}`}>
      <div className={asmrStyles.header}>
        <h1 className={asmrStyles.pageTitle}>
          <FaBroadcastTower /> Radio
        </h1>
        <form
          className={asmrStyles.searchForm}
          onSubmit={(e) => {
            e.preventDefault()
            setQuery(queryInput)
          }}
        >
          <input
            className={asmrStyles.searchInput}
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Search stations (anime, j-pop, k-pop…)"
            aria-label="Search radio stations"
          />
          <button className={asmrStyles.searchBtn} type="submit" aria-label="Search">
            <FaSearch />
          </button>
        </form>
      </div>

      {query ? (
        <>
          <h2 className={styles.sectionTitle}>Results for “{query}”</h2>
          {searchLoading ? (
            <p className={asmrStyles.statusMsg}>Searching…</p>
          ) : results.length === 0 ? (
            <p className={asmrStyles.statusMsg}>No stations found.</p>
          ) : (
            <div className={styles.stationList}>{results.map(renderRow)}</div>
          )}
        </>
      ) : (
        <>
          <h2 className={styles.sectionTitle}>Featured</h2>
          {featuredLoading ? (
            <p className={asmrStyles.statusMsg}>Loading…</p>
          ) : (
            <div className={styles.stationList}>{featured.map(renderRow)}</div>
          )}
        </>
      )}

      {selected && (
        <RadioPlayer
          station={selected}
          nowPlaying={nowPlaying}
          connected={connected}
          expanded={playerExpanded}
          onStationStep={stepStation}
          onExpandedChange={setPlayerExpanded}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

export default Radio
