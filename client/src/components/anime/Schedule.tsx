import React, { useState, useEffect, useRef } from 'react'
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa'
import AnimeCard from './AnimeCard'
import styles from './Schedule.module.css'
import AnimeCardSkeleton from './AnimeCardSkeleton'
import ErrorMessage from '../common/ErrorMessage'
import { useCarousel } from '../../hooks/useCarousel'

interface Anime {
  _id: string
  id: string
  name: string
  thumbnail: string
  type?: string
  episodeNumber?: number
  currentTime?: number
  duration?: number
  watchedCount?: number
  episodeCount?: number
  availableEpisodesDetail?: {
    sub?: string[]
    dub?: string[]
  }
  airTime?: string
}

const Schedule: React.FC = () => {
  const [scheduleData, setScheduleData] = useState<Anime[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [format, setFormat] = useState(() => {
    return localStorage.getItem('schedule_format') || 'TV'
  })
  const { emblaRef, canScroll, stepBy, scrollToStart } = useCarousel()
  const dayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem('schedule_format', format)
  }, [format])

  useEffect(() => {
    const fetchEpisodeSchedule = async (date: string) => {
      setLoading(true)
      setError(null)
      try {
        const url = `/api/schedule/${date}?format=${format}`
        const response = await fetch(url)
        if (!response.ok) throw new Error('Failed to fetch episode schedule')
        const data = await response.json()
        setScheduleData(data)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'An unknown error occurred')
        console.error('Error fetching episode schedule:', e)
      } finally {
        setLoading(false)
      }
    }

    fetchEpisodeSchedule(selectedDate)
  }, [selectedDate, format])

  const getDayButtons = () => {
    const days = []
    const today = new Date()
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

    for (let i = -6; i <= 6; i++) {
      const date = new Date()
      date.setDate(today.getDate() + i)
      days.push(date)
    }
    return days.map((date) => {
      const dateString = date.toISOString().split('T')[0]
      const isToday = dateString === today.toISOString().split('T')[0]
      const isYesterday =
        dateString === new Date(today.getTime() - 86400000).toISOString().split('T')[0]

      const dayLabel = isToday ? 'Today' : isYesterday ? 'Yest' : dayNames[date.getDay()]
      const dayNum = date.getDate()
      const monthName = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date)

      return { dateString, dayLabel, dayNum, monthName }
    })
  }

  useEffect(() => {
    if (dayRef.current) {
      const active = dayRef.current.querySelector<HTMLElement>(`[data-date="${selectedDate}"]`)
      if (active) {
        active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      }
    }
  }, [selectedDate])

  useEffect(() => {
    scrollToStart(true)
  }, [selectedDate, scrollToStart])

  const formatOptions = [
    { value: 'TV', label: 'TV' },
    { value: 'ONA', label: 'ONA' },
    { value: 'OVA', label: 'OVA' },
    { value: 'MOVIE', label: 'Movie' },
    { value: 'ALL', label: 'All' },
    { value: 'ADULT', label: 'Mature' },
  ]

  return (
    <div className={styles.scheduleSection}>
      <div className={styles.sectionHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h2 className="section-title" style={{ marginBottom: 0 }}>
            Episode Schedule
          </h2>
          {scheduleData.length > 0 && canScroll && (
            <div className={styles.navArrows}>
              <button
                className={styles.navButton}
                onClick={() => stepBy('left')}
                aria-label="Scroll left"
              >
                <FaChevronLeft />
              </button>
              <button
                className={styles.navButton}
                onClick={() => stepBy('right')}
                aria-label="Scroll right"
              >
                <FaChevronRight />
              </button>
            </div>
          )}
        </div>

        <div className={styles.headerActions}>
          <select
            className={styles.timeSelect}
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            {formatOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.daySelectorContainer}>
        <div className={styles.daySelector} ref={dayRef}>
          <div className={styles.daySelectorInner}>
            {getDayButtons().map((dayButton) => (
              <button
                key={dayButton.dateString}
                type="button"
                data-date={dayButton.dateString}
                className={`${styles.dayBtn} ${
                  selectedDate === dayButton.dateString ? styles.active : ''
                }`}
                onClick={() => setSelectedDate(dayButton.dateString)}
              >
                <span className={styles.dayMonth}>{dayButton.monthName}</span>
                <span className={styles.dayNum}>{dayButton.dayNum}</span>
                <span className={styles.dayName}>{dayButton.dayLabel}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.carouselContainer}>
        <div className={styles.carousel} ref={emblaRef}>
          <div className={styles.carouselInner}>
            {loading ? (
              Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className={styles.carouselCard}>
                  <AnimeCardSkeleton layout="vertical" />
                </div>
              ))
            ) : error ? (
              <div style={{ width: '100%' }}>
                <ErrorMessage message={error} />
              </div>
            ) : scheduleData.length === 0 ? (
              <p style={{ textAlign: 'center', marginTop: '1rem', width: '100%' }}>
                No episodes scheduled for this day.
              </p>
            ) : (
              scheduleData.map((anime) => (
                <div key={anime._id} className={styles.carouselCard}>
                  <AnimeCard
                    key={anime._id}
                    anime={anime}
                    continueWatching={false}
                    layout="vertical"
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Schedule
