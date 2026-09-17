const STATUS_META = {
  OK: { color: '#4c1', label: 'OK' },
  ISSUES: { color: '#dfb317', label: 'ISSUES' },
  DOWN: { color: '#e05d44', label: 'DOWN' },
  UNKNOWN: { color: '#9f9f9f', label: 'UNKNOWN' },
}

function statusMeta(status) {
  const key = String(status || '').toUpperCase()
  return STATUS_META[key] || STATUS_META.UNKNOWN
}

export default {
  async fetch(request, env) {
    const sheetUrl = env.GOOGLE_SHEETS_URL
    const url = new URL(request.url)
    const provider = url.searchParams.get('provider')
    const view = url.searchParams.get('view')

    if (provider) return await handleProviderBadge(provider, sheetUrl)
    if (view === 'all') return await handleAllBadges(sheetUrl)
    if (view === 'status') return await handleStatusPage(sheetUrl)

    return await handleUsersBadge(sheetUrl)
  },
}

async function handleUsersBadge(sheetUrl) {
  try {
    const response = await fetch(sheetUrl)
    const data = await response.json()

    const active = data.active ?? 0
    const total = data.total ?? 0

    const label = 'USERS'
    const message = `ACTIVE:${active} | TOTAL:${total}`

    const svg = createBadge(label, message, '#897cff')
    return svgResponse(svg)
  } catch (e) {
    const svg = createBadge('USERS', 'UNAVAILABLE', '#9f9f9f')
    return svgResponse(svg)
  }
}

async function fetchProviders(sheetUrl) {
  try {
    const res = await fetch(sheetUrl + '?type=providers')
    const data = await res.json()
    return Array.isArray(data.providers) ? data.providers : []
  } catch (e) {
    return []
  }
}

async function handleProviderBadge(provider, sheetUrl) {
  const providers = await fetchProviders(sheetUrl)
  const needle = String(provider).toLowerCase()

  if (needle === 'all') {
    const svg = createBadge('PROVIDERS', String(providers.length), '#897cff')
    return svgResponse(svg)
  }

  const entry = providers.find((p) => String(p.provider || '').toLowerCase() === needle)
  const meta = statusMeta(entry ? entry.status : 'UNKNOWN')
  const svg = createBadge(String(provider).toUpperCase(), meta.label, meta.color)
  return svgResponse(svg)
}

async function handleStatusPage(sheetUrl) {
  const providers = await fetchProviders(sheetUrl)
  const rows = providers
    .map((p) => {
      const meta = statusMeta(p.status)
      const note = String(p.note || '').replace(/</g, '&lt;')
      return `<tr>
    <td><span class="dot" style="background:${meta.color}"></span>${String(p.provider || '')}</td>
    <td style="color:${meta.color};font-weight:bold">${meta.label}</td>
    <td>${note}</td>
    </tr>`
    })
    .join('')

  const html = `<!doctype html><html><head><meta charset="utf-8">
  <title>ani-web Provider Status</title>
  <style>body{background:#0d0d0d;color:#eee;font-family:sans-serif;padding:2rem}
  table{border-collapse:collapse;width:100%;max-width:600px}
  td,th{text-align:left;padding:.6rem;border-bottom:1px solid #222}
  .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:.5rem}
  h1{color:#8b5cf6}</style></head>
  <body><h1>ani-web Provider Status</h1>
  <table><tr><th>Provider</th><th>Status</th><th>Note</th></tr>${rows}</table>
  </body></html>`

  return new Response(html, {
    headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
  })
}

async function handleAllBadges(sheetUrl) {
  const providers = await fetchProviders(sheetUrl)
  const list =
    providers.length > 0 ? providers : [{ provider: 'no data', status: 'UNKNOWN', note: '' }]

  const items = list.map((p) => {
    const meta = statusMeta(p.status)
    return {
      label: String(p.provider || '').toUpperCase(),
      message: meta.label,
      color: meta.color,
    }
  })

  const svg = createMultiBadge(items)
  return svgResponse(svg)
}

function createMultiBadge(items) {
  const badgeHeight = 28
  const radius = 4
  const gapX = 6
  const gapY = 8
  const ITEMS_PER_ROW = Math.ceil(items.length / 2)

  const badges = items.map((it) => {
    const safeLabel = String(it.label ?? 'UNKNOWN')
    const safeMessage = String(it.message ?? 'UNKNOWN')
    const safeColor = String(it.color ?? '#9f9f9f')
    const labelWidth = safeLabel.length * 8 + 20
    const msgWidth = safeMessage.length * 8 + 20
    const width = labelWidth + msgWidth
    return { label: safeLabel, message: safeMessage, color: safeColor, labelWidth, msgWidth, width }
  })

  const rows = []
  for (let i = 0; i < badges.length; i += ITEMS_PER_ROW) {
    rows.push(badges.slice(i, i + ITEMS_PER_ROW))
  }

  const rowWidths = rows.map(
    (row) => row.reduce((sum, b) => sum + b.width, 0) + gapX * (row.length - 1)
  )

  const totalWidth = Math.max(...rowWidths, 0)
  const totalHeight = rows.length * badgeHeight + (rows.length - 1) * gapY

  const groups = rows
    .map((row, rowIndex) => {
      const y = rowIndex * (badgeHeight + gapY)
      const rowWidth = rowWidths[rowIndex]
      let x = (totalWidth - rowWidth) / 2

      return row
        .map((b) => {
          const labelX = b.labelWidth / 2
          const msgX = b.labelWidth + b.msgWidth / 2

          const labelPath = `M${radius} 0 L${b.labelWidth} 0 L${b.labelWidth} ${badgeHeight} L${radius} ${badgeHeight} Q0 ${badgeHeight} 0 ${badgeHeight - radius} L0 ${radius} Q0 0 ${radius} 0 Z`
          const msgPath = `M${b.labelWidth} 0 L${b.width - radius} 0 Q${b.width} 0 ${b.width} ${radius} L${b.width} ${badgeHeight - radius} Q${b.width} ${badgeHeight} ${b.width - radius} ${badgeHeight} L${b.labelWidth} ${badgeHeight} Z`

          const g = `
      <g transform="translate(${x},${y})">
      <path d="${labelPath}" fill="#555"/>
      <path d="${msgPath}" fill="${b.color}"/>
      <text x="${labelX}" y="19" fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="10" font-weight="bold" letter-spacing="0.5">${b.label}</text>
      <text x="${msgX}" y="19" fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="10" font-weight="bold" letter-spacing="0.5">${b.message}</text>
      </g>`
          x += b.width + gapX
          return g
        })
        .join('')
    })
    .join('')

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">
  ${groups}
  </svg>`
}

function createBadge(label = 'UNKNOWN', message = 'UNKNOWN', color = '#9f9f9f') {
  const height = 28
  const safeLabel = String(label ?? 'UNKNOWN')
  const safeMessage = String(message ?? 'UNKNOWN')
  const safeColor = String(color ?? '#9f9f9f')
  const labelWidth = safeLabel.length * 8 + 20
  const msgWidth = safeMessage.length * 8 + 20
  const totalWidth = labelWidth + msgWidth

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" viewBox="0 0 ${totalWidth} ${height}">
  <clipPath id="r">
  <rect width="${totalWidth}" height="${height}" rx="4" fill="#fff"/>
  </clipPath>

  <g clip-path="url(#r)">
  <rect width="${labelWidth}" height="${height}" fill="#555"/>
  <rect x="${labelWidth}" width="${msgWidth}" height="${height}" fill="${safeColor}"/>
  </g>

  <g fill="#fff" text-anchor="middle"
  font-family="Verdana,Geneva,DejaVu Sans,sans-serif"
  font-size="10" font-weight="bold"
  style="text-transform: uppercase; letter-spacing: 0.5px;">
  <text x="${labelWidth / 2}" y="19">${escapeXml(safeLabel)}</text>
  <text x="${labelWidth + msgWidth / 2}" y="19">${escapeXml(safeMessage)}</text>
  </g>
  </svg>`
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function svgResponse(svg) {
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=180, s-maxage=300, stale-while-revalidate=600',
    },
  })
}
