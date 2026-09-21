import { Router } from 'express'
import { TvLibraryController } from '../controllers/tv-library.controller.js'

export function createTvLibraryRouter(): Router {
  const router = Router()
  const controller = new TvLibraryController()

  router.get('/tv/library', controller.getLibrary)
  router.get('/tv/library/ids', controller.getLibraryIds)
  router.get('/tv/library/check/:id', controller.checkLibrary)
  router.post('/tv/library/add', controller.addToLibrary)
  router.post('/tv/library/remove', controller.removeFromLibrary)
  router.post('/tv/library/status', controller.updateStatus)
  router.post('/tv/library/batch-status', controller.batchUpdateStatus)
  router.post('/tv/library/remove-many', controller.batchRemove)
  router.post('/tv/progress/remove-many', controller.batchRemoveProgress)
  router.get('/tv/progress/:mediaId', controller.getProgress)
  router.get('/tv/progress/:mediaId/latest', controller.getLatestProgress)
  router.post('/tv/progress', controller.saveProgress)
  router.post('/tv/progress/remove', controller.removeProgress)
  router.get('/tv/continue-watching', controller.getContinueWatching)

  return router
}
