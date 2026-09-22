import { Router } from 'express'
import { AsmrLibraryController } from '../controllers/asmr-library.controller.js'

export function createAsmrLibraryRouter(): Router {
  const router = Router()
  const controller = new AsmrLibraryController()

  router.get('/asmr/library', controller.getLibrary)
  router.get('/asmr/library/ids', controller.getLibraryIds)
  router.get('/asmr/library/check/:id', controller.checkLibrary)
  router.post('/asmr/library/add', controller.addToLibrary)
  router.post('/asmr/library/remove', controller.removeFromLibrary)
  router.post('/asmr/library/status', controller.updateStatus)
  router.post('/asmr/library/batch-status', controller.batchUpdateStatus)
  router.post('/asmr/library/remove-many', controller.batchRemove)
  router.post('/asmr/progress/remove-many', controller.batchRemoveProgress)
  router.get('/asmr/progress/:workId', controller.getProgress)
  router.get('/asmr/progress/:workId/latest', controller.getLatestProgress)
  router.post('/asmr/progress', controller.saveProgress)
  router.post('/asmr/progress/remove', controller.removeProgress)
  router.get('/asmr/continue-listening', controller.getContinueListening)
  router.get('/asmr/continue-listening/adult-count', controller.getAdultContinueListeningCount)
  router.post('/asmr/continue-listening/purge-adult', controller.purgeAdultContinueListening)

  return router
}
