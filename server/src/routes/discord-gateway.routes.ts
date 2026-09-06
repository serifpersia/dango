import { Router } from 'express'
import logger from '../logger'
import { discordGatewayService } from '../discord-gateway'
import { updateEnvFile } from '../utils/env.utils'

const log = logger.child({ module: 'DiscordGatewayRoutes' })

function mask(t: string | undefined | null): string {
  if (!t) return 'none'
  return t.slice(0, 8) + '...' + t.slice(-4)
}

export function createDiscordGatewayRouter(): Router {
  const router = Router()

  router.get('/discord/gateway/status', (_req, res) => {
    const hasToken = discordGatewayService.hasToken()
    res.json({
      hasToken,
      masked: hasToken ? mask(process.env.DISCORD_GATEWAY_TOKEN) : null,
      enabled: discordGatewayService.serviceEnabled,
    })
  })

  router.post('/discord/gateway/save', async (req, res) => {
    let token = (req.body.token || '').trim()
    if (token.startsWith('"') && token.endsWith('"')) token = token.slice(1, -1)
    if (token.length < 30) return res.status(400).json({ error: 'Token too short' })

    try {
      await updateEnvFile({ DISCORD_GATEWAY_TOKEN: token })
      discordGatewayService.reloadToken()
      log.info(`Discord Gateway token saved ${mask(token)} (not logged)`)
      res.json({ ok: true, masked: mask(token) })
    } catch (e) {
      log.error({ err: e }, 'Failed to save Discord Gateway token')
      res.status(500).json({ error: 'Failed to save token' })
    }
  })

  router.post('/discord/gateway/remove', async (_req, res) => {
    try {
      await updateEnvFile({ DISCORD_GATEWAY_TOKEN: '' })
      discordGatewayService.reloadToken()
      log.info('Discord Gateway token removed')
      res.json({ ok: true })
    } catch (e) {
      log.error({ err: e }, 'Failed to remove Discord Gateway token')
      res.status(500).json({ error: 'Failed to remove token' })
    }
  })

  return router
}
