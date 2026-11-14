const ext = typeof browser !== 'undefined' ? browser : chrome

const listEl = document.getElementById('list')
const searchEl = document.getElementById('search')
const statusEl = document.getElementById('status')
const refreshEl = document.getElementById('refresh')
const serverEl = document.getElementById('server')
const connectEl = document.getElementById('connect')
const providerEl = document.getElementById('provider')
const noteEl = document.getElementById('provider-note')
const toastEl = document.getElementById('toast')
const toastTextEl = document.getElementById('toast-text')
const discordEl = document.getElementById('discord')
const discordValueEl = document.getElementById('discord-value')
const discordCopyEl = document.getElementById('discord-copy')
const discordGrabEl = document.getElementById('discord-grab')
const ytmusicValueEl = document.getElementById('ytmusic-value')
const ytmusicCopyEl = document.getElementById('ytmusic-copy')
const ytmusicGrabEl = document.getElementById('ytmusic-grab')

const COPY_ICON = document.getElementById('icon-copy').content
const CHECK_ICON = document.getElementById('icon-check').content

const SERVER_KEY = 'dango:server'
const DEFAULT_SERVER = 'http://localhost:3000'

let cookies = []
let providers = []
let activeProvider = null
let toastTimer
let discordToken = ''
let discordTabId = null
let discordBusy = false
let ytmusicCookies = ''

const isDiscordUrl = (url) => {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'discord.com' || host.endsWith('.discord.com')
  } catch {
    return false
  }
}

const maskToken = (token) => (token.length > 14 ? `${token.slice(0, 6)}…${token.slice(-4)}` : token)

function extractDiscordToken() {
  if (!/(^|\.)discord\.com$/i.test(location.hostname)) return null
  var w = window.wrappedJSObject || window
  var token = null
  try {
    w.webpackChunkdiscord_app.push([
      [Symbol()],
      {},
      function (req) {
        if (!req || !req.c) return
        var modules = Object.values(req.c)
        for (var i = 0; i < modules.length; i++) {
          var m = modules[i]
          try {
            if (!m.exports || m.exports === w) continue
            if (typeof m.exports.getToken === 'function') {
              var direct = m.exports.getToken()
              if (direct) {
                token = direct
                return
              }
            }
            for (var k in m.exports) {
              try {
                var ex = m.exports[k]
                if (
                  ex &&
                  typeof ex.getToken === 'function' &&
                  ex[Symbol.toStringTag] !== 'IntlMessagesProxy'
                ) {
                  var nested = ex.getToken()
                  if (nested) {
                    token = nested
                    return
                  }
                }
              } catch (e1) {}
            }
          } catch (e2) {}
        }
      },
    ])
  } catch (e3) {
    // ignore
  } finally {
    try {
      w.webpackChunkdiscord_app.pop()
    } catch (e4) {
      // ignore
    }
  }
  return token || null
}

const runDiscordExtraction = async (tabId) => {
  if (!ext.scripting?.executeScript) return null
  const results = await ext.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: extractDiscordToken,
  })
  return Array.isArray(results) ? (results[0]?.result ?? null) : null
}

const runDiscordFallback = async (tabId) => {
  if (!ext.tabs?.executeScript) return null
  const results = await ext.tabs.executeScript(tabId, {
    code: `(${extractDiscordToken.toString()})()`,
  })
  return Array.isArray(results) ? (results[0] ?? null) : null
}

const grabDiscord = async () => {
  if (!discordTabId || discordBusy) return
  discordBusy = true
  discordCopyEl.disabled = true
  discordGrabEl.disabled = true
  discordValueEl.classList.remove('error')
  discordValueEl.textContent = 'Reading token…'
  let token = null
  try {
    try {
      token = await runDiscordExtraction(discordTabId)
    } catch {
      token = null
    }
    if (!token) {
      try {
        token = await runDiscordFallback(discordTabId)
      } catch {
        token = null
      }
    }
    if (token) {
      discordToken = String(token)
      discordValueEl.textContent = maskToken(discordToken)
      discordCopyEl.disabled = false
    } else {
      discordToken = ''
      discordValueEl.classList.add('error')
      discordValueEl.textContent =
        "Couldn't read token — log in and reload Discord, then Grab again."
    }
  } finally {
    discordBusy = false
    discordGrabEl.disabled = false
  }
}

const detectDiscord = async () => {
  if (!ext.tabs?.query) return
  let tabs = []
  try {
    tabs = await ext.tabs.query({ active: true, currentWindow: true })
  } catch {
    return
  }
  const tab = tabs && tabs[0]
  if (!tab || !isDiscordUrl(tab.url)) {
    discordEl.hidden = true
    return
  }
  discordTabId = tab.id
  discordEl.hidden = false
  await grabDiscord()
}

const grabYtMusic = async () => {
  ytmusicCopyEl.disabled = true
  ytmusicGrabEl.disabled = true
  ytmusicValueEl.classList.remove('error')
  ytmusicValueEl.textContent = 'Reading cookies…'
  try {
    const reply = await ext.runtime.sendMessage({ type: 'GET_YTMUSIC_COOKIE' })
    if (reply && reply.ok && reply.cookie) {
      ytmusicCookies = String(reply.cookie)
      const names = Array.isArray(reply.names) ? reply.names : []
      const count = reply.count || names.length
      const preview = names.slice(0, 3).join(', ')
      let text = `${count} ${count === 1 ? 'cookie' : 'cookies'}${preview ? ` · ${preview}${names.length > 3 ? '…' : ''}` : ''}`
      if (Array.isArray(reply.dropped) && reply.dropped.length) {
        text += ` · skipped ${reply.dropped.length} truncated`
      }
      ytmusicValueEl.textContent = text
      ytmusicCopyEl.disabled = false
    } else {
      ytmusicCookies = ''
      ytmusicValueEl.classList.add('error')
      ytmusicValueEl.textContent =
        'No YouTube Music cookies — open music.youtube.com, sign in, then Grab again.'
    }
  } catch {
    ytmusicCookies = ''
    ytmusicValueEl.classList.add('error')
    ytmusicValueEl.textContent = 'Could not read cookies — reload the extension and try again.'
  } finally {
    ytmusicGrabEl.disabled = false
  }
}

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

const isCf = (c) => c.name === 'cf_clearance'
const normHost = (d) =>
  String(d || '')
    .replace(/^\./, '')
    .toLowerCase()

const hostOf = (url) => {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

const domainMatches = (cookieDomain, host) => {
  const d = normHost(cookieDomain)
  const h = String(host || '').toLowerCase()
  if (!d || !h) return false
  return d === h || d.endsWith(`.${h}`) || h.endsWith(`.${d}`)
}

const showToast = (text, ok = true) => {
  toastTextEl.textContent = text
  toastEl.classList.toggle('error', !ok)
  toastEl.classList.remove('show')
  void toastEl.offsetWidth
  toastEl.classList.add('show')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2000)
}

const writeClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.append(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

const QUERIES = [{ partitionKey: {} }, {}, { firstPartyDomain: null }]

const load = async () => {
  statusEl.textContent = 'Loading…'
  const ids = await storeIds()
  const seen = new Set()
  const all = []
  let errors = 0
  for (const storeId of ids) {
    for (const extra of QUERIES) {
      const opts = { ...extra }
      if (storeId) opts.storeId = storeId
      let batch
      try {
        batch = await ext.cookies.getAll(opts)
      } catch {
        errors++
        continue
      }
      for (const c of batch) {
        const key = `${storeId || ''}|${c.partitionKey?.topLevelSite || ''}|${c.domain}|${c.path}|${c.name}|${c.value}`
        if (seen.has(key)) continue
        seen.add(key)
        all.push(c)
      }
    }
  }
  cookies = all
  render()
  if (!all.length && errors) {
    statusEl.textContent = 'Cookie API unavailable — check extension permissions.'
  }
}

const normalizeServer = (raw) => {
  let s = String(raw || '').trim()
  if (!s) return null
  if (!/^[a-z]+:\/\//i.test(s)) s = `http://${s}`
  try {
    const u = new URL(s)
    return /^https?:$/.test(u.protocol) ? u.origin : null
  } catch {
    return null
  }
}

const readServer = () => {
  try {
    return localStorage.getItem(SERVER_KEY) || DEFAULT_SERVER
  } catch {
    return DEFAULT_SERVER
  }
}

const saveServer = (value) => {
  try {
    localStorage.setItem(SERVER_KEY, value)
  } catch {
    // ignore
  }
}

const fetchProviders = async (origin) => {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 4000)
  try {
    const res = await fetch(`${origin}/api/providers`, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (!Array.isArray(data)) throw new Error('Unexpected response')
    return data
      .flatMap((p) => {
        if (!p || typeof p !== 'object') return []
        const auth = p.auth && typeof p.auth === 'object' ? p.auth : null
        if (!auth && p.tier !== 'cookie') return []
        const type = auth?.type === 'browser_verify' ? 'browser_verify' : 'cookie'
        return [
          {
            id: String(p.id || ''),
            label: String(p.label || p.id || ''),
            type,
            siteUrl: typeof auth?.siteUrl === 'string' ? auth.siteUrl : '',
            cookieName:
              typeof auth?.cookieName === 'string' && auth.cookieName
                ? auth.cookieName
                : 'cf_clearance',
          },
        ]
      })
      .filter((p) => p.id)
  } finally {
    window.clearTimeout(timer)
  }
}

const showNote = (text, url) => {
  noteEl.textContent = ''
  noteEl.hidden = false
  const span = document.createElement('span')
  span.textContent = text
  noteEl.append(span)
  if (url) {
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noreferrer'
    a.textContent = 'Open site'
    noteEl.append(' ', a)
  }
}

const hideNote = () => {
  noteEl.hidden = true
  noteEl.textContent = ''
}

const populateProviders = (list) => {
  providers = list
  activeProvider = null
  providerEl.textContent = ''
  providerEl.append(new Option('All cookies', ''))
  for (const p of list) {
    const suffix = p.type === 'browser_verify' ? 'verify only' : p.cookieName
    providerEl.append(new Option(`${p.label} · ${suffix}`, p.id))
  }
  providerEl.value = ''
}

const connect = async (manual) => {
  const origin = normalizeServer(serverEl.value)
  if (!origin) {
    if (manual) showNote('Enter a server like localhost:3000')
    return
  }
  serverEl.value = origin
  saveServer(origin)
  connectEl.disabled = true
  connectEl.textContent = '…'
  try {
    const list = await fetchProviders(origin)
    populateProviders(list)
    if (!list.length) {
      showNote(`Connected to ${origin} — no providers need a cookie.`)
    } else if (manual) {
      showNote(`Loaded ${list.length} provider${list.length === 1 ? '' : 's'} that need auth.`)
    } else {
      hideNote()
    }
  } catch {
    populateProviders([])
    showNote(`Could not reach ${origin}. Showing all cookies.`)
  } finally {
    connectEl.disabled = false
    connectEl.textContent = 'Go'
  }
}

const updateProvider = () => {
  activeProvider = providers.find((p) => p.id === providerEl.value) || null
  if (!activeProvider) {
    hideNote()
  } else {
    const host = hostOf(activeProvider.siteUrl)
    if (activeProvider.type === 'browser_verify') {
      showNote(
        `${activeProvider.label} only needs a browser verification — no cookie to copy.${
          host ? ` Solve the challenge on ${host}.` : ''
        }`,
        activeProvider.siteUrl
      )
    } else {
      showNote(
        `${activeProvider.label} needs ${activeProvider.cookieName}${host ? ` from ${host}` : ''}.`,
        activeProvider.siteUrl
      )
    }
    searchEl.focus()
  }
  render()
}

const render = () => {
  const q = searchEl.value.trim().toLowerCase()
  let filtered = cookies
  if (activeProvider) {
    const host = hostOf(activeProvider.siteUrl)
    if (host) filtered = filtered.filter((c) => domainMatches(c.domain, host))
  }
  if (q) {
    filtered = filtered.filter((c) => `${c.domain} ${c.name}`.toLowerCase().includes(q))
  }
  const byDomain = new Map()
  for (const c of filtered) {
    if (!byDomain.has(c.domain)) byDomain.set(c.domain, [])
    byDomain.get(c.domain).push(c)
  }
  const domains = [...byDomain.keys()].sort((a, b) => {
    const ac = byDomain.get(a).some(isCf)
    const bc = byDomain.get(b).some(isCf)
    if (ac !== bc) return ac ? -1 : 1
    return a.localeCompare(b)
  })
  listEl.textContent = ''
  if (!domains.length) {
    const p = document.createElement('p')
    p.className = 'empty'
    if (activeProvider?.type === 'browser_verify') {
      p.textContent = 'No cookie needed — verify on the site.'
    } else if (activeProvider) {
      p.textContent = `No ${activeProvider.cookieName} found for ${activeProvider.label}. Open the site and solve the challenge first.`
    } else {
      p.textContent = q ? 'No cookies match.' : 'No cookies found.'
    }
    listEl.append(p)
    statusEl.textContent = '0 cookies'
    return
  }
  const frag = document.createDocumentFragment()
  for (const domain of domains) {
    const section = document.createElement('section')
    const h = document.createElement('h2')
    h.textContent = domain.replace(/^\./, '')
    section.append(h)
    for (const c of byDomain.get(domain)) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'cookie'
      btn.title = `${c.name}=${c.value}`
      btn.setAttribute('aria-label', `Copy ${c.name} for ${domain}`)

      const head = document.createElement('span')
      head.className = 'cookie-head'
      const name = document.createElement('strong')
      name.textContent = c.name
      const icon = document.createElement('span')
      icon.className = 'icon'
      icon.replaceChildren(COPY_ICON.cloneNode(true))
      head.append(name, icon)

      const value = document.createElement('span')
      value.className = 'value'
      value.textContent = c.value.length > 80 ? `${c.value.slice(0, 80)}…` : c.value

      btn.append(head, value)

      let copiedTimer
      btn.addEventListener('click', async () => {
        const ok = await writeClipboard(c.value)
        if (!ok) {
          showToast('Copy failed — open the cookie manually', false)
          return
        }
        btn.classList.remove('copied')
        void btn.offsetWidth
        btn.classList.add('copied')
        icon.replaceChildren(CHECK_ICON.cloneNode(true))
        showToast(`${c.name} copied`)
        window.clearTimeout(copiedTimer)
        copiedTimer = window.setTimeout(() => {
          btn.classList.remove('copied')
          icon.replaceChildren(COPY_ICON.cloneNode(true))
        }, 1800)
      })

      section.append(btn)
    }
    frag.append(section)
  }
  listEl.append(frag)
  statusEl.textContent =
    filtered.length === cookies.length
      ? `${cookies.length} cookies — tap one to copy`
      : `${filtered.length} of ${cookies.length} cookies`
}

serverEl.value = readServer()
serverEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connect(true)
})
connectEl.addEventListener('click', () => connect(true))
providerEl.addEventListener('change', updateProvider)
discordGrabEl.addEventListener('click', grabDiscord)
discordCopyEl.addEventListener('click', async () => {
  if (!discordToken) return
  const ok = await writeClipboard(discordToken)
  if (!ok) {
    showToast('Copy failed — select the token manually', false)
    return
  }
  discordCopyEl.textContent = 'Copied'
  discordCopyEl.classList.add('copied')
  showToast('Discord token copied')
  window.setTimeout(() => {
    discordCopyEl.textContent = 'Copy'
    discordCopyEl.classList.remove('copied')
  }, 1600)
})
ytmusicGrabEl.addEventListener('click', grabYtMusic)
ytmusicCopyEl.addEventListener('click', async () => {
  if (!ytmusicCookies) return
  const ok = await writeClipboard(ytmusicCookies)
  if (!ok) {
    showToast('Copy failed — select the cookies manually', false)
    return
  }
  ytmusicCopyEl.textContent = 'Copied'
  ytmusicCopyEl.classList.add('copied')
  showToast('YouTube Music cookies copied')
  window.setTimeout(() => {
    ytmusicCopyEl.textContent = 'Copy'
    ytmusicCopyEl.classList.remove('copied')
  }, 1600)
})
searchEl.addEventListener('input', render)
refreshEl.addEventListener('click', () => {
  load()
  connect(false)
  detectDiscord()
  grabYtMusic()
})
load()
connect(false)
detectDiscord()
grabYtMusic()
