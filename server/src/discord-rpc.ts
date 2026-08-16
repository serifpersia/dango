import { Client } from '@xhayper/discord-rpc'
import logger from './logger'
import { CONFIG } from './config'

const log = logger.child({ module: 'DiscordRPC' })

interface DiscordActivityData {
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
}

class DiscordRPCService {
  private client: Client | null = null
  private isEnabled: boolean = false
  private hideMature: boolean = true
  private reconnectTimeout: NodeJS.Timeout | null = null
  private lastActivity: DiscordActivityData | null = null
  private currentSessionId: string | null = null
  private retryCount: number = 0
  private readonly MAX_RETRIES = 5
  private readonly INITIAL_RECONNECT_DELAY = 15000
  private readonly MAX_RECONNECT_DELAY = 300000

  public async setEnabled(enabled: boolean) {
    if (this.isEnabled === enabled) return
    this.isEnabled = enabled
    if (enabled) {
      this.retryCount = 0
      this.connect()
    } else {
      await this.disconnect()
    }
  }

  public get isServiceEnabled(): boolean {
    return this.isEnabled
  }

  public setHideMature(hide: boolean) {
    this.hideMature = hide
  }

  private async connect() {
    if (!this.isEnabled || this.client) return

    const isTermux = !!process.env.TERMUX_VERSION
    const isAndroid = process.platform === 'android'
    if (isTermux || isAndroid) {
      log.debug('Discord Rich Presence is not supported on Android/Termux. Skipping connection.')
      this.isEnabled = false
      return
    }

    const clientId = CONFIG.DISCORD_CLIENT_ID
    if (!clientId) {
      log.debug('DISCORD_CLIENT_ID is not configured. Discord Rich Presence is disabled.')
      return
    }

    try {
      this.client = new Client({ clientId })

      this.client.on('ready', () => {
        log.info('Connected to Discord client successfully')
        this.retryCount = 0
        if (this.lastActivity) {
          this.updatePresence(this.lastActivity)
        } else {
          this.setIdleStatus('home')
        }
      })

      this.client.on('disconnected', () => {
        log.warn('Disconnected from Discord client, scheduling reconnect...')
        this.cleanup()
        this.scheduleReconnect()
      })

      this.client.on('ERROR', (err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err)
        if (errMsg.includes('ENOENT') || errMsg.includes('ECONNREFUSED')) {
          log.debug('Discord client not running or connection refused.')
        } else {
          log.error({ err }, 'Discord RPC client error')
        }
        this.cleanup()
        this.scheduleReconnect()
      })

      const loginPromise = this.client.login()
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Login timeout')), 5000)
      )

      await Promise.race([loginPromise, timeoutPromise])
    } catch (err) {
      this.cleanup()
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (!this.isEnabled || this.reconnectTimeout) return

    const delay = Math.min(
      this.INITIAL_RECONNECT_DELAY * Math.pow(1.5, this.retryCount),
      this.MAX_RECONNECT_DELAY
    )

    this.retryCount++

    if (this.retryCount > this.MAX_RETRIES) {
      log.debug(
        `Discord RPC login failed ${this.retryCount} times. Retrying in ${Math.round(delay / 1000)}s...`
      )
    } else {
      log.info(`Discord RPC login failed. Retrying in ${Math.round(delay / 1000)}s...`)
    }

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null
      this.connect()
    }, delay)
  }

  private cleanup() {
    if (this.client) {
      try {
        this.client.removeAllListeners()
        this.client.destroy()
      } catch (err) {
        // Ignore errors during destruction
      }
      this.client = null
    }
  }

  public async disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.client?.user) {
      try {
        await this.client.user.clearActivity()
      } catch {
        // ignore
      }
    }

    this.cleanup()
    this.lastActivity = null
    this.currentSessionId = null
  }

  private formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds <= 0) return '00:00'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    const mm = String(m).padStart(2, '0')
    const ss = String(s).padStart(2, '0')
    if (h > 0) {
      const hh = String(h).padStart(2, '0')
      return `${hh}:${mm}:${ss}`
    }
    return `${mm}:${ss}`
  }

  public async updatePresence(data: DiscordActivityData) {
    this.lastActivity = data
    if (data.sessionId) {
      this.currentSessionId = data.sessionId
    }
    if (!this.isEnabled || !this.client || !this.client.user) return
    if (this.hideMature && data.isAdult) {
      try {
        await this.client.user.clearActivity()
      } catch {
        // ignore
      }
      return
    }

    const isSafeUrl = (url: string): boolean => {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return false
      }
      if (url.includes('localhost') || url.includes('127.0.0.1')) {
        return false
      }
      if (url.includes('s4.anilist.co') || url.includes('anilistcdn')) {
        return true
      }
      const blockedDomains = ['youtube-anime.com', 'animepahe', 'animeya.cc', 'gogocdn.net']
      return !blockedDomains.some((domain) => url.includes(domain))
    }

    let imageKey = 'logo'
    if (data.thumbnail && data.providerName !== 'AnimePahe') {
      let thumbUrl = data.thumbnail
      if (thumbUrl.includes('/api/image-proxy')) {
        const match = thumbUrl.match(/url=([^&]+)/)
        if (match) {
          thumbUrl = decodeURIComponent(match[1])
        }
      }

      if (isSafeUrl(thumbUrl)) {
        imageKey = thumbUrl
      } else if (data.thumbnails) {
        const safeThumb = data.thumbnails.find(
          (t) => t && (t.includes('s4.anilist.co') || t.includes('anilistcdn'))
        )
        if (safeThumb) imageKey = safeThumb
      }
    }

    try {
      if (!data.isPlaying) {
        await this.client.user.clearActivity()
        await this.client.user.setActivity({
          details: data.title,
          state: `Episode ${data.episode}${data.totalEpisodes ? `/${data.totalEpisodes}` : ''} (Paused)`,
          largeImageKey: imageKey,
          largeImageText: data.title,
          smallImageKey: 'logo',
          smallImageText: 'dango',
          type: 3,
          buttons: [
            {
              label: 'Learn More',
              url: 'https://github.com/serifpersia/dango',
            },
          ],
        })
        return
      }

      const nowSeconds = Math.round(Date.now() / 1000)

      const activity: {
        details: string
        state: string
        startTimestamp?: number
        endTimestamp?: number
        largeImageKey: string
        largeImageText: string
        smallImageKey: string
        smallImageText: string
        type: number
        buttons: { label: string; url: string }[]
      } = {
        details: data.title,
        state: `Episode ${data.episode}${data.totalEpisodes ? `/${data.totalEpisodes}` : ''}`,
        largeImageKey: imageKey,
        largeImageText: data.title,
        smallImageKey: 'logo',
        smallImageText: 'dango',
        type: 3,
        buttons: [
          {
            label: 'Learn More',
            url: 'https://github.com/serifpersia/dango',
          },
        ],
      }

      if (data.currentTime && data.currentTime > 0) {
        activity.startTimestamp = Math.round(nowSeconds - data.currentTime)
      }

      if (data.duration && data.duration > data.currentTime) {
        activity.endTimestamp = Math.round(nowSeconds + (data.duration - data.currentTime))
      }

      await this.client.user.setActivity(activity)
    } catch (err) {
      log.error({ err }, 'Failed to set Discord activity')
    }
  }

  public async setIdleStatus(page: string) {
    if (!this.isEnabled || !this.client || !this.client.user) return

    const pageLabels: Record<string, { details: string; state: string }> = {
      home: { details: 'Browsing Anime', state: 'On the Home page' },
      search: { details: 'Searching for Anime', state: 'Exploring titles...' },
      watchlist: { details: 'Managing Watchlist', state: 'Reviewing anime list' },
      anime: { details: 'Viewing Anime Info', state: 'Reading show details' },
      insights: { details: 'Checking Insights', state: 'Reviewing stats' },
      settings: { details: 'In Settings', state: 'Tweaking preferences' },
      mal: { details: 'MAL Sync', state: 'Syncing with MyAnimeList' },
    }

    const label = pageLabels[page] ?? { details: 'Browsing Anime', state: 'Idle' }

    try {
      if (!this.client || !this.client.user) {
        log.warn('Discord client not connected, skipping idle status update')
        return
      }
      await this.client.user.setActivity({
        details: label.details,
        state: label.state,
        largeImageKey: 'logo',
        largeImageText: 'dango',
        type: 3,
        buttons: [
          {
            label: 'Learn More',
            url: 'https://github.com/serifpersia/dango',
          },
        ],
      })
    } catch (err) {
      if ((err as Error).message === 'Closed by Discord') {
        log.warn('Discord connection ended, skipping idle status update')
      } else {
        log.error({ err }, 'Failed to set Discord idle status')
      }
    }
  }

  public async clearPresence(sessionId?: string) {
    if (sessionId && this.currentSessionId && sessionId !== this.currentSessionId) {
      return
    }

    this.lastActivity = null
    this.currentSessionId = null

    await this.setIdleStatus('home')
  }
}

export const discordRPCService = new DiscordRPCService()
