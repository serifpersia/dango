import { Router } from 'express'
import { AppCache } from '../utils/cache.utils.js'
import { MusicController } from '../controllers/music.controller.js'

export function createMusicRouter(apiCache: AppCache): Router {
  const router = Router()
  const controller = new MusicController(apiCache)

  router.get('/music/auth/status', controller.getAuthStatus)
  router.post('/music/auth/start', controller.startAuth)
  router.post('/music/auth/signout', controller.signOut)
  router.get('/music/search', controller.search)
  router.get('/music/stream', controller.stream)
  router.get('/music/audio', controller.audio)
  router.get('/music/track', controller.track)
  router.get('/music/library', controller.library)
  router.get('/music/playlist', controller.playlist)
  router.get('/music/home', controller.home)
  router.get('/music/upnext', controller.upnext)
  router.get('/music/likes', controller.likedIds)
  router.post('/music/like', controller.rate)

  return router
}
