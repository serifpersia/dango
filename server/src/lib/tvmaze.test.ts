import assert from 'node:assert/strict'
import test from 'node:test'
import {
  airDateMidnightMs,
  airTimestampMs,
  pickNextAiring,
  resolveEpisodesWithTvMaze,
  type TvMazeShow,
} from './tvmaze.js'

const usShow: TvMazeShow = {
  id: 78665,
  schedule: { time: '', days: ['Friday'] },
  country: { timezone: 'America/New_York' },
  webChannel: null,
}

test('midnight in show timezone converts to the right UTC instant', () => {
  const ms = airDateMidnightMs('2026-11-13', 'America/New_York')
  assert.equal(new Date(ms).toISOString(), '2026-11-13T05:00:00.000Z')
  assert.equal(
    new Date(airDateMidnightMs('2026-11-13', null)).toISOString(),
    '2026-11-13T00:00:00.000Z'
  )
  assert.ok(Number.isNaN(airDateMidnightMs('soon', 'America/New_York')))
})

test('airTimestampMs prefers the exact TVmaze timestamp', () => {
  assert.equal(
    airTimestampMs({ airtimestamp: 1763000000, airdate: '2026-11-13' }, 'America/New_York'),
    1763000000 * 1000
  )
  assert.equal(
    airTimestampMs({ airdate: '2026-11-13' }, 'America/New_York'),
    airDateMidnightMs('2026-11-13', 'America/New_York')
  )
  assert.equal(airTimestampMs({ airdate: null }, 'America/New_York'), null)
})

test('pickNextAiring picks the soonest future episode', () => {
  const episodes = [
    { season: 2, number: 1, name: 'Risky Business', airdate: '2026-10-30' },
    { season: 2, number: 2, name: 'Fallen', airdate: '2026-11-06' },
    { season: 2, number: 3, name: 'Live Free and Die', airdate: '2026-11-13' },
    { season: 2, number: 4, name: 'TBA', airdate: '2026-11-20' },
  ]
  const next = pickNextAiring(episodes, usShow, '2026-11-07')
  assert.equal(next?.episode_number, 3)
  assert.equal(next?.season_number, 2)
  assert.equal(next?.air_date, '2026-11-13')
  assert.equal(next?.air_timestamp, airDateMidnightMs('2026-11-13', 'America/New_York'))
})

test('resolveEpisodesWithTvMaze merges TVmaze dates over skewed TMDB dates', () => {
  const tmdbEpisodes = [
    { episode_number: 1, name: 'E1', air_date: '2026-11-01' },
    { episode_number: 2, name: 'E2', air_date: '2026-11-08' },
    { episode_number: 3, name: 'E3', air_date: '2026-11-15' },
  ]
  const data = {
    show: usShow,
    episodes: [
      { season: 2, number: 1, name: 'Risky Business', airdate: '2026-10-30' },
      { season: 2, number: 2, name: 'Fallen', airdate: '2026-11-06' },
      { season: 2, number: 3, name: 'Live Free and Die', airdate: '2026-11-13' },
    ],
  }
  const { aired, nextAiring } = resolveEpisodesWithTvMaze(tmdbEpisodes, data, 2, '2026-11-07')
  assert.deepEqual(
    aired.map((e) => e.episode_number),
    [1, 2]
  )
  assert.equal(nextAiring?.episode_number, 3)
  assert.equal(nextAiring?.air_date, '2026-11-13')
})

test('resolveEpisodesWithTvMaze falls back to TMDB dates without TVmaze', () => {
  const tmdbEpisodes = [
    { episode_number: 1, name: 'E1', air_date: '2026-11-01' },
    { episode_number: 2, name: 'E2', air_date: '2026-11-08' },
  ]
  const { aired, nextAiring } = resolveEpisodesWithTvMaze(tmdbEpisodes, null, 2, '2026-11-07')
  assert.deepEqual(
    aired.map((e) => e.episode_number),
    [1]
  )
  assert.equal(nextAiring?.episode_number, 2)
})
