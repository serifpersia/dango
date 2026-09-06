import React, { useMemo, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  FaClock,
  FaCheckCircle,
  FaLayerGroup,
  FaFire,
  FaUserAstronaut,
  FaHistory,
  FaExclamationTriangle,
  FaBookmark,
} from 'react-icons/fa'
import { useGenreCards, type GenreCard, type TopShow } from '../hooks/useAnimeData'
import { fixThumbnailUrl } from '../lib/utils'
import { useTitlePreference } from '../contexts/TitlePreferenceContext'
import styles from './Insights.module.css'

interface GenreStat {
  name: string
  count: number
}

interface ActivityDay {
  day: string
  count: number
}

interface HourlyStat {
  hour: string
  count: number
}

interface SeasonalStat {
  month: string
  seconds: number
}

interface DroppedShow {
  id: string
  name: string
  lastActivity: string
}

interface InsightData {
  totalHours: number
  totalEpisodes: number
  totalAnime: number
  completedAnime: number
  completionRate: number
  persona: string
  bingeFactor: number
  avgSessionMinutes: number
  avgCompletionDays: number
  popularityScore: number
  genreSplit: GenreStat[]
  activityGrid: ActivityDay[]
  hourlyDist: HourlyStat[]
  seasonality: SeasonalStat[]
  droppedShows: DroppedShow[]
}

const Insights: React.FC = () => {
  useEffect(() => {
    document.title = 'Insights - dango'
  }, [])

  const { data, isLoading, isError } = useQuery<InsightData>({
    queryKey: ['insights'],
    queryFn: async () => {
      const res = await fetch('/api/insights')
      if (!res.ok) throw new Error('Failed to fetch insights')
      return res.json()
    },
  })

  const { data: genreCardsData, isLoading: isLoadingGenreCards } = useGenreCards()
  const { titlePreference } = useTitlePreference()

  const getShowTitle = (show: TopShow) => {
    switch (titlePreference) {
      case 'nativeName':
        return show.nativeName || show.name
      case 'englishName':
        return show.englishName || show.name
      default:
        return show.name
    }
  }

  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())

  const availableYears = useMemo(() => {
    if (!data?.activityGrid) return [new Date().getFullYear()]
    const years = new Set(data.activityGrid.map((d) => parseInt(d.day.split('-')[0])))
    years.add(new Date().getFullYear())
    return Array.from(years).sort((a, b) => b - a)
  }, [data])

  const heatmapData = useMemo(() => {
    if (!data?.activityGrid) return []
    const daysMap = new Map(data.activityGrid.map((d) => [d.day, d.count]))
    const result = []

    const startDate = new Date(selectedYear, 0, 1)
    const endDate = new Date(selectedYear, 11, 31)

    const startOffset = startDate.getDay()
    const current = new Date(startDate)
    current.setDate(current.getDate() - startOffset)

    while (current <= endDate || current.getDay() !== 0) {
      if (current > endDate && current.getDay() === 0) break

      const year = current.getFullYear()
      const month = String(current.getMonth() + 1).padStart(2, '0')
      const day = String(current.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`

      const isOutOfRange = current < startDate || current > endDate

      result.push({
        date: dateStr,
        count: isOutOfRange ? 0 : daysMap.get(dateStr) || 0,
        month: current.getMonth(),
        isOutOfRange,
      })
      current.setDate(current.getDate() + 1)
    }
    return result
  }, [data, selectedYear])

  const maxSeasonal = useMemo(() => {
    if (!data?.seasonality?.length) return 0
    return Math.max(...data.seasonality.map((s) => s.seconds), 1)
  }, [data])

  const maxHourly = useMemo(() => {
    if (!data?.hourlyDist?.length) return 0
    return Math.max(...data.hourlyDist.map((h) => h.count), 1)
  }, [data])

  if (isLoading || isLoadingGenreCards)
    return <div className={styles.loading}>Analyzing your anime lifestyle...</div>
  if (isError)
    return <div className={styles.error}>Could not load insights. Data might be syncing.</div>
  if (!data) return null

  return (
    <div className="page-container">
      <div className={styles.header}>
        <h2 className="section-title">Watch Insights</h2>
        <div className={styles.personaBadge}>
          <FaUserAstronaut />
          <div className={styles.personaInfo}>
            <span className={styles.personaLabel}>Your Persona</span>
            <span className={styles.personaValue}>{data.persona}</span>
          </div>
        </div>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div
            className={styles.statIcon}
            style={{ background: 'rgba(138, 79, 255, 0.2)', color: 'var(--accent)' }}
          >
            <FaClock />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statValue}>{data.totalHours}h</span>
            <span className={styles.statLabel}>Watch Time</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div
            className={styles.statIcon}
            style={{ background: 'rgba(167, 139, 250, 0.2)', color: '#a78bfa' }}
          >
            <FaBookmark />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statValue}>{data.totalAnime}</span>
            <span className={styles.statLabel}>Total Anime</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div
            className={styles.statIcon}
            style={{ background: 'rgba(34, 197, 94, 0.2)', color: '#22c55e' }}
          >
            <FaCheckCircle />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statValue}>{data.totalEpisodes}</span>
            <span className={styles.statLabel}>Episodes Watched</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div
            className={styles.statIcon}
            style={{ background: 'rgba(34, 197, 94, 0.2)', color: '#22c55e' }}
          >
            <FaCheckCircle />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statValue}>{data.completionRate}%</span>
            <span className={styles.statLabel}>Completion Rate</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div
            className={styles.statIcon}
            style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}
          >
            <FaFire />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statValue}>{data.bingeFactor}</span>
            <span className={styles.statLabel}>Max Daily Binge</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div
            className={styles.statIcon}
            style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6' }}
          >
            <FaHistory />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statValue}>{data.avgSessionMinutes}m</span>
            <span className={styles.statLabel}>Avg. Session</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div
            className={styles.statIcon}
            style={{ background: 'rgba(251, 191, 36, 0.2)', color: '#fbbf24' }}
          >
            <FaLayerGroup />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statValue}>{data.avgCompletionDays}d</span>
            <span className={styles.statLabel}>Avg. Speed</span>
          </div>
        </div>
      </div>

      <div className={styles.wideSection}>
        <div className={styles.sectionHeader}>
          <h3>Activity</h3>
          <select
            className={styles.yearSelect}
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.currentTarget.value))}
          >
            {availableYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.heatmapLayout}>
          <div className={styles.dayLabels}>
            <span style={{ gridRow: 2 }}>Mon</span>
            <span style={{ gridRow: 4 }}>Wed</span>
            <span style={{ gridRow: 6 }}>Fri</span>
          </div>
          <div className={styles.heatmapWrapper}>
            <div className={styles.heatmapMonthLabels}>
              {(() => {
                const labels: React.ReactElement[] = []
                let lastMonth = -1
                heatmapData.forEach((d, i) => {
                  if (d.month !== lastMonth && !d.isOutOfRange) {
                    const weekIdx = Math.floor(i / 7) + 1
                    if (
                      weekIdx >
                      (labels.length > 0
                        ? (labels[labels.length - 1].props.style.gridColumn as number) + 2
                        : -1)
                    ) {
                      labels.push(
                        <span
                          key={i}
                          style={{
                            gridColumn: weekIdx,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {new Date(0, d.month).toLocaleString('default', { month: 'short' })}
                        </span>
                      )
                      lastMonth = d.month
                    }
                  }
                })
                return labels
              })()}
            </div>
            <div className={styles.heatmapGrid}>
              {heatmapData.map((d, i) => {
                let level = 0
                if (d.count > 0 && !d.isOutOfRange) level = 1
                if (d.count > 2 && !d.isOutOfRange) level = 2
                if (d.count > 5 && !d.isOutOfRange) level = 3
                if (d.count > 10 && !d.isOutOfRange) level = 4

                return (
                  <div
                    key={i}
                    className={`${styles.heatBox} ${styles[`level${level}`]} ${d.isOutOfRange ? styles.hiddenBox : ''}`}
                    title={d.isOutOfRange ? '' : `${d.count} episodes on ${d.date}`}
                  />
                )
              })}
            </div>
            <div className={styles.heatmapFooter}>
              <div className={styles.heatLegend}>
                <span>Less</span>
                <div className={`${styles.heatBox} ${styles.level0}`} />
                <div className={`${styles.heatBox} ${styles.level1}`} />
                <div className={`${styles.heatBox} ${styles.level2}`} />
                <div className={`${styles.heatBox} ${styles.level3}`} />
                <div className={`${styles.heatBox} ${styles.level4}`} />
                <span>More</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.chartsContainer}>
        <div className={styles.chartWrapper}>
          <h3>Time Distribution (24h)</h3>
          <div className={styles.hourlyChart}>
            {data.hourlyDist?.map((h, i) => (
              <div key={i} className={styles.hourlyBarContainer}>
                <div
                  className={styles.hourlyBar}
                  style={{
                    height: `${(h.count / maxHourly) * 100 || 2}%`,
                    width: '100%',
                    maxWidth: '12px',
                  }}
                  title={`${h.count} watches at ${h.hour}:00`}
                />
                <span
                  className={styles.hourlyLabel}
                  style={{ visibility: i % 4 === 0 ? 'visible' : 'hidden' }}
                >
                  {h.hour}
                </span>
              </div>
            ))}
          </div>
          <div className={styles.chartSubtext}>
            {(() => {
              if (!data.hourlyDist?.length) {
                return 'Watch more to see your peak hours!'
              }
              const peakHour = parseInt(
                [...data.hourlyDist].sort((a, b) => b.count - a.count)[0].hour
              )
              return peakHour >= 6 && peakHour < 19
                ? 'You prefer daytime watching ☀️'
                : "You're a confirmed Night Owl 🦉"
            })()}
          </div>
        </div>
        <div className={styles.chartWrapper}>
          <h3>Popularity Bias</h3>
          <div className={styles.popScale}>
            <div className={styles.popTrack}>
              <div
                className={styles.popThumb}
                style={{ left: `${Math.max(0, Math.min(100, 100 - data.popularityScore * 10))}%` }}
              />
            </div>
            <div className={styles.popLabels}>
              <span>Mainstream</span>
              <span>Underground</span>
            </div>
          </div>
          <p className={styles.popDescription}>
            Your taste score is <strong>{data.popularityScore}/10</strong>.
            {data.popularityScore >= 5
              ? ' You follow the big hits!'
              : " You're a connoisseur of the obscure!"}
          </p>
        </div>
        <div className={styles.chartWrapper}>
          <h3>Monthly Activity</h3>
          <div className={styles.seasonalChart}>
            {data.seasonality?.map((s, i) => (
              <div key={i} className={styles.seasonalBarContainer}>
                <div
                  className={styles.seasonalBar}
                  style={{
                    height: `${(s.seconds / maxSeasonal) * 100 || 5}%`,
                    width: '100%',
                    maxWidth: '24px',
                  }}
                  title={`${Math.round(s.seconds / 3600)}h in ${new Date(0, i).toLocaleString('default', { month: 'long' })}`}
                />
                <span className={styles.seasonalLabel}>
                  {new Date(0, i).toLocaleString('default', { month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.genreGrid}>
        {isLoadingGenreCards
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={styles.genreCardSkeleton}>
                <div className={styles.skeletonRank} />
                <div className={styles.skeletonTitle} />
                <div className={styles.skeletonStats} />
                <div className={styles.skeletonPosters} />
              </div>
            ))
          : genreCardsData?.map((card: GenreCard) => (
              <div key={card.name} className={styles.genreCard}>
                <div className={styles.rankBadge}>
                  <span className={styles.rankNumber}>{card.rank}</span>
                </div>
                <h3 className={styles.genreTitle}>{card.name}</h3>
                <div className={styles.genreStats}>
                  <span>{card.count} episodes</span>
                  <span>{card.meanScore.toFixed(1)} avg score</span>
                  <span>{card.timeWatched}</span>
                </div>
                <div className={styles.posterRow}>
                  {card.topShows.map((show: TopShow) => (
                    <img
                      key={show.id}
                      src={fixThumbnailUrl(show.thumbnail)}
                      alt={getShowTitle(show)}
                      className={styles.miniPoster}
                      title={getShowTitle(show)}
                    />
                  ))}
                </div>
              </div>
            ))}
      </div>

      {data.droppedShows?.length > 0 && (
        <div className={styles.warningSection}>
          <div className={styles.warningHeader}>
            <FaExclamationTriangle />
            <h3>Dusty Watchlist (Inactive 90+ days)</h3>
          </div>
          <div className={styles.droppedGrid}>
            {data.droppedShows.map((show) => (
              <div key={show.id} className={styles.droppedCard}>
                <span className={styles.droppedName}>{show.name}</span>
                <span className={styles.droppedDate}>
                  Last watched: {new Date(show.lastActivity).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default Insights
