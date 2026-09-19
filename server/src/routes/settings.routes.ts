import { Router } from 'express'
import { SettingsController } from '../controllers/settings.controller.js'
import multer from 'multer'
import { CONFIG } from '../config.js'
import { DatabaseWrapper } from '../db.js'

export function createSettingsRouter(
  getDb: () => DatabaseWrapper,
  initializeDatabase: (path: string) => Promise<DatabaseWrapper>,
  setDb: (newDb: DatabaseWrapper) => void
): Router {
  const router = Router()
  const controller = new SettingsController()

  router.get('/settings', controller.getSettings)
  router.post('/settings', controller.updateSettings)
  router.get('/backup-db', controller.backupDatabase)
  router.post('/database/clear', controller.clearDatabase)
  router.get('/installation-id', controller.getInstallationId)
  router.get('/settings/offline-db', controller.getOfflineDbInfo)
  router.post('/settings/offline-db/update', controller.updateOfflineDb)
  router.post('/settings/offline-db/auto-update', controller.setAutoUpdateOfflineDb)

  const restoreStorage = multer({
    storage: multer.diskStorage({
      destination: (_req, _f, cb) => cb(null, CONFIG.ROOT),
      filename: (_r, _f, cb) => cb(null, `restore_temp.db`),
    }),
  })

  router.post('/restore-db', restoreStorage.single('dbfile'), (req, res) =>
    controller.restoreDatabase(req, res, getDb(), initializeDatabase, setDb)
  )

  router.post('/import/mal-xml', multer().single('xmlfile'), controller.importMalXml)
  router.get('/import/mal-xml/status', controller.getImportStatus)
  router.post('/import/mal-xml/cancel', controller.cancelImport)

  return router
}
