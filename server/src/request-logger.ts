import { Request, Response, NextFunction } from 'express'
import logger from './logger.js'

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint()
  const url = req.originalUrl || req.url
  res.on('finish', () => {
    const ms = Math.round((Number(process.hrtime.bigint() - start) / 1_000_000) * 10) / 10
    const payload = { method: req.method, url, status: res.statusCode, ms }
    if (res.statusCode >= 500) {
      logger.warn(payload, 'request failed')
    } else if (!url.startsWith('/api/proxy')) {
      logger.trace(`${req.method} ${url} ${res.statusCode} ${ms}ms`)
    }
  })
  next()
}
