import { Router } from 'express'
import { AuthController } from '../controllers/auth.controller'
import { DatabaseWrapper } from '../db'

export function createAuthRouter(
  runSyncSequence: (
    db: DatabaseWrapper,
    provider?: 'github' | 'google' | 'rclone' | 'none'
  ) => Promise<void>
): Router {
  const router = Router()
  const controller = new AuthController(runSyncSequence)

  router.get('/config-status', controller.getConfigStatus)
  router.get('/google-auth', controller.getGoogleAuthSettings)
  router.post('/google-auth', controller.updateGoogleAuthSettings)
  router.get('/github/status', controller.getGitHubAuthStatus)
  router.post('/github/start', controller.startGitHubDeviceAuth)
  router.get('/github/poll', controller.pollGitHubDeviceAuth)
  router.post('/github/logout', controller.logoutGitHub)
  router.get('/github/auth', controller.getGitHubAuthOverride)
  router.post('/github/auth', controller.updateGitHubAuthSettings)
  router.get('/settings/rclone', controller.getRcloneSettings)
  router.post('/settings/rclone', controller.updateRcloneSettings)
  router.get('/settings/sync', controller.getSyncSettings)
  router.post('/settings/sync', controller.updateSyncProvider)
  router.get('/google', controller.getAuthUrl)
  router.post('/google/login', controller.loginGoogle)
  router.get('/google/callback', controller.handleCallback)
  router.get('/user', controller.getUserProfile)
  router.post('/logout', controller.logout)

  return router
}
