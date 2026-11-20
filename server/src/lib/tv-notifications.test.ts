import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeTvEpisodes } from './tv-notifications.js'
import type { TvMazeData } from './tvmaze.js'

const now = Date.UTC(2026, 10, 20, 12, 0, 0)
const at = (day: number) => Math.floor(Date.UTC(2026, 10, day, 20, 0, 0) / 1000)

const maze: TvMazeData = {
  show: { id: 1, country: { timezone: 'UTC' } },
  episodes: [
    { season: 1, number: 1, airdate: '2026-11-10', airtimestamp: at(10), name: 'One' },
    { season: 1, number: 2, airdate: '2026-11-17', airtimestamp: at(17), name: 'Two' },
    { season: 1, number: 3, airdate: '2026-11-24', airtimestamp: at(24), name: 'Three' },
    { season: 2, number: 1, airdate: '2026-12-01', airtimestamp: at(31), name: 'Four' },
  ],
}

test('reports the earliest pending aired episode and the next upcoming one', () => {
  const result = summarizeTvEpisodes(maze, [{ season: 1, episode: 1, completed: 1 }], now)
  assert.deepEqual(result.pending, {
    season: 1,
    episode: 2,
    latestSeason: 1,
    latestEpisode: 2,
    pendingCount: 1,
    latestAiredMs: at(17) * 1000,
  })
  assert.deepEqual(result.next, {
    season: 1,
    episode: 3,
    airingAt: at(24),
    name: 'Three',
  })
})

test('episodes older than the release window are ignored', () => {
  const result = summarizeTvEpisodes(maze, [{ season: 1, episode: 2, completed: 1 }], now)
  assert.equal(result.pending, null)
})

test('started episodes count as seen and future episodes never count as pending', () => {
  const result = summarizeTvEpisodes(
    maze,
    [
      { season: 1, episode: 1, completed: 1 },
      { season: 1, episode: 2, currentTime: 1, completed: 0 },
      { season: 1, episode: 3, completed: 1 },
    ],
    now
  )
  assert.equal(result.pending, null)
  assert.equal(result.next?.season, 2)
  assert.equal(result.next?.episode, 1)
})
