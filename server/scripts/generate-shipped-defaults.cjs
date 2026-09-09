const fs = require('fs')
const path = require('path')

const defaults = {
  GITHUB_CLIENT_ID: process.env.G_CLIENT_ID || '',
  GOOGLE_AUTH_WORKER_URL: process.env.GOOGLE_AUTH_WORKER_URL || '',
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || '',
}

const out = `export const SHIPPED_DEFAULTS = ${JSON.stringify(defaults, null, 2)} as const
`

fs.writeFileSync(path.join(__dirname, '..', 'src', 'shipped-defaults.ts'), out)
console.log('Wrote server/src/shipped-defaults.ts')
