import { Router } from 'express'
import { MangaLibraryController } from '../controllers/manga-library.controller.js'

export function createMangaLibraryRouter(): Router {
  const router = Router()
  const controller = new MangaLibraryController()

  router.get('/manga/library', controller.getLibrary)
  router.get('/manga/library/ids', controller.getLibraryIds)
  router.get('/manga/library/check/:id', controller.checkLibrary)
  router.post('/manga/library/add', controller.addToLibrary)
  router.post('/manga/library/remove', controller.removeFromLibrary)
  router.post('/manga/library/status', controller.updateStatus)
  router.post('/manga/library/batch-status', controller.batchUpdateStatus)
  router.post('/manga/library/remove-many', controller.batchRemove)
  router.post('/manga/progress/remove-many', controller.batchRemoveProgress)
  router.get('/manga/progress/:mangaId', controller.getProgress)
  router.get('/manga/progress/:mangaId/latest', controller.getLatestProgress)
  router.post('/manga/progress', controller.saveProgress)
  router.post('/manga/progress/remove', controller.removeProgress)
  router.get('/manga/continue-reading', controller.getContinueReading)

  return router
}
