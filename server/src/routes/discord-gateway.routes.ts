import { Router } from 'express'
import fs from 'fs'
import logger from '../logger'
import { discordGatewayService } from '../discord-gateway'
import { CONFIG } from '../config'

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

  router.post('/discord/gateway/save', (req, res) => {
    let token = (req.body.token || '').trim()
    if (token.startsWith('"') && token.endsWith('"')) token = token.slice(1, -1)
    if (token.length < 30) return res.status(400).json({ error: 'Token too short' })

    const envPath = CONFIG.ENV_PATH
    const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : ''
    const lines = envContent
      .split(/\r?\n/)
      .filter((line) => !line.startsWith('DISCORD_GATEWAY_TOKEN='))
    lines.push(`DISCORD_GATEWAY_TOKEN=${token}`)
    fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8')

    process.env.DISCORD_GATEWAY_TOKEN = token
    discordGatewayService.reloadToken()
    log.info(`Discord Gateway token saved ${mask(token)} (not logged)`)
    res.json({ ok: true, masked: mask(token) })
  })

  router.post('/discord/gateway/remove', (_req, res) => {
    const envPath = CONFIG.ENV_PATH
    const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : ''
    const lines = envContent
      .split(/\r?\n/)
      .filter((line) => !line.startsWith('DISCORD_GATEWAY_TOKEN='))
    fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8')

    delete process.env.DISCORD_GATEWAY_TOKEN
    discordGatewayService.reloadToken()
    log.info('Discord Gateway token removed')
    res.json({ ok: true })
  })

  return router
}
