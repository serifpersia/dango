const ext = typeof browser !== 'undefined' ? browser : chrome

const clean = (v) =>
  String(v || '')
    .trim()
    .replace(/^["']+|["']+$/g, '')

const tag = (c) => `${c.name}@${c.domain}[${c.storeId}]`

const matchesAny = (c, needles) =>
  needles.some((n) => (c.domain || '').includes(n) || (c.firstPartyDomain || '').includes(n))

const PAHE_DOMAINS = ['animepahe']
const JASMR_DOMAINS = ['japaneseasmr']
const YTMUSIC_DOMAINS = ['music.youtube.com', 'youtube.com', 'google.com']

const YTMUSIC_COOKIES = new Set([
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  'LOGIN_INFO',
  'PREF',
  'SIDCC',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PAPISID',
  '__Secure-3PAPISID',
  '__Secure-1PSIDTS',
  '__Secure-3PSIDTS',
  '__Secure-1PSIDCC',
  '__Secure-3PSIDCC',
  'VISITOR_INFO1_LIVE',
  'VISITOR_PRIVACY_METADATA',
  'YSC',
  '__Secure-YNID',
  '__Secure-YENID',
  '__Secure-ROLLOUT_TOKEN',
  'SOCS',
  'AEC',
  'NID',
  'DV',
  'OTZ',
])

const storeIds = async () => {
  try {
    if (ext.cookies.getAllCookieStores) {
      const stores = await ext.cookies.getAllCookieStores()
      if (stores.length) return stores.map((s) => s.id)
    }
  } catch {
    // ignore
  }
  return [undefined]
}

const captured = { pahe: null, jasmr: null }

const cfFromHeader = (headerValue) => {
  const m = /(?:^|;\s*)cf_clearance=([^;]+)/.exec(headerValue || '')
  return m ? clean(m[1]) : null
}

try {
  ext.webRequest.onSendHeaders.addListener(
    (details) => {
      const h = (details.requestHeaders || []).find((x) => x.name.toLowerCase() === 'cookie')
      const v = h && cfFromHeader(h.value)
      if (v) {
        const key = details.url.includes('japaneseasmr') ? 'jasmr' : 'pahe'
        captured[key] = { value: v, at: Date.now(), source: 'header-capture' }
      }
    },
    {
      urls: [
        'https://animepahe.pw/*',
        'https://japaneseasmr.com/*',
        'https://*.japaneseasmr.com/*',
      ],
    },
    ['requestHeaders']
  )
} catch {
  // ignore
}

const findCookie = async (needles, cookieName = 'cf_clearance', partitionKey) => {
  const ids = await storeIds()
  const checked = []
  const names = []
  for (const storeId of ids) {
    const opts = {}
    if (storeId) opts.storeId = storeId
    if (partitionKey) opts.partitionKey = partitionKey
    let all
    try {
      all = await ext.cookies.getAll(opts)
    } catch {
      continue
    }
    checked.push(storeId || 'default')
    for (const c of all) {
      if (matchesAny(c, needles)) names.push(tag(c))
    }
    const match = all.find((c) => c.name === cookieName && matchesAny(c, needles))
    if (match) return { ok: true, cookie: clean(match.value), storeId: storeId || 'default' }
  }
  return { ok: false, checked, names }
}

const findCfClearance = (needles) => findCookie(needles, 'cf_clearance')

const getFullCookieHeader = async (needles) => {
  const ids = await storeIds()
  const checked = []
  const byName = new Map()
  const dropped = []
  for (const storeId of ids) {
    const opts = {}
    if (storeId) opts.storeId = storeId
    const all = await ext.cookies.getAll(opts)
    checked.push(storeId || 'default')
    for (const c of all) {
      if (!matchesAny(c, needles)) continue
      if (!YTMUSIC_COOKIES.has(c.name)) continue
      const v = String(c.value || '')
      if (v.includes('…') || v.includes('...')) {
        dropped.push(c.name)
        continue
      }
      if (!byName.has(c.name)) byName.set(c.name, v)
    }
  }
  const names = [...byName.keys()]
  const header = names.map((n) => `${n}=${byName.get(n)}`).join('; ')
  if (header.includes('SID')) return { ok: true, header, names, dropped, checked }
  return { ok: false, error: 'NO_COOKIE', checked, names, dropped }
}

ext.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg.type !== 'string') return undefined
  if (msg.type === 'GET_PAHE_COOKIE' || msg.type === 'GET_JASMR_COOKIE') {
    const isJasmr = msg.type === 'GET_JASMR_COOKIE'
    const needles = isJasmr ? JASMR_DOMAINS : PAHE_DOMAINS
    return (async () => {
      const found = await findCfClearance(needles)
      if (found.ok) return found
      const cap = isJasmr ? captured.jasmr : captured.pahe
      if (cap) return { ok: true, cookie: cap.value, storeId: cap.source, at: cap.at }
      return { ok: false, error: 'NO_COOKIE', debug: { stores: found.checked, names: found.names } }
    })()
  }
  if (msg.type === 'GET_PROVIDER_COOKIE') {
    const raw = [msg.origin, msg.domain].find(
      (v) => typeof v === 'string' && /^https?:\/\/[^/]+/i.test(v.trim())
    )
    if (!raw) return Promise.resolve({ ok: false, error: 'NO_DOMAIN' })
    const origin = new URL(raw.trim()).origin
    const host = new URL(origin).host
    const base = host.split('.').slice(-2)[0] || host
    const cookieName =
      typeof msg.cookieName === 'string' && msg.cookieName.trim()
        ? msg.cookieName.trim()
        : 'cf_clearance'
    return (async () => {
      const attempts = []
      for (const partitionKey of [undefined, { topLevelSite: origin }]) {
        for (const needles of [[host], [base]]) {
          const found = await findCookie(needles, cookieName, partitionKey)
          if (found.ok) return found
          attempts.push(found)
        }
      }
      return {
        ok: false,
        error: 'NO_COOKIE',
        debug: {
          stores: [...new Set(attempts.flatMap((a) => a.checked))],
          names: [...new Set(attempts.flatMap((a) => a.names))],
        },
      }
    })()
  }
  if (msg.type === 'GET_YTMUSIC_COOKIE') {
    return (async () => {
      const res = await getFullCookieHeader(YTMUSIC_DOMAINS)
      if (res.ok)
        return {
          ok: true,
          cookie: res.header,
          count: res.names.length,
          names: res.names,
          dropped: res.dropped,
        }
      return { ok: false, error: 'NO_COOKIE', debug: { stores: res.checked, names: res.names } }
    })()
  }
  return undefined
})
