# Dango Discord Roles — Cloudflare Worker

Serverless Cloudflare Worker that handles Discord OAuth2, assigns F–S rank and Dere archetype roles, and persists watch stats in Cloudflare D1.

## Setup & Deploy

Run all commands from the repository root.

### 1. Authenticate with Cloudflare

```bash
npx wrangler login
```

### 2. Create the D1 database

```bash
npx wrangler d1 create dango-ranks-db
```

Copy the `database_id` from the output into `worker/dango-discord-roles/wrangler.toml`, then apply the schema:

```bash
npx wrangler d1 execute dango-ranks-db --remote --file=worker/dango-discord-roles/schema.sql
```

### 3. Add secrets

```bash
npx wrangler secret put DISCORD_CLIENT_SECRET --config worker/dango-discord-roles/wrangler.toml
npx wrangler secret put DISCORD_BOT_TOKEN --config worker/dango-discord-roles/wrangler.toml
npx wrangler secret put DISCORD_PUBLIC_KEY --config worker/dango-discord-roles/wrangler.toml
```

`DISCORD_PUBLIC_KEY` is under your Discord app → General Information → Public Key. It is required for the `/profile` slash command signature check.

### 4. Deploy

```bash
npx wrangler deploy --config worker/dango-discord-roles/wrangler.toml
```

Your worker URL will be: `https://dango-discord-roles.<your-subdomain>.workers.dev`

### 5. Add the redirect URI in Discord Developer Portal

Go to your app → **OAuth2 → Redirects** and add:

```
https://dango-discord-roles.<your-subdomain>.workers.dev/auth/callback
```

## Configuration

Copy `wrangler.toml.example` to `wrangler.toml` and fill in your values. The actual `wrangler.toml` is gitignored.

## Slash command: /profile

The worker serves Discord Interactions at `POST /interactions` (PING + `/profile`, optional `user`).

1. Deploy the worker, then in Discord Developer Portal → General Information set Interactions Endpoint URL to:

```
https://dango-discord-roles.<your-subdomain>.workers.dev/interactions
```

2. Register the command (guild = instant, global = up to ~1h):

```bash
# PowerShell, guild (testing)
$env:DISCORD_CLIENT_ID="..."
$env:DISCORD_BOT_TOKEN="..."
$env:DISCORD_GUILD_ID="..."
node worker/dango-discord-roles/register-commands.mjs

# Global
node worker/dango-discord-roles/register-commands.mjs --global
```

3. In Discord, use `/profile` or `/profile user:@someone`. Linked members show rank, top 3 deres, hours, episodes, anime, completed + %, and top genres from D1; unlinked users get an ephemeral link prompt. Keep it usable anywhere — no new channel needed yet.

## Slash command: /recommend

Taste-weighted recommendations from each member's Dango library (AniList candidates, everything known excluded, 30-day rotation via `rec_log`).

- `/recommend` → single best pick with cover + why.
- `/recommend count:3` (1-5) → list, one why-line each.

How it works: Dango itself queries AniList (its home IP isn't blocked; the worker's Cloudflare IPs get 403) and pushes ~15 pre-scored candidates inside `members.taste` on sync — recomputed only when taste changes. `/recommend` serves from those, excluding known + 30-day `rec_log` rotation, with top-1 stable and the rest shuffled from the top 8. Live AniList queries in the worker remain only as fallback for old Dango versions.

Discord-side setup (no code changes, no channel IDs in config):

1. Create a `#recommendations` channel (optional while tiny — works in `#general` too).
2. Server Settings → Integrations → dango app → Command Permissions: restrict `/recommend` to `#recommendations`, leave `/profile` on for all channels.
3. Members must Sync Roles once (Settings → Community) before `/recommend` knows their taste — otherwise they get an ephemeral link prompt.

## Upgrading an existing D1 (v2 card columns)

v2 adds `total_episodes`, `total_anime`, `completed_count`, `completion_rate`. For a database created before v2, run each line separately (`--file` runs as one transaction, so one duplicate-column error aborts everything — `--command` runs each alone). Ignore `duplicate column name` errors, those just mean that column already exists:

```bash
npx wrangler d1 execute dango-ranks-db --remote --command "ALTER TABLE members ADD COLUMN total_episodes INTEGER DEFAULT 0" --config worker/dango-discord-roles/wrangler.toml
npx wrangler d1 execute dango-ranks-db --remote --command "ALTER TABLE members ADD COLUMN total_anime INTEGER DEFAULT 0" --config worker/dango-discord-roles/wrangler.toml
npx wrangler d1 execute dango-ranks-db --remote --command "ALTER TABLE members ADD COLUMN completed_count INTEGER DEFAULT 0" --config worker/dango-discord-roles/wrangler.toml
npx wrangler d1 execute dango-ranks-db --remote --command "ALTER TABLE members ADD COLUMN completion_rate INTEGER DEFAULT 0" --config worker/dango-discord-roles/wrangler.toml
```

The worker also falls back to the old columns if migration hasn't run yet, but new counts only appear after migrating + redeploying + re-syncing roles from Dango (Settings → Community → Sync Roles, or wait ~10 min for auto-sync).

## Upgrading an existing D1 (v3 recommend)

v3 adds `members.taste` (auto-migrated on next sync — the worker runs the ALTER itself on first push) plus a `rec_log` rotation table:

```bash
npx wrangler d1 execute dango-ranks-db --remote --command "CREATE TABLE IF NOT EXISTS rec_log (discord_id TEXT NOT NULL, anilist_id INTEGER NOT NULL, recommended_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (discord_id, anilist_id))" --config worker/dango-discord-roles/wrangler.toml
```
