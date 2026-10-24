# Watch-along Worker

Relays playback controls for direct HLS anime, TV, and movies. Each viewer uses
their own dango server; video and provider cookies never pass through the Worker.

Set `WATCH_ALONG_WORKER_URL` in dango's local `.env` for development and in the
repository's Actions secrets for releases:

```env
WATCH_ALONG_WORKER_URL=https://your-worker.workers.dev
```

Deploy from the repository root:

```bash
pnpm dlx wrangler deploy --config worker/dango-watch-along/wrangler.jsonc
```

Rooms allow 16 connections and expire after six hours. **End room** deletes room
storage immediately; abandoned rooms are deleted by their expiry alarm. The host
controls playback and source selection; guests keep personal quality and subtitles.
Display names are remembered per profile on each browser.
Host disconnects pause the room; reconnect within 60 seconds or it is deleted.
