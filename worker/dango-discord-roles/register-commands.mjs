import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
for (const envPath of [path.join(scriptDir, '.env')]) {
  let raw = null
  try {
    raw = fs.readFileSync(envPath, 'utf8')
  } catch {
    // ignore
  }
  if (!raw) continue
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

const PROFILE_COMMAND = {
  name: 'profile',
  description: 'Show a linked Dango watch profile',
  options: [
    {
      type: 6,
      name: 'user',
      description: 'Inspect someone else (defaults to you)',
      required: false,
    },
  ],
}

const RECOMMEND_COMMAND = {
  name: 'recommend',
  description: 'Get anime recommendations from your Dango library',
  options: [
    {
      type: 4,
      name: 'count',
      description: 'How many picks (1-5, default 1)',
      required: false,
      min_value: 1,
      max_value: 5,
    },
  ],
}

const commands = [PROFILE_COMMAND, RECOMMEND_COMMAND]

const args = new Set(process.argv.slice(2))
const useGlobal = args.has('--global')

const appId = process.env.DISCORD_CLIENT_ID
const botToken = process.env.DISCORD_BOT_TOKEN
const guildId = process.env.DISCORD_GUILD_ID

if (!appId || !botToken) {
  console.error('Missing DISCORD_CLIENT_ID or DISCORD_BOT_TOKEN env vars.')
  process.exit(1)
}
if (!useGlobal && !guildId) {
  console.error('Missing DISCORD_GUILD_ID env var (or pass --global).')
  process.exit(1)
}

const url = useGlobal
  ? `https://discord.com/api/v10/applications/${appId}/commands`
  : `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`

const res = await fetch(url, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${botToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'DiscordBot (https://github.com/serifpersia/dango, 1.0.0)',
  },
  body: JSON.stringify(commands),
})

const text = await res.text()
if (!res.ok) {
  console.error(`Registration failed (${res.status}): ${text.slice(0, 1000)}`)
  process.exit(1)
}
console.log(`Registered ${commands.length} command(s) ${useGlobal ? 'globally' : `for guild ${guildId}`}.`)
console.log(text.slice(0, 2000))
