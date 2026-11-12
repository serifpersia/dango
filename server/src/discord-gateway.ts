import WebSocket from 'ws'
import logger from './logger.js'
import { CONFIG } from './config.js'
import dotenv from 'dotenv'

const log = logger.child({ module: 'DiscordGateway' })

interface PresenceData {
  title: string
  episode: string
  totalEpisodes?: string
  currentTime: number
  duration: number
  thumbnail: string
  isPlaying: boolean
  providerName?: string
  sessionId?: string
  thumbnails?: string[]
  isAdult?: boolean
  stateLine?: string
}

class DiscordGatewayService {
  private gateway: WebSocket | null = null
  private heartbeat: NodeJS.Timeout | null = null
  private token: string | null = null
  private reconnectTimeout: NodeJS.Timeout | null = null
  private lastActivity: PresenceData | null = null
  private isEnabled = false
  private readonly RECONNECT_DELAY = 15000
  private externalAssetCache = new Map<string, string>()
  private logoAssetId: string | null = null
  private logoAssetChecked = false

  public setEnabled(enabled: boolean) {
    this.isEnabled = enabled
    if (enabled) {
      this.loadToken()
      this.connect()
    } else {
      this.disconnect()
    }
  }

  public get serviceEnabled(): boolean {
    return this.isEnabled && !!this.token && this.token.length > 30
  }

  public hasToken(): boolean {
    return !!this.token && this.token.length > 30
  }

  private loadToken() {
    this.token = process.env.DISCORD_GATEWAY_TOKEN || null
    this.logoAssetId = null
    this.logoAssetChecked = false
  }

  public reloadToken() {
    dotenv.config({ path: CONFIG.ENV_PATH, override: true })
    this.loadToken()
    if (this.serviceEnabled) {
      this.disconnect()
      this.connect()
    }
  }

  private async getExternalAsset(url: string): Promise<string | null> {
    if (!CONFIG.DISCORD_CLIENT_ID || !this.token) return null
    const cached = this.externalAssetCache.get(url)
    if (cached) return cached

    try {
      const res = await fetch(
        `https://discord.com/api/v9/applications/${CONFIG.DISCORD_CLIENT_ID}/external-assets`,
        {
          method: 'POST',
          headers: {
            Authorization: this.token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ urls: [url] }),
        }
      )
      const text = await res.text()
      if (!res.ok) {
        log.warn(`external-assets proxy failed ${res.status}: ${text.slice(0, 200)}`)
        return null
      }
      const data = JSON.parse(text) as Array<{ external_asset_path: string }>
      if (!data[0]?.external_asset_path) return null
      const mp = `mp:${data[0].external_asset_path}`
      this.externalAssetCache.set(url, mp)
      return mp
    } catch (err) {
      log.warn({ err }, 'external-assets proxy error')
      return null
    }
  }

  private async getLogoAssetId(): Promise<string | null> {
    if (!CONFIG.DISCORD_CLIENT_ID || !this.token) return null
    if (this.logoAssetChecked) return this.logoAssetId

    try {
      const res = await fetch(
        `https://discord.com/api/v9/oauth2/applications/${CONFIG.DISCORD_CLIENT_ID}/assets`,
        { headers: { Authorization: this.token } }
      )
      const text = await res.text()
      if (!res.ok) {
        log.warn(`application assets fetch failed ${res.status}: ${text.slice(0, 200)}`)
        this.logoAssetChecked = true
        return null
      }
      const assets = JSON.parse(text) as Array<{ id?: string; name?: string }>
      this.logoAssetId = assets.find((asset) => asset.name === 'logo')?.id ?? null
      this.logoAssetChecked = true
      return this.logoAssetId
    } catch (err) {
      log.warn({ err }, 'application assets fetch error')
      this.logoAssetChecked = true
      return null
    }
  }

  private resolveImageUrl(data: PresenceData): string | null {
    const isSafeUrl = (url: string): boolean => {
      if (!url.startsWith('https://')) return false
      if (url.includes('localhost') || url.includes('127.0.0.1')) return false
      if (url.includes('s4.anilist.co') || url.includes('anilistcdn')) return true
      const blocked = [
        'youtube-anime.com',
        'animepahe',
        'animeya.cc',
        'gogocdn.net',
        'weeabo0.xyz',
        'japaneseasmr.com',
      ]
      return !blocked.some((d) => url.includes(d))
    }

    let thumb = data.thumbnail
    if (thumb && thumb.includes('/api/image-proxy')) {
      const m = thumb.match(/url=([^&]+)/)
      if (m) {
        try {
          thumb = decodeURIComponent(m[1])
        } catch (_e) {
          void _e
        }
      }
    }
    if (thumb && data.providerName !== 'AnimePahe' && isSafeUrl(thumb)) return thumb
    if (data.thumbnails) {
      const safe = data.thumbnails.find(
        (t) => t && (t.includes('s4.anilist.co') || t.includes('anilistcdn'))
      )
      if (safe) return safe
    }
    if (thumb && isSafeUrl(thumb)) return thumb
    return null
  }

  public async updatePresence(data: PresenceData) {
    this.lastActivity = data
    if (!this.isEnabled || !this.gateway || this.gateway.readyState !== WebSocket.OPEN) return

    const name = 'dango'
    const details = data.title
    const state = data.stateLine
      ? data.stateLine
      : `Episode ${data.episode}${data.totalEpisodes ? `/${data.totalEpisodes}` : ''}`
    const type = data.providerName === 'ASMR' ? 2 : 3

    const imageUrl = this.resolveImageUrl(data)
    let assets: { large_image?: string; large_text?: string } | undefined

    if (CONFIG.DISCORD_CLIENT_ID) {
      const image = imageUrl ? await this.getExternalAsset(imageUrl) : null
      const logo = image ?? (await this.getLogoAssetId())
      if (logo) {
        assets = { large_image: logo, large_text: data.title.slice(0, 128) }
      }
    }

    const presence: {
      since: number | null
      activities: Array<{
        name: string
        type: number
        state: string
        details?: string
        timestamps?: { start: number; end: number }
        application_id?: string
        assets?: {
          large_image?: string
          large_text?: string
        }
        buttons?: string[]
        metadata?: { button_urls?: string[] }
        status_display_type?: number
      }>
      status: string
      afk: boolean
    } = {
      since: null,
      activities: [
        {
          name,
          type,
          state: data.isPlaying ? state : `${state} (Paused)`,
          details,
          ...(CONFIG.DISCORD_CLIENT_ID ? { application_id: CONFIG.DISCORD_CLIENT_ID } : {}),
          ...(assets ? { assets } : {}),
          buttons: ['Learn More'],
          metadata: { button_urls: ['https://github.com/serifpersia/dango'] },
          status_display_type: 2,
        },
      ],
      status: 'online',
      afk: false,
    }

    const nowMs = Date.now()
    if (data.isPlaying) {
      if (data.currentTime && data.currentTime > 0) {
        presence.since = nowMs - Math.round(data.currentTime * 1000)
      }
      if (data.duration && data.duration > data.currentTime) {
        presence.activities[0].timestamps = {
          start: nowMs - Math.round(data.currentTime * 1000),
          end: nowMs + Math.round((data.duration - data.currentTime) * 1000),
        }
      }
    }

    try {
      this.gateway.send(JSON.stringify({ op: 3, d: presence }))
    } catch (err) {
      log.error({ err }, 'Failed to send gateway presence update')
    }
  }

  public async setIdleStatus(page: string) {
    if (!this.isEnabled || !this.gateway || this.gateway.readyState !== WebSocket.OPEN) return

    const pageLabels: Record<string, { details: string; state: string }> = {
      home: { details: 'Home', state: 'Browsing anime' },
      'home-anime': { details: 'Home', state: 'Browsing anime' },
      'home-manga': { details: 'Home', state: 'Browsing manga' },
      'home-tv': { details: 'Home', state: 'Browsing movies & shows' },
      'home-asmr': { details: 'Home', state: 'Browsing ASMR works' },
      search: { details: 'Search', state: 'Exploring titles...' },
      'search-anime': { details: 'Anime Search', state: 'Browsing titles' },
      'search-manga': { details: 'Manga Search', state: 'Browsing titles' },
      'search-tv': { details: 'TV Search', state: 'Browsing titles' },
      'search-asmr': { details: 'ASMR Search', state: 'Browsing titles' },
      watchlist: { details: 'Watchlist', state: 'Reviewing the watchlist' },
      'tv-watchlist': { details: 'TV Watchlist', state: 'Reviewing the watchlist' },
      'reading-list': { details: 'Reading List', state: 'Reviewing the reading list' },
      'listening-list': { details: 'Listening List', state: 'Reviewing the listening list' },
      anime: { details: 'Anime Info', state: 'Reading show details' },
      insights: { details: 'Insights', state: 'Reviewing stats' },
      settings: { details: 'Settings', state: 'Tweaking preferences' },
      trackers: { details: 'Trackers', state: 'Syncing watchlists' },
      map: { details: 'Map', state: 'Exploring the global user map' },
      asmr: { details: 'ASMR Info', state: 'Reading details' },
      tv: { details: 'TV Info', state: 'Reading show details' },
      manga: { details: 'Manga Info', state: 'Reading manga details' },
    }

    const label = pageLabels[page] ?? { details: 'dango', state: 'Idle' }
    const isListening = page === 'asmr' || page === 'home-asmr' || page === 'search-asmr'

    const logo = await this.getLogoAssetId()

    try {
      this.gateway.send(
        JSON.stringify({
          op: 3,
          d: {
            since: null,
            activities: [
              {
                name: 'dango',
                type: isListening ? 2 : 3,
                state: label.state,
                details: label.details,
                ...(CONFIG.DISCORD_CLIENT_ID ? { application_id: CONFIG.DISCORD_CLIENT_ID } : {}),
                ...(logo
                  ? {
                      assets: {
                        large_image: logo,
                        ...(isListening ? {} : { large_text: 'dango' }),
                      },
                    }
                  : {}),
                buttons: ['Learn More'],
                metadata: { button_urls: ['https://github.com/serifpersia/dango'] },
                status_display_type: 2,
              },
            ],
            status: 'online',
            afk: false,
          },
        })
      )
    } catch (err) {
      log.error({ err }, 'Failed to send gateway idle status')
    }
  }

  public clearPresence() {
    if (!this.isEnabled) return
    if (this.gateway && this.gateway.readyState === WebSocket.OPEN) {
      try {
        this.gateway.send(
          JSON.stringify({
            op: 3,
            d: { since: null, activities: [], status: 'online', afk: false },
          })
        )
      } catch {
        // ignore
      }
    }
    this.lastActivity = null
  }

  public shutdown() {
    this.isEnabled = false
    this.token = null
    this.disconnect()
  }

  public disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.gateway) {
      try {
        if (this.gateway.readyState === WebSocket.OPEN) {
          this.gateway.send(
            JSON.stringify({
              op: 3,
              d: { since: null, activities: [], status: 'online', afk: false },
            })
          )
        }
        this.gateway.close()
      } catch {
        // ignore
      }
      this.gateway = null
    }
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
  }

  private connect() {
    if (!this.isEnabled || !this.token || this.gateway) return

    const wsUrl = 'wss://gateway.discord.gg/?encoding=json&v=10'
    log.debug('Connecting Discord gateway')

    this.gateway = new WebSocket(wsUrl)
    let heartbeatInterval = 41250

    this.gateway.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.op === 10) {
          heartbeatInterval = msg.d.heartbeat_interval

          this.heartbeat = setInterval(() => {
            try {
              if (this.gateway && this.gateway.readyState === WebSocket.OPEN) {
                this.gateway.send(JSON.stringify({ op: 1, d: null }))
              }
            } catch {
              // ignore
            }
          }, heartbeatInterval)

          const identify = {
            op: 2,
            d: {
              token: this.token,
              capabilities: 1021,
              client_state: {
                guild_hashes: {},
                highest_last_message_id: '0',
                private_channels_version: '0',
                read_state_version: 0,
                user_guild_settings_version: -1,
                user_settings_version: -1,
              },
              compress: false,
              presence: {
                since: null,
                activities: [],
                status: 'online',
                afk: false,
              },
              properties: {
                os: 'Windows',
                os_version: '10.0.19044',
                os_arch: 'x64',
                browser: 'Discord Client',
                client_version: '0.0.20',
                client_build_number: 152131,
                client_event_source: null,
                release_channel: 'stable',
                system_locale: 'en-US',
              },
            },
          }
          if (this.gateway) {
            this.gateway.send(JSON.stringify(identify))
          }
        } else if (msg.op === 11) {
          // ignore
        } else if (msg.op === 0) {
          if (msg.t === 'READY') {
            log.info(`Gateway READY as ${msg.d.user?.username || 'unknown'}`)
            this.logoAssetChecked = false
            if (this.lastActivity) {
              void this.updatePresence(this.lastActivity).catch((err) =>
                log.warn({ err }, 'failed to restore presence after READY')
              )
            }
          }
        } else if (msg.op === 7) {
          log.warn('Gateway reconnect requested by Discord')
          this.handleDisconnect()
        } else if (msg.op === 9) {
          log.warn('Gateway invalid session, reconnecting...')
          this.handleDisconnect()
        }
      } catch (err) {
        log.debug({ err }, 'Gateway message parse error')
      }
    })

    this.gateway.on('close', (code, reason) => {
      log.warn(`Gateway closed ${code} ${reason.toString().slice(0, 100)}`)
      this.handleDisconnect()
    })

    this.gateway.on('error', (err) => {
      log.error(err, 'Gateway WebSocket error')
      this.handleDisconnect()
    })
  }

  private handleDisconnect() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    this.gateway = null

    if (this.isEnabled && this.token) {
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null
        this.connect()
      }, this.RECONNECT_DELAY)
    }
  }
}

export const discordGatewayService = new DiscordGatewayService()
