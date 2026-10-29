import assert from 'node:assert/strict'
import test from 'node:test'
import { rankByTitleMatch } from './title-matching.js'

test('rankByTitleMatch prioritizes title matches and keeps order for empty queries', () => {
  const shows = [{ title: 'Other show' }, { title: 'The Office' }, { title: 'Office' }]

  assert.deepEqual(
    rankByTitleMatch(shows, 'The Office', (show) => [show.title]).map((show) => show.title),
    ['The Office', 'Office', 'Other show']
  )
  assert.equal(
    rankByTitleMatch(shows, '', (show) => [show.title]),
    shows
  )
})
