// dango-google-auth worker - holds GOOGLE_CLIENT_SECRET so users need zero setup
// Dashboard manual deploy: paste this file, set Variables + Secrets, Deploy.
//   Variables: GOOGLE_CLIENT_ID = xxx.apps.googleusercontent.com
//   Secrets:   GOOGLE_CLIENT_SECRET = GOCSPX-xxx
// Endpoints: GET /health, GET /auth-url?redirect_uri=..., POST /exchange, POST /refresh

const FALLBACK_SCOPES =
  'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email'

function corsHeaders(req) {
  const origin = req.headers.get('Origin') || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function isAllowedRedirect(uri) {
  if (!uri) return false
  try {
    const u = new URL(uri)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    // Allow localhost for dango desktop/server + dev vite. Allow worker itself if needed.
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')
      return true
    return false
  } catch {
    return false
  }
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

    // Health - never leaks secret
    if (url.pathname === '/health' && req.method === 'GET') {
      return json({
        ok: true,
        hasClientId: !!env.GOOGLE_CLIENT_ID,
        hasSecret: !!env.GOOGLE_CLIENT_SECRET,
        secretPrefix: env.GOOGLE_CLIENT_SECRET?.slice(0, 4) || 'none',
      })
    }

    // Auth URL - uses bundled client_id, no secret needed
    if (url.pathname === '/auth-url' && req.method === 'GET') {
      const redirect_uri =
        url.searchParams.get('redirect_uri') || 'http://localhost:3000/api/auth/google/callback'
      if (!isAllowedRedirect(redirect_uri)) {
        return json({ error: 'redirect_uri not allowed' }, 400)
      }
      if (!env.GOOGLE_CLIENT_ID) {
        return json({ error: 'worker missing GOOGLE_CLIENT_ID' }, 500)
      }
      const authUrl =
        `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(env.GOOGLE_CLIENT_ID)}` +
        `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
        `&response_type=code&access_type=offline&prompt=consent&scope=${encodeURIComponent(FALLBACK_SCOPES)}`
      return json({ url: authUrl })
    }

    // Exchange code -> tokens (secret stays in worker)
    if (url.pathname === '/exchange' && req.method === 'POST') {
      let body
      try {
        body = await req.json()
      } catch {
        return json({ error: 'invalid json' }, 400)
      }
      const { code, redirect_uri } = body || {}
      if (!code || !redirect_uri) {
        return json({ error: 'code and redirect_uri required' }, 400)
      }
      if (!isAllowedRedirect(redirect_uri)) {
        return json({ error: 'redirect_uri not allowed' }, 400)
      }
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
        return json({ error: 'worker credentials not configured' }, 500)
      }
      const params = new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri,
        grant_type: 'authorization_code',
      })
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        return json({ error: 'exchange failed', details: data.error || data }, r.status)
      }
      // Return tokens to dango server (it stores them in google_tokens.json locally).
      // Worker stores nothing.
      return json(data)
    }

    // Refresh access token (secret stays in worker)
    if (url.pathname === '/refresh' && req.method === 'POST') {
      let body
      try {
        body = await req.json()
      } catch {
        return json({ error: 'invalid json' }, 400)
      }
      const { refresh_token } = body || {}
      if (!refresh_token) {
        return json({ error: 'refresh_token required' }, 400)
      }
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
        return json({ error: 'worker credentials not configured' }, 500)
      }
      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token,
        grant_type: 'refresh_token',
      })
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        return json({ error: 'refresh failed', details: data.error || data }, r.status)
      }
      return json(data)
    }

    return json({ error: 'not found' }, 404)
  },
}
