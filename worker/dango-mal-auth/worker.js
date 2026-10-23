// dango-mal-auth worker - holds MAL_CLIENT_ID + MAL_CLIENT_SECRET so users need no setup.
// Deploy with wrangler: npx wrangler deploy
//   Secrets: MAL_CLIENT_ID, MAL_CLIENT_SECRET, STATE_SECRET (random string)
// Register https://<worker-host>/callback as a redirect URL on the MAL app.
// Endpoints: GET /health, GET /auth-url, GET /callback, POST /exchange, POST /refresh

const MAL_AUTHORIZE = 'https://myanimelist.net/v1/oauth2/authorize'
const MAL_TOKEN = 'https://myanimelist.net/v1/oauth2/token'
const RETURN_PATH = '/api/tracker/mal/callback'
const STATE_TTL = 10 * 60 * 1000

function corsHeaders(req) {
  const origin = req.headers.get('Origin') || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

// The code is bound to the PKCE verifier dango keeps locally, so a forged
// return target cannot complete an exchange. Still refuse non-callback paths.
function readReturnTo(uri) {
  try {
    const u = new URL(uri)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (u.username || u.password || u.hash) return null
    if (u.pathname !== RETURN_PATH) return null
    return u
  } catch {
    return null
  }
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function unb64url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)), (c) =>
    c.charCodeAt(0)
  )
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function stateKey(env) {
  const secret = env.STATE_SECRET || env.MAL_CLIENT_SECRET
  if (!secret) return null
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

async function signState(env, payload) {
  const key = await stateKey(env)
  if (!key) return null
  const body = b64url(encoder.encode(JSON.stringify(payload)))
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  return `${body}.${b64url(signature)}`
}

async function verifyState(env, token) {
  const key = await stateKey(env)
  if (!key || !token) return null
  const [body, signature] = token.split('.')
  if (!body || !signature) return null
  try {
    const ok = await crypto.subtle.verify('HMAC', key, unb64url(signature), encoder.encode(body))
    if (!ok) return null
    const payload = JSON.parse(decoder.decode(unb64url(body)))
    if (!payload?.s || !payload?.r || !(payload.e > Date.now())) return null
    return payload
  } catch {
    return null
  }
}

async function malToken(env, params) {
  const response = await fetch(MAL_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.MAL_CLIENT_ID,
      client_secret: env.MAL_CLIENT_SECRET,
      ...params,
    }).toString(),
  })
  const data = await response.json().catch(() => ({}))
  return { response, data }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const cors = corsHeaders(req)

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })

    // Health - never leaks the secret
    if (url.pathname === '/health' && req.method === 'GET') {
      return json({
        ok: true,
        hasClientId: !!env.MAL_CLIENT_ID,
        hasSecret: !!env.MAL_CLIENT_SECRET,
      })
    }

    // Authorize URL - uses Dango's app, dango keeps the PKCE verifier
    if (url.pathname === '/auth-url' && req.method === 'GET') {
      const returnTo = readReturnTo(url.searchParams.get('return_to') || '')
      const clientState = url.searchParams.get('state')
      const challenge = url.searchParams.get('code_challenge')
      const method = url.searchParams.get('code_challenge_method') || 'plain'
      if (!returnTo) return json({ error: 'return_to not allowed' }, 400)
      if (!clientState) return json({ error: 'state required' }, 400)
      if (!env.MAL_CLIENT_ID || !env.MAL_CLIENT_SECRET || !(await stateKey(env)))
        return json({ error: 'worker not configured' }, 500)
      const state = await signState(env, {
        s: clientState,
        r: returnTo.toString(),
        e: Date.now() + STATE_TTL,
      })
      const authorize = new URL(MAL_AUTHORIZE)
      const params = {
        response_type: 'code',
        client_id: env.MAL_CLIENT_ID,
        state: state,
        redirect_uri: `${url.origin}/callback`,
      }
      if (challenge) {
        params.code_challenge = challenge
        params.code_challenge_method = method
      }
      authorize.search = new URLSearchParams(params).toString()
      return json({ url: authorize.toString() })
    }

    // MAL redirects here; hand the one-time code back to the dango origin
    if (url.pathname === '/callback' && req.method === 'GET') {
      const payload = await verifyState(env, url.searchParams.get('state') || '')
      if (!payload) return new Response('Invalid or expired state', { status: 400, headers: cors })
      const target = new URL(payload.r)
      target.searchParams.set('state', payload.s)
      const error = url.searchParams.get('error')
      if (error) target.searchParams.set('error', error)
      else target.searchParams.set('code', url.searchParams.get('code') || '')
      return Response.redirect(target.toString(), 302)
    }

    if (url.pathname === '/exchange' && req.method === 'POST') {
      const body = await req.json().catch(() => null)
      const code = body?.code
      const verifier = body?.code_verifier
      if (!code || !verifier) return json({ error: 'code and code_verifier required' }, 400)
      if (!env.MAL_CLIENT_ID || !env.MAL_CLIENT_SECRET)
        return json({ error: 'worker not configured' }, 500)
      const { response, data } = await malToken(env, {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: `${url.origin}/callback`,
      })
      if (!response.ok) return json({ error: data.error || 'exchange failed' }, response.status)
      return json(data)
    }

    if (url.pathname === '/refresh' && req.method === 'POST') {
      const body = await req.json().catch(() => null)
      if (!body?.refresh_token) return json({ error: 'refresh_token required' }, 400)
      if (!env.MAL_CLIENT_ID || !env.MAL_CLIENT_SECRET)
        return json({ error: 'worker not configured' }, 500)
      const { response, data } = await malToken(env, {
        grant_type: 'refresh_token',
        refresh_token: body.refresh_token,
      })
      if (!response.ok) return json({ error: data.error || 'refresh failed' }, response.status)
      return json(data)
    }

    return json({ error: 'not found' }, 404)
  },
}
