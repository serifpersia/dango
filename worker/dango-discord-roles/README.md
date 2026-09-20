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
```

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
