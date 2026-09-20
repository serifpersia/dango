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

async function getMemberRoles(env, userId) {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) return []
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`,
    { headers: DISCORD_HEADERS(env.DISCORD_BOT_TOKEN) }
  )
  if (!res.ok) return []
  const data = await res.json().catch(() => ({}))
  return data.roles || []
}

async function addDiscordRole(env, userId, roleId) {
  if (!roleId || !env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID)
    return { ok: false, error: 'Missing config' }
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`,
    {
      method: 'PUT',
      headers: DISCORD_HEADERS(env.DISCORD_BOT_TOKEN),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, status: res.status, error: text }
  }
  return { ok: true }
}

async function removeDiscordRole(env, userId, roleId) {
  if (!roleId || !env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) return { ok: false }
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`,
    {
      method: 'DELETE',
      headers: DISCORD_HEADERS(env.DISCORD_BOT_TOKEN),
    }
  )
  return { ok: res.ok }
}

export default {
  async fetch(req, env) {
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
      const { discordId, username, totalSeconds, genres, topGenre } = body

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

        await env.DB.prepare(
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

      const currentRoles = await getMemberRoles(env, discordId)

      for (const roleId of allRankRoleIds) {
        if (roleId !== targetRankRoleId && currentRoles.includes(roleId)) {
          await removeDiscordRole(env, discordId, roleId)
        }
      }

      if (targetRankRoleId && !currentRoles.includes(targetRankRoleId)) {
        await addDiscordRole(env, discordId, targetRankRoleId)
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
          await removeDiscordRole(env, discordId, roleId)
        }
      }

      for (const d of targetDereTypes) {
        const roleId = dereKeyMap[d]
        if (roleId && !currentRoles.includes(roleId)) {
          await addDiscordRole(env, discordId, roleId)
        }
      }

      return json({
        success: true,
        rank: targetRank,
        dere: targetDereTypes,
        genres: genreList,
        message: `Assigned [${targetRank}] + [${targetDereTypes.join(', ')}] in Discord!`,
      })
    }

    return json({ error: 'Not Found' }, 404)
  },
}
