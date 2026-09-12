import { Router } from 'express'
import { LocalMediaController } from '../controllers/local-media.controller'
import { DatabaseWrapper } from '../db'

export function createLocalMediaRouter(getDb: () => DatabaseWrapper): Router {
  const router = Router()
  const getController = () => new LocalMediaController(getDb())

  router.get('/local/library-path', (req, res) => getController().getLibraryPath(req, res))
  router.post('/local/library-path', (req, res) => getController().setLibraryPath(req, res))

  router.post('/local/scan', (req, res) => getController().scan(req, res))

  router.get('/local/shows', (req, res) => getController().getShows(req, res))
  router.get('/local/shows/unmatched', (req, res) => getController().getUnmatched(req, res))
  router.get('/local/shows/:id', (req, res) => getController().getShow(req, res))

  router.post('/local/shows/:id/resolve', (req, res) => getController().resolveMetadata(req, res))
  router.post('/local/shows/:id/link', (req, res) => getController().linkToAnilist(req, res))
  router.delete('/local/shows/:id/link', (req, res) => getController().unlinkMetadata(req, res))

  router.get('/local/stream', (req, res) => getController().stream(req, res))
  router.get('/local/subtitle', (req, res) => getController().streamSubtitle(req, res))
  router.get('/local/browse', (req, res) => getController().browseDirectory(req, res))

  return router
}
