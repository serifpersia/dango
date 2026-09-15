import { Request, Response } from 'express'
import logger from '../logger.js'
import { InsightsRepository } from '../repositories/insights.repository.js'

interface CoreStats {
  totalSeconds?: number
  totalEpisodes?: number
  totalAnime: number
  completedCount: number
  totalWatchlist: number
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

interface WatchedShowMeta {
  id: string
  genres: string
  popularityScore: number
}

interface DroppedShow {
  id: string
  name: string
  lastActivity: string
}

interface CompletionVelocity {
  daysToFinish: number
}

interface TopShow {
  id: string
  name: string
  nativeName?: string
  englishName?: string
  thumbnail: string
}

interface GenreCard {
  rank: number
  name: string
  count: number
  meanScore: number
  timeWatched: string
  topShows: TopShow[]
}

interface WatchedEpisodeWithMeta {
  showId: string
  currentTime: number
  duration: number
  genres: string
  popularityScore: number
  name: string
  nativeName?: string
  englishName?: string
  thumbnail: string
}

export class InsightsController {
  getWatchInsights = async (req: Request, res: Response) => {
    const db = req.db

    const [
      core,
      activityGrid,
      hourlyDist,
      seasonality,
      allWatches,
      watchedShows,
      droppedWarning,
      velocities,
    ] = (await Promise.all([
      InsightsRepository.getCoreStats(db),
      InsightsRepository.getActivityGrid(db),
      InsightsRepository.getHourlyDist(db),
      InsightsRepository.getSeasonality(db),
      InsightsRepository.getAllWatches(db),
      InsightsRepository.getWatchedShowsMeta(db),
      InsightsRepository.getDroppedShows(db),
      InsightsRepository.getCompletionVelocities(db),
    ])) as [
      CoreStats,
      ActivityDay[],
      HourlyStat[],
      SeasonalStat[],
      { watchedAt: string; currentTime: number }[],
      WatchedShowMeta[],
      DroppedShow[],
      CompletionVelocity[],
    ]

    const bingeFactor = activityGrid.length > 0 ? Math.max(...activityGrid.map((a) => a.count)) : 0

    const sessions: number[] = []
    if (allWatches.length > 0) {
      let currentSessionSeconds = allWatches[0].currentTime
      for (let i = 1; i < allWatches.length; i++) {
        const prev = new Date(allWatches[i - 1].watchedAt).getTime()
        const curr = new Date(allWatches[i].watchedAt).getTime()
        if (curr - prev < 3600000) {
          currentSessionSeconds += allWatches[i].currentTime
        } else {
          sessions.push(currentSessionSeconds)
          currentSessionSeconds = allWatches[i].currentTime
        }
      }
      sessions.push(currentSessionSeconds)
    }
    const avgSessionMinutes =
      sessions.length > 0
        ? Math.round(sessions.reduce((a, b) => a + b, 0) / sessions.length / 60)
        : 0

    const genreCounts: Record<string, number> = {}
    let totalPopScore = 0
    let popCount = 0

    for (const show of watchedShows) {
      let genres: string[] = []
      if (show.genres) {
        try {
          if (show.genres.startsWith('[')) {
            genres = JSON.parse(show.genres)
          } else {
            genres = show.genres.split(',').map((g: string) => g.trim())
          }
        } catch (e) {
          logger.warn({ err: e, showId: show.id }, 'Failed to parse genres for insights')
        }
      }

      for (const g of genres) {
        genreCounts[g] = (genreCounts[g] || 0) + 1
      }

      if (show.popularityScore) {
        totalPopScore += show.popularityScore
        popCount++
      }
    }

    const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
    const personaMap: Record<string, string> = {
      Action: 'Shonen Warrior',
      Romance: 'Hopeless Romantic',
      Comedy: 'Chaos Enjoyer',
      'Slice of Life': 'Vibe Seeker',
      Horror: 'Fearless Watcher',
      Fantasy: 'Isekai Traveller',
      'Sci-Fi': 'Future Scientist',
      Drama: 'Feels Collector',
    }
    const persona = personaMap[topGenre || ''] || 'Anime Enthusiast'

    const avgCompletionDays =
      velocities.length > 0
        ? Math.round(velocities.reduce((a, b) => a + b.daysToFinish, 0) / velocities.length)
        : 0

    res.json({
      totalHours: Math.round((core?.totalSeconds || 0) / 3600),
      totalEpisodes: core?.totalEpisodes || 0,
      totalAnime: core?.totalAnime || 0,
      completedAnime: core?.completedCount || 0,
      completionRate:
        core?.totalWatchlist > 0
          ? Math.round((core.completedCount / core.totalWatchlist) * 100)
          : 0,
      persona,
      bingeFactor,
      avgSessionMinutes,
      avgCompletionDays,
      popularityScore: popCount > 0 ? Math.round(totalPopScore / popCount) : 0,
      genreSplit:
        Object.entries(genreCounts)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8) || [],
      activityGrid: activityGrid || [],
      hourlyDist:
        Array.from({ length: 24 }, (_, i) => {
          const hour = i.toString().padStart(2, '0')
          return { hour, count: hourlyDist?.find((d) => d.hour === hour)?.count || 0 }
        }) || [],
      seasonality:
        Array.from({ length: 12 }, (_, i) => {
          const month = (i + 1).toString().padStart(2, '0')
          return {
            month,
            seconds: seasonality?.find((s) => s.month === month)?.seconds || 0,
          }
        }) || [],
      droppedShows: (droppedWarning || []).slice(0, 5),
    })
  }

  private formatTime(seconds: number): string {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)

    if (days > 0) {
      return `${days} days ${hours > 0 ? `${hours} hours` : ''}`
    }
    if (hours > 0) {
      return `${hours} hours${minutes > 0 ? ` ${minutes} mins` : ''}`
    }
    return `${minutes} mins`
  }

  getGenreCards = async (req: Request, res: Response) => {
    const db = req.db
    const rows: WatchedEpisodeWithMeta[] = await InsightsRepository.getWatchedEpisodesWithMeta(db)

    const genreData: Record<
      string,
      {
        count: number
        totalTime: number
        scores: number[]
        showWatches: Record<string, number>
        showMeta: Record<
          string,
          { name: string; nativeName?: string; englishName?: string; thumbnail: string }
        >
      }
    > = {}

    for (const row of rows) {
      let genres: string[] = []
      if (row.genres) {
        try {
          if (row.genres.startsWith('[')) {
            genres = JSON.parse(row.genres)
          } else {
            genres = row.genres.split(',').map((g: string) => g.trim())
          }
        } catch (e) {
          logger.warn({ err: e, showId: row.showId }, 'Failed to parse genres for genre cards')
        }
      }

      const timeWatched = (row.currentTime || 0) + (row.duration || 0)
      let score = row.popularityScore || 0
      if (score > 10) score = score / 10

      for (const genre of genres) {
        if (!genreData[genre]) {
          genreData[genre] = { count: 0, totalTime: 0, scores: [], showWatches: {}, showMeta: {} }
        }
        genreData[genre].count++
        genreData[genre].totalTime += timeWatched
        if (score > 0) genreData[genre].scores.push(score)
        genreData[genre].showWatches[row.showId] =
          (genreData[genre].showWatches[row.showId] || 0) + 1
        if (row.name && row.thumbnail) {
          genreData[genre].showMeta[row.showId] = {
            name: row.name,
            nativeName: row.nativeName,
            englishName: row.englishName,
            thumbnail: row.thumbnail,
          }
        }
      }
    }

    const genreCards: GenreCard[] = Object.entries(genreData).map(([name, data]) => {
      const topShows = Object.entries(data.showWatches)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([showId]) => ({
          id: showId,
          name: data.showMeta[showId]?.name || '',
          nativeName: data.showMeta[showId]?.nativeName,
          englishName: data.showMeta[showId]?.englishName,
          thumbnail: data.showMeta[showId]?.thumbnail || '',
        }))

      return {
        rank: 0,
        name,
        count: data.count,
        meanScore:
          data.scores.length > 0 ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length : 0,
        timeWatched: this.formatTime(data.totalTime),
        topShows,
      }
    })

    genreCards.sort((a, b) => b.count - a.count)
    genreCards.forEach((card, i) => {
      card.rank = i + 1
    })

    res.json(genreCards)
  }
}
