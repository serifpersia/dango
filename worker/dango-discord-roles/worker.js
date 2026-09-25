function corsHeaders(req) {
  const origin = req.headers.get('Origin') || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  }
}

function calculateRank(totalHours) {
  if (totalHours >= 400) return 'S-Rank'
  if (totalHours >= 200) return 'A-Rank'
  if (totalHours >= 100) return 'B-Rank'
  if (totalHours >= 50) return 'C-Rank'
  if (totalHours >= 20) return 'D-Rank'
  if (totalHours >= 5) return 'E-Rank'
  return 'F-Rank'
}

const GENRE_DERE_MAP = {
  fantasy: 'Kamidere',
  action: 'Kamidere',
  isekai: 'Kamidere',
  magic: 'Kamidere',
  'super power': 'Megadere',
  adventure: 'Himedere',
  'martial arts': 'Himedere',
  family: 'Himedere',
  comedy: 'Bakadere',
  shounen: 'Bakadere',
  parody: 'Bakadere',
  sports: 'Undere',
  music: 'Deredere',
  romance: 'Deredere',
  ecchi: 'Deredere',
  harem: 'Deredere',
  drama: 'Dandere',
  'slice of life': 'Dandere',
  yuri: 'Dandere',
  'school life': 'Dandere',
  'high school': 'Tsundere',
  school: 'Tsundere',
  military: 'Tsundere',
  shoujo: 'Tsundere',
  seinen: 'Kuudere',
  'sci-fi': 'Kuudere',
  'science fiction': 'Kuudere',
  mystery: 'Kuudere',
  mecha: 'Kuudere',
  josei: 'Kuudere',
  psychological: 'Yandere',
  horror: 'Yandere',
  thriller: 'Sadodere',
  supernatural: 'Dorodere',
  demons: 'Dorodere',
  game: 'Oujidere',
  historical: 'Kanedere',
}

function getDereForGenre(genre) {
  return GENRE_DERE_MAP[(genre || '').toLowerCase().trim()] || null
}

function getAllDereTypes(genres) {
  if (!genres || !Array.isArray(genres)) return []
  const dereSet = new Set()
  for (const g of genres) {
    const dere = getDereForGenre(g)
    if (dere) dereSet.add(dere)
  }
  return [...dereSet]
}

const DISCORD_HEADERS = (token) => ({
  Authorization: `Bot ${token}`,
  'User-Agent': 'DiscordBot (https://github.com/serifpersia/dango, 1.0.0)',
  'Content-Type': 'application/json',
})

function hexToBytes(hex) {
  if (!hex || hex.length % 2 !== 0) throw new Error('Invalid hex string')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

async function verifyDiscordSignature(publicKeyHex, signatureHex, timestamp, body) {
  const key = await crypto.subtle.importKey(
    'raw',
    hexToBytes(publicKeyHex),
    { name: 'Ed25519' },
    false,
    ['verify']
  )
  return crypto.subtle.verify(
    { name: 'Ed25519' },
    key,
    hexToBytes(signatureHex),
    new TextEncoder().encode(timestamp + body)
  )
}

const RANK_COLORS = {
  'S-Rank': 0xffd700,
  'A-Rank': 0xa78bfa,
  'B-Rank': 0x60a5fa,
  'C-Rank': 0x34d399,
  'D-Rank': 0xfbbf24,
  'E-Rank': 0x9ca3af,
  'F-Rank': 0x6b7280,
}

let guildRolesCache = { at: 0, byId: {} }
const GUILD_ROLES_TTL_MS = 10 * 60 * 1000

async function getGuildRoleColor(env, roleId) {
  if (!roleId || !env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) return 0
  const now = Date.now()
  if (now - guildRolesCache.at > GUILD_ROLES_TTL_MS) {
    try {
      const res = await fetch(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/roles`, {
        headers: DISCORD_HEADERS(env.DISCORD_BOT_TOKEN),
      })
      if (res.ok) {
        const roles = await res.json().catch(() => [])
        const byId = {}
        for (const r of roles || []) byId[r.id] = r.color || 0
        guildRolesCache = { at: now, byId }
      }
    } catch {
      // ignore
    }
  }
  return guildRolesCache.byId[roleId] || 0
}

async function getRankColor(env, rank) {
  const roleId = env[`ROLE_${String(rank || '').replace('-', '_').toUpperCase()}`]
  const live = await getGuildRoleColor(env, roleId)
  if (live) return live
  return RANK_COLORS[rank] ?? 0x897cff
}

function parseStoredGenres(stored) {
  if (!stored) return []
  try {
    if (stored.startsWith('[')) {
      const arr = JSON.parse(stored)
      return Array.isArray(arr) ? arr.map(String) : []
    }
  } catch {
    // ignore
  }
  return String(stored)
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
}

function buildProfileEmbed(row, color) {
  const totalHours = Math.round((row.total_seconds || 0) / 3600)
  const dereList = String(row.current_dere || '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean)
    .slice(0, 3)
  const genres = parseStoredGenres(row.genres)
  const episodes = row.total_episodes ?? null
  const anime = row.total_anime ?? null
  const completed = row.completed_count ?? null
  const rate = row.completion_rate ?? null
  const hasCounts = (episodes || 0) > 0 || (anime || 0) > 0 || (completed || 0) > 0
  const fields = [
    { name: 'Watch time', value: `${totalHours}h`, inline: true },
  ]
  if (hasCounts) {
    fields.push({ name: 'Episodes', value: `${episodes}`, inline: true })
    fields.push({ name: 'Anime', value: `${anime}`, inline: true })
    fields.push({
      name: 'Completed',
      value: rate ? `${completed} (${rate}%)` : `${completed}`,
      inline: true,
    })
  }
  fields.push({ name: 'Top genre', value: row.top_genre || '—', inline: true })
  fields.push({
    name: 'Top genres',
    value: genres.length > 0 ? genres.join(', ') : '—',
    inline: false,
  })
  let syncLabel = 'Dango profile'
  try {
    if (row.updated_at) {
      const d = new Date(String(row.updated_at).replace(' ', 'T') + 'Z')
      syncLabel = `Dango • last sync ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
    }
  } catch {
    // ignore
  }
  return {
    title: `${row.username || 'Dango user'} — ${row.current_rank || 'F-Rank'}`,
    description:
      dereList.length > 0 ? dereList.map((d) => `**${d}**`).join(' · ') : 'No dere yet — sync to earn one',
    color: color ?? RANK_COLORS[row.current_rank] ?? 0x897cff,
    fields,
    footer: { text: syncLabel },
    timestamp: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  }
}

async function handleProfileCommand(env, origin, interaction) {
  const options = interaction?.data?.options || []
  const userOption = options.find((o) => o.name === 'user')
  const invoker = interaction?.member?.user ?? interaction?.user
  const targetId = (userOption && String(userOption.value)) || (invoker && invoker.id) || null
  if (!targetId) {
    return {
      type: 4,
      data: { content: 'Could not determine which user to look up.', flags: 64 },
    }
  }

  let row = null
  if (env.DB) {
    row = await env.DB.prepare(
      'SELECT discord_id, username, total_seconds, total_episodes, total_anime, completed_count, completion_rate, current_rank, current_dere, genres, top_genre, updated_at FROM members WHERE discord_id = ?'
    )
      .bind(targetId)
      .first()
      .catch(async () => {
        return env.DB.prepare(
          'SELECT discord_id, username, total_seconds, current_rank, current_dere, genres, top_genre, updated_at FROM members WHERE discord_id = ?'
        )
          .bind(targetId)
          .first()
          .catch(() => null)
      })
  }

  if (!row) {
    const loginUrl = `${origin}/auth/login`
    return {
      type: 4,
      data: {
        content: `<@${targetId}> has no linked Dango data yet. Link in Dango Settings → Community, or start here: ${loginUrl}`,
        allowed_mentions: { parse: [] },
        flags: 64,
      },
    }
  }

  const color = await getRankColor(env, row.current_rank)

  return {
    type: 4,
    data: {
      content: `<@${targetId}>`,
      embeds: [buildProfileEmbed(row, color)],
      allowed_mentions: { parse: [] },
    },
  }
}

const ANILIST_API = 'https://graphql.anilist.co'
const REC_FIELDS = `id title { romaji english } coverImage { large } averageScore popularity episodes seasonYear format genres isAdult status`

function tasteWeights(taste) {
  const comp = (taste && taste.genreComp) || {}
  const drop = (taste && taste.genreDrop) || {}
  const max = Math.max(1, ...Object.values(comp))
  const W = {}
  for (const [g, c] of Object.entries(comp)) {
    const d = drop[g] || 0
    W[g] = (c / max) * (c / (c + d))
  }
  return W
}

function recCombos(W) {
  const top = Object.entries(W)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([g]) => g)
  while (top.length < 2) top.push('Fantasy')
  const pairs = [
    [top[0], top[1]],
    [top[0], top[2] || top[1]],
    [top[1], top[2] || top[0]],
    [top[0], top[3] || top[1]],
  ]
  const seen = new Set()
  return pairs.filter((p) => {
    const key = [...p].sort().join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function anilistQuery(query, variables) {
  const res = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`AniList ${res.status}`)
  return res.json()
}

function exemplarsForCandidate(taste, candidateGenres, n = 2) {
  const ex = (taste && taste.exemplars) || {}
  const votes = new Map()
  for (const g of candidateGenres) {
    for (const t of ex[g] || []) votes.set(t, (votes.get(t) || 0) + 1)
  }
  return [...votes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t)
}

function buildRecEmbed(pick, color) {
  const lines = []
  const meta = [pick.year, pick.format, pick.episodes ? `${pick.episodes}ep` : null, pick.averageScore ? `score ${pick.averageScore}` : null]
    .filter(Boolean)
    .join(' · ')
  if (meta) lines.push(meta)
  const why = [`Shares ${(pick.sharedGenres || []).join(', ')}`]
  if (pick.exemplars && pick.exemplars.length > 0) why.push(`like ${pick.exemplars.join(', ')}`)
  lines.push(why.join(' — '))
  if (pick.kind === 'continue') lines.push('Continue — you watched the earlier part.')
  if (pick.kind === 'sequel' && pick.prequelTitle) lines.push(`Sequel — start with "${pick.prequelTitle}" first.`)
  return {
    title: `${pick.title} — ${pick.matchPct}% match`,
    url: pick.url,
    color,
    thumbnail: pick.cover ? { url: pick.cover } : undefined,
    description: lines.join('\n'),
  }
}

function pickStoredCandidates(taste, knownIds, recent, count) {
  const pool = (Array.isArray(taste.candidates) ? taste.candidates : [])
    .filter((c) => c && !knownIds.has(c.id) && !recent.has(c.id))
    .sort((a, b) => (b.matchPct || 0) - (a.matchPct || 0))
  if (pool.length === 0) return []
  const picks = [pool[0]]
  if (count > 1) {
    const rest = pool.slice(1, 8)
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[rest[i], rest[j]] = [rest[j], rest[i]]
    }
    picks.push(...rest.slice(0, count - 1))
  }
  return picks
}

async function finishRecommend(env, row, targetId, results, sender) {
  if (env.DB) {
    try {
      const stmts = results.map((r) =>
        env.DB.prepare(
          `INSERT INTO rec_log (discord_id, anilist_id, recommended_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(discord_id, anilist_id) DO UPDATE SET recommended_at = CURRENT_TIMESTAMP`
        ).bind(targetId, r.id)
      )
      await env.DB.batch(stmts)
    } catch {
      // ignore
    }
  }

  const color = await getRankColor(env, row.current_rank)
  await sender({
    content: `Dango recommends for <@${targetId}>:`,
    embeds: results.map((r) => buildRecEmbed(r, color)),
    allowed_mentions: { parse: [] },
  })
}

async function runRecommendAndFollowup(env, interaction, row, targetId, count, sender) {
  const fail = async (msg) => {
    await sender({ content: msg, flags: 64 })
  }
  try {
    const taste = JSON.parse(row.taste || '{}')
    const knownIds = new Set(taste.knownIds || [])
    if (knownIds.size === 0) {
      await fail('No watch history synced yet. Sync roles in Dango Settings → Community first, then try again.')
      return
    }
    const W = tasteWeights(taste)
    const DEFAULT_W = 0.15
    const wsum = Object.values(W).reduce((a, b) => a + b, 0) || 1

    let recent = new Set()
    if (env.DB) {
      try {
        const rows = await env.DB.prepare(
          "SELECT anilist_id FROM rec_log WHERE discord_id = ? AND recommended_at > datetime('now', '-30 days')"
        )
          .bind(targetId)
          .all()
        recent = new Set((rows?.results || []).map((r) => r.anilist_id))
      } catch {
        // ignore
      }
    }

    const stored = pickStoredCandidates(taste, knownIds, recent, count)
    if (stored.length > 0) {
      await finishRecommend(env, row, targetId, stored, sender)
      return
    }

    const seen = new Map()
    const comboErrors = []
    for (const combo of recCombos(W)) {
      try {
        const data = await anilistQuery(
          `query ($g: [String]) { Page(page: 1, perPage: 20) { media(genre_in: $g, type: ANIME, status: FINISHED, isAdult: false, averageScore_greater: 68, sort: SCORE_DESC) { ${REC_FIELDS} } } }`,
          { g: combo }
        )
        for (const m of data?.data?.Page?.media || []) {
          if (!seen.has(m.id)) seen.set(m.id, m)
        }
      } catch (err) {
        comboErrors.push(String(err?.message || err).slice(0, 120))
      }
    }
    if (seen.size === 0) {
      await fail(`AniList unreachable right now (${comboErrors[0] || 'unknown error'}). Try again in a bit.`)
      return
    }

    const scored = []
    for (const m of seen.values()) {
      if (knownIds.has(m.id) || recent.has(m.id) || m.isAdult) continue
      if (m.format === 'MUSIC' || m.format === 'SPECIAL') continue
      const gs = m.genres || []
      const fit = gs.reduce((a, g) => a + (W[g] ?? DEFAULT_W), 0) / wsum
      const score =
        0.65 * fit +
        0.25 * ((m.averageScore || 70) / 100) +
        0.1 * Math.min(1, (m.popularity || 0) / 200000)
      scored.push({ m, score, fit, overlap: gs.filter((g) => (W[g] ?? 0) > 0.3) })
    }
    scored.sort((a, b) => b.score - a.score)
    if (scored.length === 0) {
      await fail('Everything good is already in your library (or was recommended recently). Sync again after watching more.')
      return
    }

    const top = scored.slice(0, 15)
    const relMap = new Map()
    try {
      const data = await anilistQuery(
        `query ($ids: [Int]) { Page(page: 1, perPage: 50) { media(id_in: $ids, type: ANIME) { id relations { edges { relationType node { id title { romaji english } type } } } } } }`,
        { ids: top.map((t) => t.m.id) }
      )
      for (const m of data?.data?.Page?.media || []) relMap.set(m.id, m)
    } catch {
      // ignore
    }

    const ranked = top.map((t) => {
      const rel = relMap.get(t.m.id)
      const pre = rel
        ? (rel.relations.edges || []).find((e) => e.relationType === 'PREQUEL' && e.node.type === 'ANIME')
        : null
      let adj = t.score
      let kind = 'entry'
      let prequelTitle = null
      if (pre && !knownIds.has(pre.node.id)) {
        kind = 'sequel'
        prequelTitle = pre.node.title.english || pre.node.title.romaji
        adj -= 0.3
      } else if (pre) {
        kind = 'continue'
        adj += 0.05
      }
      return { ...t, adj, kind, prequelTitle }
    })
    ranked.sort((a, b) => b.adj - a.adj)

    const picks = [ranked[0]]
    if (count > 1) {
      const rest = ranked.slice(1, 8)
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[rest[i], rest[j]] = [rest[j], rest[i]]
      }
      picks.push(...rest.slice(0, count - 1))
    }

    const results = picks.map((p) => {
      const title = p.m.title.english || p.m.title.romaji
      return {
        id: p.m.id,
        title,
        url: `https://anilist.co/anime/${p.m.id}`,
        cover: p.m.coverImage?.large || null,
        year: p.m.seasonYear || null,
        format: p.m.format,
        episodes: p.m.episodes || null,
        averageScore: p.m.averageScore || null,
        matchPct: Math.round(p.adj * 100),
        sharedGenres: p.overlap,
        exemplars: exemplarsForCandidate(taste, p.m.genres || []),
        kind: p.kind,
        prequelTitle: p.prequelTitle,
      }
    })

    await finishRecommend(env, row, targetId, results, sender)
  } catch (err) {
    await fail(`Recommendation engine hiccup: ${String(err?.message || err).slice(0, 200)}`)
  }
}

async function sendInteractionFollowup(env, interaction, payload) {
  const res = await fetch(
    `https://discord.com/api/v10/webhooks/${env.DISCORD_CLIENT_ID}/${interaction.token}/messages/@original`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Followup ${res.status}: ${text.slice(0, 200)}`)
  }
}

async function handleRecommendCommand(env, interaction, execCtx, sender) {
  const options = interaction?.data?.options || []
  const countOption = options.find((o) => o.name === 'count')
  const invoker = interaction?.member?.user ?? interaction?.user
  const targetId = (invoker && invoker.id) || null
  const count = Math.min(5, Math.max(1, Number(countOption?.value) || 1))
  if (!targetId) {
    return { type: 4, data: { content: 'Could not determine which user to recommend for.', flags: 64 } }
  }

  let row = null
  if (env.DB) {
    try {
      row = await env.DB.prepare(
        'SELECT discord_id, current_rank, taste FROM members WHERE discord_id = ?'
      )
        .bind(targetId)
        .first()
    } catch {
      row = null
    }
  }
  if (!row || !row.taste) {
    return {
      type: 4,
      data: {
        content: `<@${targetId}> has no taste profile yet. Sync roles in Dango Settings → Community first, then try /recommend again.`,
        allowed_mentions: { parse: [] },
        flags: 64,
      },
    }
  }

  const send = sender || ((payload) => sendInteractionFollowup(env, interaction, payload))
  const work = runRecommendAndFollowup(env, interaction, row, targetId, count, send)
  if (execCtx && execCtx.waitUntil) execCtx.waitUntil(work)
  else await work
  return { type: 5 }
}

async function getMemberRolesDetailed(env, userId) {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID)
    return {
      ok: false,
      roles: [],
      status: 0,
      error: 'Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID',
    }
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`,
    { headers: DISCORD_HEADERS(env.DISCORD_BOT_TOKEN) }
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, roles: [], status: res.status, error: text.slice(0, 500) }
  }
  const data = await res.json().catch(() => ({}))
  return { ok: true, roles: data.roles || [], status: 200, error: null }
}

async function getMemberRoles(env, userId) {
  const result = await getMemberRolesDetailed(env, userId)
  return result.roles
}

async function addDiscordRole(env, userId, roleId) {
  if (!roleId || !env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID)
    return { ok: false, status: 0, error: 'Missing config' }
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`,
    {
      method: 'PUT',
      headers: DISCORD_HEADERS(env.DISCORD_BOT_TOKEN),
    }
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, status: res.status, error: text.slice(0, 500) }
  }
  return { ok: true, status: res.status, error: null }
}

async function removeDiscordRole(env, userId, roleId) {
  if (!roleId || !env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID)
    return { ok: false, status: 0, error: 'Missing config' }
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`,
    {
      method: 'DELETE',
      headers: DISCORD_HEADERS(env.DISCORD_BOT_TOKEN),
    }
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, status: res.status, error: text.slice(0, 500) }
  }
  return { ok: true, status: res.status, error: null }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url)
    const cors = corsHeaders(req)

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })

    if (url.pathname === '/auth/login' && req.method === 'GET') {
      const redirectUri = `${url.origin}/auth/callback`
      const returnTo = url.searchParams.get('return_to') || ''
      let authUrl = `https://discord.com/oauth2/authorize?client_id=${env.DISCORD_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&scope=identify`
      if (returnTo) {
        authUrl += `&state=${encodeURIComponent(returnTo)}`
      }
      return Response.redirect(authUrl, 302)
    }

    if (url.pathname === '/auth/callback' && req.method === 'GET') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (!code) return new Response('Missing code parameter', { status: 400 })

      try {
        const redirectUri = `${url.origin}/auth/callback`
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: env.DISCORD_CLIENT_ID,
            client_secret: env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
          }),
        })

        const tokenData = await tokenRes.json()
        if (!tokenRes.ok) throw new Error(tokenData.error_description || JSON.stringify(tokenData))

        const userRes = await fetch('https://discord.com/api/users/@me', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        })
        const userData = await userRes.json()

        if (env.DB) {
          await env.DB.prepare(
            `INSERT INTO members (discord_id, username, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(discord_id) DO UPDATE SET username = excluded.username, updated_at = CURRENT_TIMESTAMP`
          )
            .bind(userData.id, userData.username)
            .run()
        }

        const userObj = { id: userData.id, username: userData.username, avatar: userData.avatar }
        const sessionPayload = JSON.stringify(userObj)
        const cookie = `dango_session=${encodeURIComponent(sessionPayload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`

        let targetUrl = '/'
        if (state) {
          try {
            const decoded = decodeURIComponent(state)
            const target = new URL(decoded)
            target.searchParams.set('discord_user', sessionPayload)
            targetUrl = target.toString()
          } catch {
            targetUrl = decodeURIComponent(state)
          }
        }

        return new Response(null, {
          status: 302,
          headers: {
            Location: targetUrl,
            'Set-Cookie': cookie,
          },
        })
      } catch (err) {
        return new Response(`OAuth Error: ${err.message}`, { status: 500 })
      }
    }

    if (url.pathname === '/api/user' && req.method === 'GET') {
      let user = null

      const authHeader = req.headers.get('Authorization') || ''
      if (authHeader.startsWith('Bearer ')) {
        try {
          user = JSON.parse(decodeURIComponent(authHeader.slice(7)))
        } catch {
          // ignore
        }
      }

      if (!user) {
        const cookieHeader = req.headers.get('Cookie') || ''
        const match = cookieHeader.match(/dango_session=([^;]+)/)
        if (match) {
          try {
            user = JSON.parse(decodeURIComponent(match[1]))
          } catch {
            // ignore
          }
        }
      }

      if (!user) return json({ user: null })

      try {
        let stats = null
        if (env.DB) {
          const row = await env.DB.prepare('SELECT * FROM members WHERE discord_id = ?')
            .bind(user.id)
            .first()
          stats = row || null
        }
        return json({ user, stats })
      } catch {
        return json({ user, stats: null })
      }
    }

    if (url.pathname === '/api/sync' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      const {
        discordId,
        username,
        totalSeconds,
        genres,
        topGenre,
        totalEpisodes,
        totalAnime,
        completedCount,
        completionRate,
        taste,
      } = body

      if (!discordId) return json({ error: 'Missing discordId' }, 400)

      const totalHours = Math.round((totalSeconds || 0) / 3600)
      const targetRank = calculateRank(totalHours)
      const genreList = Array.isArray(genres) ? genres.slice(0, 3) : topGenre ? [topGenre] : []
      const targetDereTypes = getAllDereTypes(genreList)

      let prevRank = null
      let prevDere = null
      let prevGenres = null
      if (env.DB) {
        const existing = await env.DB.prepare(
          'SELECT current_rank, current_dere, genres FROM members WHERE discord_id = ?'
        )
          .bind(discordId)
          .first()
        if (existing) {
          prevRank = existing.current_rank
          prevDere = existing.current_dere
          prevGenres = existing.genres
        }

        const tasteJson = taste ? JSON.stringify(taste).slice(0, 64000) : null
        const hasV2 = body && ('totalEpisodes' in body || 'totalAnime' in body || 'completedCount' in body)
        const hasTaste = !!tasteJson

        const fullUpsert = () =>
          env.DB.prepare(
            `INSERT INTO members (discord_id, username, total_seconds, total_episodes, total_anime, completed_count, completion_rate, current_rank, current_dere, genres, top_genre, taste, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(discord_id) DO UPDATE SET
               username = excluded.username,
               total_seconds = excluded.total_seconds,
               total_episodes = excluded.total_episodes,
               total_anime = excluded.total_anime,
               completed_count = excluded.completed_count,
               completion_rate = excluded.completion_rate,
               current_rank = excluded.current_rank,
               current_dere = excluded.current_dere,
               genres = excluded.genres,
               top_genre = excluded.top_genre,
               taste = COALESCE(excluded.taste, members.taste),
               updated_at = CURRENT_TIMESTAMP`
          )
            .bind(
              discordId,
              username || 'Unknown',
              totalSeconds || 0,
              totalEpisodes || 0,
              totalAnime || 0,
              completedCount || 0,
              completionRate || 0,
              targetRank,
              targetDereTypes.join(','),
              JSON.stringify(genreList),
              topGenre || '',
              tasteJson
            )
            .run()

        const legacyUpsert = () =>
          env.DB.prepare(
            `INSERT INTO members (discord_id, username, total_seconds, current_rank, current_dere, genres, top_genre, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(discord_id) DO UPDATE SET
               username = excluded.username,
               total_seconds = excluded.total_seconds,
               current_rank = excluded.current_rank,
               current_dere = excluded.current_dere,
               genres = excluded.genres,
               top_genre = excluded.top_genre,
               updated_at = CURRENT_TIMESTAMP`
          )
            .bind(
              discordId,
              username || 'Unknown',
              totalSeconds || 0,
              targetRank,
              targetDereTypes.join(','),
              JSON.stringify(genreList),
              topGenre || ''
            )
            .run()

        if (!hasV2 && !hasTaste) {
          await legacyUpsert()
        } else {
          try {
            await fullUpsert()
          } catch (err) {
            const msg = String(err?.message || err)
            if (!msg.includes('no such column')) throw err
            try {
              await env.DB.prepare('ALTER TABLE members ADD COLUMN taste TEXT').run()
              await fullUpsert()
            } catch {
              await legacyUpsert()
            }
          }
        }
      }

      const dereChanged = JSON.stringify(prevGenres) !== JSON.stringify(genreList)
      if (!body.force && prevRank === targetRank && !dereChanged) {
        return json({
          success: true,
          rank: targetRank,
          dere: targetDereTypes,
          unchanged: true,
          message: `Stats updated. [${targetRank}] + [${targetDereTypes.join(', ')}] are already active.`,
        })
      }

      const rankKey = `ROLE_${targetRank.replace('-', '_').toUpperCase()}`
      const targetRankRoleId = env[rankKey]

      const dereKeyMap = {}
      for (const d of targetDereTypes) {
        dereKeyMap[d] = env[`ROLE_${d.toUpperCase()}`]
      }

      const allRankRoleIds = [
        env.ROLE_S_RANK,
        env.ROLE_A_RANK,
        env.ROLE_B_RANK,
        env.ROLE_C_RANK,
        env.ROLE_D_RANK,
        env.ROLE_E_RANK,
        env.ROLE_F_RANK,
      ].filter(Boolean)

      const allDereRoleIds = Object.values(dereKeyMap).filter(Boolean)

      const member = await getMemberRolesDetailed(env, discordId)
      if (!member.ok) {
        if (member.status === 404) {
          return json(
            {
              success: false,
              error:
                'User is not a member of the Discord server. Ask them to join the server first, then Sync Roles again.',
              code: 'NOT_MEMBER',
              status: 404,
              detail: member.error,
            },
            404
          )
        }
        if (member.status === 401 || member.status === 403) {
          return json(
            {
              success: false,
              error:
                'Bot cannot read server members (401/403). Check bot is in the guild, has Manage Roles, and Server Members Intent if required.',
              code: 'BOT_FORBIDDEN',
              status: member.status,
              detail: member.error,
            },
            502
          )
        }
        return json(
          {
            success: false,
            error: `Could not fetch Discord member (status ${member.status || 'unknown'}).`,
            code: 'MEMBER_FETCH_FAILED',
            status: member.status,
            detail: member.error,
          },
          502
        )
      }
      const currentRoles = member.roles

      const failures = []
      const recordFailure = (action, roleId, label, result) => {
        failures.push({ action, roleId, label, status: result.status, error: result.error })
      }

      for (const roleId of allRankRoleIds) {
        if (roleId !== targetRankRoleId && currentRoles.includes(roleId)) {
          const r = await removeDiscordRole(env, discordId, roleId)
          if (!r.ok) recordFailure('remove', roleId, 'rank-cleanup', r)
        }
      }

      if (!targetRankRoleId) {
        return json(
          {
            success: false,
            error: `No role ID configured for ${targetRank} (${rankKey} missing in worker vars).`,
            code: 'MISSING_RANK_CONFIG',
          },
          500
        )
      }
      if (!currentRoles.includes(targetRankRoleId)) {
        const r = await addDiscordRole(env, discordId, targetRankRoleId)
        if (!r.ok) recordFailure('add', targetRankRoleId, targetRank, r)
      }

      const allKnownDereKeys = [
        'Tsundere',
        'Yandere',
        'Kuudere',
        'Dandere',
        'Deredere',
        'Bakadere',
        'Kamidere',
        'Dorodere',
        'Himedere',
        'Sadodere',
        'Undere',
        'Megadere',
        'Oujidere',
        'Kanedere',
      ]
      for (const d of allKnownDereKeys) {
        const roleId = env[`ROLE_${d.toUpperCase()}`]
        if (roleId && !targetDereTypes.includes(d) && currentRoles.includes(roleId)) {
          const r = await removeDiscordRole(env, discordId, roleId)
          if (!r.ok) recordFailure('remove', roleId, d, r)
        }
      }

      for (const d of targetDereTypes) {
        const roleId = dereKeyMap[d]
        if (!roleId) {
          recordFailure('add', null, d, {
            status: 0,
            error: `ROLE_${d.toUpperCase()} not configured`,
          })
          continue
        }
        if (!currentRoles.includes(roleId)) {
          const r = await addDiscordRole(env, discordId, roleId)
          if (!r.ok) recordFailure('add', roleId, d, r)
        }
      }

      if (failures.length > 0) {
        const firstAddFailure = failures.find((f) => f.action === 'add')
        const hint =
          firstAddFailure && (firstAddFailure.status === 403 || firstAddFailure.status === 401)
            ? ' Discord returned 403/401: bot role must sit ABOVE the rank/dere roles and have Manage Roles in Server Settings.'
            : firstAddFailure && firstAddFailure.status === 404
              ? ' Discord returned 404: user left the server or role ID does not exist.'
              : ''
        return json(
          {
            success: false,
            error: `Discord rejected ${failures.length} role update(s).${hint}`,
            code: 'DISCORD_REJECTED',
            rank: targetRank,
            dere: targetDereTypes,
            failures,
          },
          502
        )
      }

      return json({
        success: true,
        rank: targetRank,
        dere: targetDereTypes,
        genres: genreList,
        message: `Assigned [${targetRank}] + [${targetDereTypes.join(', ')}] in Discord!`,
      })
    }

    if (url.pathname === '/interactions' && req.method === 'POST') {
      const signature = req.headers.get('X-Signature-Ed25519') || ''
      const timestamp = req.headers.get('X-Signature-Timestamp') || ''
      const rawBody = await req.text().catch(() => '')

      if (!env.DISCORD_PUBLIC_KEY) {
        return json({ error: 'DISCORD_PUBLIC_KEY not configured' }, 500)
      }

      let verified = false
      try {
        verified = await verifyDiscordSignature(env.DISCORD_PUBLIC_KEY, signature, timestamp, rawBody)
      } catch {
        verified = false
      }
      if (!verified) return new Response('Invalid signature', { status: 401 })

      const interaction = JSON.parse(rawBody || '{}')

      if (interaction.type === 1) {
        return json({ type: 1 })
      }

      if (interaction.type === 2 && interaction?.data?.name === 'profile') {
        const response = await handleProfileCommand(env, url.origin, interaction)
        return json(response)
      }

      if (interaction.type === 2 && interaction?.data?.name === 'recommend') {
        const response = await handleRecommendCommand(env, interaction, ctx)
        return json(response)
      }

      return json({
        type: 4,
        data: { content: 'Unknown command.', flags: 64 },
      })
    }

    if (url.pathname === '/interactions') {
      return json({ error: 'Method Not Allowed' }, 405)
    }

    return json({ error: 'Not Found' }, 404)
  },
}
