import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseWatchPlayback,
  parseWatchName,
  sameWatchSelection,
  watchPosition,
} from './watch-along.js'

const playback = {
  selection: {
    showId: '21',
    episode: '4.5',
    provider: 'example',
    mode: 'sub',
    source: 'Server 1',
    title: 'Example',
  },
  position: 100,
  playing: true,
  rate: 1.5,
}

test('display names normalize whitespace, allow an empty default, and reject oversized or non-text input', () => {
  assert.equal(parseWatchName('  Alex   Smith  '), 'Alex Smith')
  assert.equal(parseWatchName('   '), '')
  assert.equal(parseWatchName('名前'), '名前')
  assert.throws(() => parseWatchName('a'.repeat(33)))
  assert.throws(() => parseWatchName({ name: 'Alex' }))
})

test('watch-along validates and strips extra fields at the room boundary', () => {
  assert.deepEqual(parseWatchPlayback({ ...playback, secret: 'ignore' }), playback)
  for (const patch of [
    { position: NaN },
    { position: -1 },
    { rate: 0 },
    { playing: 'yes' },
    { selection: { ...playback.selection, showId: '../settings' } },
    { selection: { ...playback.selection, mode: 'other' } },
  ])
    assert.throws(() => parseWatchPlayback({ ...playback, ...patch }))
})

test('room time advances only while playing, accounting for playback speed', () => {
  const state = { ...parseWatchPlayback(playback), updatedAt: 1000 }
  assert.equal(watchPosition(state, 3000), 103)
  assert.equal(watchPosition({ ...state, playing: false }, 3000), 100)
  assert.equal(watchPosition(state, 500), 100)
  assert.equal(
    sameWatchSelection(state.selection, { ...state.selection, title: 'Different label' }),
    true
  )
  assert.equal(
    sameWatchSelection(state.selection, { ...state.selection, source: 'Other cut' }),
    false
  )
})

test('TV rooms require a valid season and episode; movie rooms can use a provider default server', () => {
  const tv = {
    ...playback,
    selection: { ...playback.selection, kind: 'tv', season: 2, episode: '4' },
  }
  assert.equal(parseWatchPlayback(tv).selection.season, 2)
  assert.throws(() => parseWatchPlayback({ ...tv, selection: { ...tv.selection, season: -1 } }))
  assert.throws(() => parseWatchPlayback({ ...tv, selection: { ...tv.selection, episode: '4.5' } }))
  const movie = {
    ...playback,
    selection: { ...playback.selection, kind: 'movie', episode: '1', source: '' },
  }
  assert.equal(parseWatchPlayback(movie).selection.kind, 'movie')
  assert.equal(
    sameWatchSelection(parseWatchPlayback(tv).selection, {
      ...parseWatchPlayback(tv).selection,
      season: 3,
    }),
    false
  )
})
