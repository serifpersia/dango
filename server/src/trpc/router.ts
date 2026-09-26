import { router } from './index.js'
import { settingsRouter } from './routers/settings.js'
import { queueRouter } from './routers/queue.js'
import { watchlistRouter } from './routers/watchlist.js'
import { progressRouter } from './routers/progress.js'
import { notificationsRouter } from './routers/notifications.js'
import { continueWatchingRouter } from './routers/continue-watching.js'
import { discoveryRouter } from './routers/discovery.js'
import { mangaLibraryRouter } from './routers/manga-library.js'
import { mangaProgressRouter } from './routers/manga-progress.js'
import { asmrLibraryRouter } from './routers/asmr-library.js'
import { asmrProgressRouter } from './routers/asmr-progress.js'
import { tvLibraryRouter } from './routers/tv-library.js'
import { tvProgressRouter } from './routers/tv-progress.js'
import { tvRouter } from './routers/tv.js'
import { mangaRouter } from './routers/manga.js'
import { asmrRouter } from './routers/asmr.js'
import { musicRouter } from './routers/music.js'
import { radioRouter } from './routers/radio.js'
import { trackerRouter } from './routers/tracker.js'
import { insightsRouter } from './routers/insights.js'
import { authRouter } from './routers/auth.js'
import { dataRouter } from './routers/data.js'
import { discordRouter } from './routers/discord.js'

export const appRouter = router({
  settings: settingsRouter,
  queue: queueRouter,
  watchlist: watchlistRouter,
  progress: progressRouter,
  notifications: notificationsRouter,
  continueWatching: continueWatchingRouter,
  discovery: discoveryRouter,
  mangaLibrary: mangaLibraryRouter,
  mangaProgress: mangaProgressRouter,
  asmrLibrary: asmrLibraryRouter,
  asmrProgress: asmrProgressRouter,
  tvLibrary: tvLibraryRouter,
  tvProgress: tvProgressRouter,
  tv: tvRouter,
  manga: mangaRouter,
  asmr: asmrRouter,
  music: musicRouter,
  radio: radioRouter,
  tracker: trackerRouter,
  insights: insightsRouter,
  auth: authRouter,
  data: dataRouter,
  discord: discordRouter,
})

export type AppRouter = typeof appRouter
