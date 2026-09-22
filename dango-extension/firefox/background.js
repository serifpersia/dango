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

const findCfClearance = async (needles) => {
  const ids = await storeIds()
  const checked = []
  const names = []
  for (const storeId of ids) {
    const opts = {}
    if (storeId) opts.storeId = storeId
    const all = await ext.cookies.getAll(opts)
    checked.push(storeId || 'default')
    for (const c of all) {
      if (matchesAny(c, needles)) names.push(tag(c))
    }
    const cf = all.find((c) => c.name === 'cf_clearance' && matchesAny(c, needles))
    if (cf) return { ok: true, cookie: clean(cf.value), storeId: storeId || 'default' }
  }
  return { ok: false, checked, names }
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
  return undefined
})
