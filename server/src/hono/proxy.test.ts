import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyEmbedPatches } from './proxy/embed.js'
import { isBinaryMediaUrl, makeMpdProxier, rewriteMpdBody } from './proxy/stream.js'
import { mirrorUrls } from './proxy/rules.js'

test('mirrorUrls returns the url itself when there are no mirrors', () => {
  assert.deepEqual(mirrorUrls('https://host/x.m3u8', undefined), ['https://host/x.m3u8'])
  assert.deepEqual(mirrorUrls('https://host/x.m3u8', []), ['https://host/x.m3u8'])
})

test('mirrorUrls adds one candidate per mirror host', () => {
  assert.deepEqual(mirrorUrls('https://host/a/b.m3u8', ['m1.example', 'm2.example']), [
    'https://host/a/b.m3u8',
    'https://m1.example/a/b.m3u8',
    'https://m2.example/a/b.m3u8',
  ])
})

test('mirrorUrls skips a mirror that is the same host', () => {
  assert.deepEqual(mirrorUrls('https://host/a.m3u8', ['host', 'other.example']), [
    'https://host/a.m3u8',
    'https://other.example/a.m3u8',
  ])
})

test('isBinaryMediaUrl flags direct media files but not pages or playlists', () => {
  assert.equal(isBinaryMediaUrl('https://cdn.example/RJ300204.mp3'), true)
  assert.equal(isBinaryMediaUrl('https://cdn.example/RJ300204%202.mp3?token=x'), true)
  assert.equal(isBinaryMediaUrl('https://cdn.example/list.m3u8'), false)
  assert.equal(isBinaryMediaUrl('https://site.example/watch/1'), false)
})

test('applyEmbedPatches rewrites relative urls to absolute ones', () => {
  const html = '<html><body><script src="/js/app.js"></script></body></html>'
  const patched = applyEmbedPatches(html, new URL('https://embed.example/watch/1'))

  assert.ok(patched)
  assert.match(patched, /src="https:\/\/embed\.example\/js\/app\.js"/)
})

test('applyEmbedPatches injects the hls and end bridge patches', () => {
  const html =
    '<html><body><script src="/js/plyr.min.js"></script><script src="/js/hls.min.js"></script></body></html>'
  const patched = applyEmbedPatches(html, new URL('https://embed.example/watch/1'))

  assert.ok(patched)
  assert.match(patched, /Plyr\.defaults\.iconUrl/)
  assert.match(patched, /Hls\.prototype\.loadSource/)
  assert.match(patched, /ANI_WEB_MEDIA_ENDED/)
})

test('applyEmbedPatches keeps a page that has nothing to patch', () => {
  const html = '<html><body>plain</body></html>'
  const patched = applyEmbedPatches(html, new URL('https://embed.example/watch/1'))

  assert.ok(patched, 'a page with a body must not be rejected')
  assert.match(patched, /plain/)
})

test('applyEmbedPatches rejects a body that is not html at all', () => {
  assert.equal(applyEmbedPatches('not html', new URL('https://embed.example/')), null)
  assert.equal(applyEmbedPatches('', new URL('https://embed.example/')), null)
})

test('rewriteMpdBody proxies segment templates and keeps dash tokens literal', () => {
  const mpd =
    '<SegmentTemplate initialization="chunks/init-stream$RepresentationID$.webp" media="chunks/chunk-stream$RepresentationID$-$Number%05d$.webp" startNumber="1">'
  const proxier = makeMpdProxier('https://site.example/', '', '')
  const rewritten = rewriteMpdBody(mpd, 'https://cdn.example/ep/720/manifest.mpd', proxier)

  assert.match(rewritten, /\$Number%05d\$/)
  assert.match(rewritten, /\$RepresentationID\$/)
  assert.match(rewritten, /\/api\/proxy\?url=https:\/\/cdn\.example\/ep\/720\/chunks\//)
  assert.doesNotMatch(rewritten, /%24Number/)
  assert.doesNotMatch(rewritten, /%2505d/)
  assert.match(rewritten, /&amp;referer=/)
  assert.doesNotMatch(rewritten, /&referer=/)
})

test('rewriteMpdBody leaves data urls, proxied urls and base urls intact', () => {
  const mpd =
    '<BaseURL>https://cdn.example/</BaseURL>' +
    '<SegmentTemplate initialization="data:;base64,AA" media="/api/proxy?url=x.webp" startNumber="1">'
  const proxier = makeMpdProxier('', '', '')
  const rewritten = rewriteMpdBody(mpd, 'https://cdn.example/ep/manifest.mpd', proxier)

  assert.match(rewritten, /<BaseURL>\/api\/proxy\?url=https:\/\/cdn\.example\/<\/BaseURL>/)
  assert.match(rewritten, /initialization="data:;base64,AA"/)
  assert.match(rewritten, /media="\/api\/proxy\?url=x\.webp"/)
})
