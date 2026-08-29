import { Router, Request, Response } from 'express'
import { ProxyController } from '../controllers/proxy.controller'

export function createProxyRouter(): Router {
  const router = Router()
  const controller = new ProxyController()

  router.get('/proxy', controller.handleProxy)
  router.get('/embed-proxy', controller.handleEmbedProxy)
  router.get('/subtitle-proxy', controller.handleSubtitleProxy)
  router.get('/image-proxy', controller.handleImageProxy)
  router.get('/resolve', controller.handleResolve)

  return router
}
