import React, { useEffect, useRef, useState } from 'react'
import { FaUsers, FaUserClock } from 'react-icons/fa'
import styles from './Map.module.css'
import { WORLD_GRID, WORLD_GRID_W, WORLD_GRID_H } from '../lib/worldGrid'
import { getTimezoneGridCoords } from '../lib/timezoneGrid'
import { useLowEndMode } from '../contexts/LowEndModeContext'

const TELEMETRY_URL = import.meta.env.VITE_TELEMETRY_URL

interface MapData {
  locations: Record<string, number>
  total: number
  active: number
}

const CELL = 10
const RADIUS = 2.6

const Map: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [data, setData] = useState<MapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hover, setHover] = useState<{ tz: string; count: number; x: number; y: number } | null>(
    null
  )
  const { lowEndMode } = useLowEndMode()

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
          if (!getTimezoneGridCoords(tz)) continue
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    const w = WORLD_GRID_W * CELL
    const h = WORLD_GRID_H * CELL
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    // static background layer (grid + land + base halos), drawn once
    const bg = document.createElement('canvas')
    bg.width = w
    bg.height = h
    const bctx = bg.getContext('2d')
    if (!bctx) return
    bctx.fillStyle = '#0a0a0c'
    bctx.fillRect(0, 0, w, h)

    // faint grid
    bctx.strokeStyle = 'rgba(255,255,255,0.015)'
    bctx.lineWidth = 1
    for (let x = 0; x <= WORLD_GRID_W; x++) {
      bctx.beginPath()
      bctx.moveTo(x * CELL, 0)
      bctx.lineTo(x * CELL, h)
      bctx.stroke()
    }
    for (let y = 0; y <= WORLD_GRID_H; y++) {
      bctx.beginPath()
      bctx.moveTo(0, y * CELL)
      bctx.lineTo(w, y * CELL)
      bctx.stroke()
    }

    // land dots
    for (let y = 0; y < WORLD_GRID_H; y++) {
      const row = WORLD_GRID[y]
      for (let x = 0; x < WORLD_GRID_W; x++) {
        if (row[x] === '1') {
          bctx.beginPath()
          bctx.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, RADIUS, 0, Math.PI * 2)
          bctx.fillStyle = 'rgba(139, 92, 246, 0.16)'
          bctx.fill()
        }
      }
    }

    // user dots grouped by timezone
    const spots: { tz: string; count: number; x: number; y: number; r: number }[] = []
    if (data) {
      const counts = Object.values(data.locations)
      const cntMax = Math.max(1, ...counts)
      for (const [tz, count] of Object.entries(data.locations)) {
        const pos = getTimezoneGridCoords(tz)
        if (!pos) continue
        const [gx, gy] = pos
        const r = RADIUS + Math.min(5, Math.sqrt(count + 1) * 1.4 - 1)
        const x = gx * CELL + CELL / 2
        const y = gy * CELL + CELL / 2
        spots.push({ tz, count, x, y, r })

        bctx.beginPath()
        bctx.arc(x, y, r * 1.7, 0, Math.PI * 2)
        bctx.fillStyle = 'rgba(139, 92, 246, 0.18)'
        bctx.fill()
      }
    }

    const drawSpot = (s: { x: number; y: number; r: number }, pulse: number) => {
      const haloR = s.r * (1.6 + pulse * 1.3)
      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, haloR)
      grad.addColorStop(0, `rgba(168, 85, 247, ${0.4 * (1 - pulse * 0.4)})`)
      grad.addColorStop(1, 'rgba(168, 85, 247, 0)')
      ctx.beginPath()
      ctx.arc(s.x, s.y, haloR, 0, Math.PI * 2)
      ctx.fillStyle = grad
      ctx.fill()

      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx.fillStyle = '#a855f7'
      ctx.shadowColor = '#a855f7'
      ctx.shadowBlur = s.r * 2 + 4
      ctx.fill()
      ctx.shadowBlur = 0
    }

    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (lowEndMode || reducedMotion || spots.length === 0) {
      ctx.drawImage(bg, 0, 0)
      for (const s of spots) drawSpot(s, 0)
    } else {
      const start = performance.now()
      let raf = 0
      const render = (t: number) => {
        ctx.clearRect(0, 0, w, h)
        ctx.drawImage(bg, 0, 0)
        const phase = (t - start) / 1000
        spots.forEach((s, i) => {
          const pulse = (Math.sin(phase * 2 + i * 0.8) + 1) / 2
          drawSpot(s, pulse)
        })
        raf = requestAnimationFrame(render)
      }
      render(start)
      return () => cancelAnimationFrame(raf)
    }

    const onMove = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const scale = rect.width / w
      const mx = (ev.clientX - rect.left) / scale
      const my = (ev.clientY - rect.top) / scale
      const found = spots.find((s) => Math.hypot(mx - s.x, my - s.y) <= s.r + 3)
      setHover(found ? { tz: found.tz, count: found.count, x: found.x, y: found.y } : null)
    }
    const onLeave = () => setHover(null)
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseleave', onLeave)
    return () => {
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseleave', onLeave)
    }
  }, [data, lowEndMode])

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
          <canvas ref={canvasRef} className={styles.canvas} />
          {hover && (
            <div className={styles.tooltip} style={{ left: hover.x + 14, top: hover.y + 10 }}>
              <strong>{hover.tz}</strong>
              <span>
                {hover.count} user{hover.count === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>
      </div>

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
  )
}

export default Map
