const ext = typeof browser !== 'undefined' ? browser : chrome

const clean = (v) => v.trim().replace(/^["']+|["']+$/g, '')

const tag = (c) => `${c.name}@${c.domain}[${c.storeId}]`

const isPahe = (c) =>
  (c.domain || '').includes('animepahe') || (c.firstPartyDomain || '').includes('animepahe')

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

let captured = null

const fromHeader = (headerValue) => {
  const m = /(?:^|;\s*)cf_clearance=([^;]+)/.exec(headerValue || '')
  return m ? clean(m[1]) : null
}

try {
  ext.webRequest.onSendHeaders.addListener(
    (details) => {
      const h = (details.requestHeaders || []).find((x) => x.name.toLowerCase() === 'cookie')
      const v = h && fromHeader(h.value)
      if (v) captured = { value: v, at: Date.now(), source: 'header-capture' }
    },
    { urls: ['https://animepahe.pw/*'] },
    ['requestHeaders']
  )
} catch {
  // ignore
}

ext.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'GET_PAHE_COOKIE') return undefined
  return (async () => {
    const ids = await storeIds()
    const checked = []
    const names = []
    for (const storeId of ids) {
      const opts = {}
      if (storeId) opts.storeId = storeId
      const all = await ext.cookies.getAll(opts)
      checked.push(storeId || 'default')
      for (const c of all) {
        if (isPahe(c)) names.push(tag(c))
      }
      const cf = all.find((c) => c.name === 'cf_clearance' && isPahe(c))
      if (cf) return { ok: true, cookie: clean(cf.value), storeId: storeId || 'default' }
    }
    if (captured) {
      return { ok: true, cookie: captured.value, storeId: captured.source, at: captured.at }
    }
    try {
      const parted = await ext.cookies.getAll({
        partitionKey: { topLevelSite: 'https://animepahe.pw' },
      })
      for (const c of parted) names.push(tag(c))
      const cf = parted.find((c) => c.name === 'cf_clearance')
      if (cf) return { ok: true, cookie: clean(cf.value), storeId: 'partitioned-jar' }
    } catch {
      // ignore
    }
    return { ok: false, error: 'NO_COOKIE', debug: { stores: checked, names } }
  })()
})
