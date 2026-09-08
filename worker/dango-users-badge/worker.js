const STATUS_META = {
  OK: { color: "#4c1", label: "OK" },
  ISSUES: { color: "#dfb317", label: "ISSUES" },
  DOWN: { color: "#e05d44", label: "DOWN" },
  UNKNOWN: { color: "#9f9f9f", label: "UNKNOWN" },
};

function statusMeta(status) {
  const key = String(status || "").toUpperCase();
  return STATUS_META[key] || STATUS_META.UNKNOWN;
}

export default {
  async fetch(request, env) {
    const sheetUrl = env.GOOGLE_SHEETS_URL;
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider");
    const view = url.searchParams.get("view");

    if (provider) return await handleProviderBadge(provider, sheetUrl);
    if (view === "all") return await handleAllBadges(sheetUrl);
    if (view === "status") return await handleStatusPage(sheetUrl);

    return await handleUsersBadge(sheetUrl);
  },
};

async function handleUsersBadge(sheetUrl) {
  const response = await fetch(sheetUrl);
  const data = await response.json();

  const active = data.active ?? 0;
  const total = data.total ?? 0;

  const label = "USERS";
  const message = `ACTIVE:${active} | TOTAL:${total}`;

  const svg = createBadge(label, message, "#897cff");

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

async function fetchProviders(sheetUrl) {
  try {
    const res = await fetch(sheetUrl + "?type=providers");
    const data = await res.json();
    return Array.isArray(data.providers) ? data.providers : [];
  } catch (e) {
    return [];
  }
}

async function handleProviderBadge(provider, sheetUrl) {
  const providers = await fetchProviders(sheetUrl);
  const needle = String(provider).toLowerCase();

  if (needle === "all") {
    const meta = overallStatus(providers);
    const svg = createBadge("PROVIDERS", meta.label, meta.color);
    return svgResponse(svg);
  }

  const entry = providers.find(
    (p) => String(p.provider || "").toLowerCase() === needle
  );
  const meta = statusMeta(entry ? entry.status : "UNKNOWN");
  const svg = createBadge(String(provider).toUpperCase(), meta.label, meta.color);
  return svgResponse(svg);
}

function overallStatus(providers) {
  const statuses = providers.map((p) =>
    String(p.status || "").toUpperCase()
  );
  if (statuses.includes("DOWN")) return STATUS_META.DOWN;
  if (statuses.includes("ISSUES")) return STATUS_META.ISSUES;
  if (statuses.length === 0) return STATUS_META.UNKNOWN;
  return STATUS_META.OK;
}

async function handleStatusPage(sheetUrl) {
  const providers = await fetchProviders(sheetUrl);
  const rows = providers
    .map((p) => {
      const meta = statusMeta(p.status);
      const note = String(p.note || "").replace(/</g, "&lt;");
      return `<tr>
        <td><span class="dot" style="background:${meta.color}"></span>${String(
        p.provider || ""
      )}</td>
        <td style="color:${meta.color};font-weight:bold">${meta.label}</td>
        <td>${note}</td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8">
    <title>ani-web Provider Status</title>
    <style>body{background:#0d0d0d;color:#eee;font-family:sans-serif;padding:2rem}
    table{border-collapse:collapse;width:100%;max-width:600px}
    td,th{text-align:left;padding:.6rem;border-bottom:1px solid #222}
    .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:.5rem}
    h1{color:#8b5cf6}</style></head>
    <body><h1>ani-web Provider Status</h1>
    <table><tr><th>Provider</th><th>Status</th><th>Note</th></tr>${rows}</table>
    </body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
  });
}

async function handleAllBadges(sheetUrl) {
  const providers = await fetchProviders(sheetUrl);
  console.log("handleAllBadges providers:", JSON.stringify(providers));
  const list =
    providers.length > 0
      ? providers
      : [{ provider: "no data", status: "UNKNOWN", note: "" }];

  const items = list.map((p) => {
    const meta = statusMeta(p.status);
    return {
      label: String(p.provider || "").toUpperCase(),
      message: meta.label,
      color: meta.color,
    };
  });

  const svg = createMultiBadge(items);
  console.log("handleAllBadges svg length:", svg.length);
  return svgResponse(svg);
}

function createMultiBadge(items) {
  const height = 28;
  const radius = 4;
  const gap = 6;

  const badges = items.map((it) => {
    const labelWidth = it.label.length * 8 + 20;
    const msgWidth = it.message.length * 8 + 20;
    const width = labelWidth + msgWidth;
    return { ...it, labelWidth, msgWidth, width };
  });

  const totalWidth =
    badges.reduce((sum, b) => sum + b.width, 0) + gap * (badges.length - 1);

  let x = 0;
  const groups = badges
    .map((b) => {
      const labelX = b.labelWidth / 2;
      const msgX = b.labelWidth + b.msgWidth / 2;

      const labelPath = `M${radius} 0 L${b.labelWidth} 0 L${b.labelWidth} ${height} L${radius} ${height} Q0 ${height} 0 ${height - radius} L0 ${radius} Q0 0 ${radius} 0 Z`;
      const msgPath = `M${b.labelWidth} 0 L${b.width - radius} 0 Q${b.width} 0 ${b.width} ${radius} L${b.width} ${height - radius} Q${b.width} ${height} ${b.width - radius} ${height} L${b.labelWidth} ${height} Z`;

      const g = `
  <g transform="translate(${x},0)">
    <path d="${labelPath}" fill="#555"/>
    <path d="${msgPath}" fill="${b.color}"/>
    <text x="${labelX}" y="19" fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="10" font-weight="bold" letter-spacing="0.5">${b.label}</text>
    <text x="${msgX}" y="19" fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="10" font-weight="bold" letter-spacing="0.5">${b.message}</text>
  </g>`;
      x += b.width + gap;
      return g;
    })
    .join("");

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}">
  ${groups}
</svg>`;
}

function createBadge(label, message, color) {
  const height = 28;
  const labelWidth = label.length * 8 + 20; 
  const msgWidth = message.length * 8 + 20;
  const totalWidth = labelWidth + msgWidth;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}">

  <clipPath id="r">
    <rect width="${totalWidth}" height="${height}" rx="4" fill="#fff"/>
  </clipPath>

  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="${height}" fill="#555"/>
    <rect x="${labelWidth}" width="${msgWidth}" height="${height}" fill="${color}"/>
    <rect width="${totalWidth}" height="${height}" fill="url(#s)"/>
  </g>

  <g fill="#fff" text-anchor="middle"
     font-family="Verdana,Geneva,DejaVu Sans,sans-serif"
     font-size="10" font-weight="bold"
     style="text-transform: uppercase; letter-spacing: 0.5px;">

    <text x="${labelWidth / 2}" y="19">${label}</text>
    <text x="${labelWidth + msgWidth / 2}" y="19">${message}</text>
  </g>
</svg>`;
}

function svgResponse(svg) {
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}