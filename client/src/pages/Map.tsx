import React, { useEffect, useState } from 'react'
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps'
import { FaUsers, FaUserClock } from 'react-icons/fa'
import styles from './Map.module.css'
import { TIMEZONE_COORDS } from '../lib/timezoneGrid'

const TELEMETRY_URL = import.meta.env.VITE_TELEMETRY_URL

interface MapData {
  locations: Record<string, number>
  total: number
  active: number
}

interface Spot {
  tz: string
  count: number
  coordinates: [number, number]
  r: number
}

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

const Map: React.FC = () => {
  const [data, setData] = useState<MapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hover, setHover] = useState<Spot | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  useEffect(() => {
    document.title = 'Map - dango'
  }, [])

  useEffect(() => {
    if (!TELEMETRY_URL) {
      setLoading(false)
      setError('No VITE_TELEMETRY_URL configured. Map unavailable.')
      return
    }

    const fetchMap = async () => {
      try {
        const [locRes, statsRes] = await Promise.all([
          fetch(`${TELEMETRY_URL}?type=locations`),
          fetch(TELEMETRY_URL),
        ])
        const locData = await locRes.json()
        const stats = await statsRes.json()
        const raw = (locData && locData.locations) || {}
        const locations: Record<string, number> = {}
        for (const [tz, count] of Object.entries(raw)) {
          if (!tz || tz === 'Unknown') continue
          if (!TIMEZONE_COORDS[tz]) continue
          locations[tz] = count as number
        }
        setData({
          locations,
          total: (stats && stats.total) ?? 0,
          active: (stats && stats.active) ?? 0,
        })
      } catch (e) {
        console.error('Map fetch failed:', e)
        setError('Failed to load map data. Please try again later.')
      } finally {
        setLoading(false)
      }
    }

    fetchMap()
  }, [])

  const spots: Spot[] = []
  if (data) {
    const maxCount = Math.max(1, ...Object.values(data.locations))
    for (const [tz, count] of Object.entries(data.locations)) {
      const pos = TIMEZONE_COORDS[tz]
      if (!pos) continue
      const r = 1.5 + Math.min(3, Math.sqrt(count + 1) * 0.6 - 0.8)
      spots.push({ tz, count, coordinates: pos, r })
    }
  }

  if (loading) return <div className={styles.loading}>Loading global map...</div>
  if (error) return <div className={styles.error}>{error}</div>
  if (!data) return null

  return (
    <div className="page-container">
      <div className={styles.header}>
        <div>
          <h2 className="section-title">Global User Map</h2>
          <p className={styles.subtitle}>
            Purple dots show where installations are located, derived from the timezone each device
            reports. Hover a dot for details.
          </p>
        </div>
      </div>

      <div className={styles.mapCard}>
        <div className={styles.canvasWrap}>
          <ComposableMap
            projection="geoEqualEarth"
            projectionConfig={{
              rotate: [0, 0, 0],
              scale: 105,
            }}
            className={styles.mapSvg}
          >
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map((geo) => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill="#1a1a2e"
                    stroke="#2a2a4a"
                    strokeWidth={0.5}
                    style={{
                      default: { outline: 'none' },
                      hover: { outline: 'none', fill: '#252545' },
                      pressed: { outline: 'none' },
                    }}
                  />
                ))
              }
            </Geographies>
            {spots.map((spot) => (
              <Marker
                key={spot.tz}
                coordinates={spot.coordinates}
                onMouseEnter={(e) => {
                  setHover(spot)
                  setTooltipPos({ x: e.clientX, y: e.clientY })
                }}
                onMouseMove={(e) => {
                  setTooltipPos({ x: e.clientX, y: e.clientY })
                }}
                onMouseLeave={() => setHover(null)}
              >
                <circle r={spot.r + 3} fill="#a855f7" className={styles.glow} />
                <circle r={spot.r} fill="#a855f7" stroke="#a855f7" strokeWidth={0.8} />
              </Marker>
            ))}
          </ComposableMap>

          {hover && (
            <div
              className={styles.tooltip}
              style={{
                left: tooltipPos.x + 14,
                top: tooltipPos.y - 40,
                position: 'fixed',
              }}
            >
              <strong>{hover.tz}</strong>
              <span>
                {hover.count} user{hover.count === 1 ? '' : 's'}
              </span>
            </div>
          )}

          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <FaUsers />
              <div>
                <span className={styles.statValue}>{data.total}</span>
                <span className={styles.statLabel}>Total Users</span>
              </div>
            </div>
            <div className={styles.statCard}>
              <FaUserClock />
              <div>
                <span className={styles.statValue}>{data.active}</span>
                <span className={styles.statLabel}>Active (24h)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Map
