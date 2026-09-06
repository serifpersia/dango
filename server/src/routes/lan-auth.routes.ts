import { Router } from 'express'
import {
  hasAppPassword,
  verifyAppPassword,
  setAppPassword,
  createLanSession,
  revokeLanSession,
  clearAllLanSessions,
  isLanAuthenticated,
  isLoopbackRequest,
  buildLanCookie,
  clearLanCookie,
  getRequestToken,
} from '../app-auth'

export function createLanAuthRouter(): Router {
  const router = Router()

  router.get('/app-status', (req, res) => {
    res.json({
      hasPassword: hasAppPassword(),
      isAuthenticated: isLanAuthenticated(req),
    })
  })

  router.post('/app-login', (req, res) => {
    const password = String(req.body?.password || '')
    if (!hasAppPassword()) {
      return res.json({ success: true })
    }
    if (!password) {
      return res.status(400).json({ error: 'Password required' })
    }
    if (!verifyAppPassword(password)) {
      return res.status(401).json({ error: 'Invalid password' })
    }
    const session = createLanSession()
    res.setHeader('Set-Cookie', buildLanCookie(session.token, session.expiry))
    res.json({ success: true })
  })

  router.post('/app-logout', (req, res) => {
    revokeLanSession(getRequestToken(req))
    res.setHeader('Set-Cookie', clearLanCookie())
    res.json({ success: true })
  })

  router.post('/app-setup', (req, res) => {
    if (!isLoopbackRequest(req)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const password = String(req.body?.password || '')
    setAppPassword(password)
      .then(() => {
        clearAllLanSessions()
        res.json({ success: true, hasPassword: hasAppPassword() })
      })
      .catch((err) => {
        res.status(500).json({ error: 'Failed to update password' })
      })
  })

  return router
}
