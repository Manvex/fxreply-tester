import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { dashboardHTML } from './pages/dashboard'
import { terminalHTML } from './pages/terminal'

const app = new Hono()

app.use('/api/*', cors())

// ---------------------------------------------------------------------------
// Dukascopy proxy — returns raw .bi5 (LZMA) bytes, decoded client-side.
// Whitelisted path shapes:
//   SYM/YYYY/MM/DD/BID_candles_min_1.bi5      (1 day of M1)
//   SYM/YYYY/MM/BID_candles_hour_1.bi5        (1 month of H1)
//   SYM/YYYY/BID_candles_day_1.bi5            (1 year of D1)
// ---------------------------------------------------------------------------
// Also allows tick files:  SYM/YYYY/MM/DD/HHh_ticks.bi5   (1 hour of raw bid/ask ticks)
const DUKA_RE = /^[A-Z0-9]{3,20}\/\d{4}(\/\d{2}(\/\d{2}\/(BID_candles_min_1\.bi5|\d{2}h_ticks\.bi5)|\/BID_candles_hour_1\.bi5)|\/BID_candles_day_1\.bi5)$/

app.get('/api/duka/*', async (c) => {
  const path = c.req.path.replace('/api/duka/', '')
  if (!DUKA_RE.test(path)) return c.json({ error: 'bad path' }, 400)

  // Try http first (fast, serves older files directly), then https;
  // retry on 503 (upstream rate limiting) with backoff.
  const attempts = [
    `http://datafeed.dukascopy.com/datafeed/${path}`,
    `https://datafeed.dukascopy.com/datafeed/${path}`,
    `https://datafeed.dukascopy.com/datafeed/${path}`,
    `https://datafeed.dukascopy.com/datafeed/${path}`,
    `https://datafeed.dukascopy.com/datafeed/${path}`,
  ]
  let lastStatus = 0
  for (let i = 0; i < attempts.length; i++) {
    try {
      const r = await fetch(attempts[i], {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
        // @ts-ignore Cloudflare cache hint
        cf: { cacheTtl: 86400, cacheEverything: true },
      })
      lastStatus = r.status
      if (r.status === 200) {
        const buf = await r.arrayBuffer()
        return new Response(buf, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'public, max-age=86400',
            'X-Duka-Size': String(buf.byteLength),
          },
        })
      }
      if (r.status === 404) {
        // no data for that day (weekend/holiday) — tell client explicitly
        return new Response(null, { status: 204, headers: { 'Cache-Control': 'public, max-age=86400' } })
      }
      // 503/301 etc → backoff then retry next attempt
      if (i < attempts.length - 1) await new Promise(res => setTimeout(res, 350 * (i + 1)))
    } catch (_e) {
      if (i < attempts.length - 1) await new Promise(res => setTimeout(res, 350 * (i + 1)))
    }
  }
  return c.json({ error: 'upstream failed', status: lastStatus }, 502)
})

// ---------------------------------------------------------------------------
// Binance proxy (spot klines) — via public data mirror, works worldwide
// ---------------------------------------------------------------------------
const BIN_INTERVALS = new Set(['1m','5m','15m','30m','1h','4h','1d','1w'])

app.get('/api/binance/klines', async (c) => {
  const q = c.req.query()
  const symbol = (q.symbol || '').toUpperCase()
  const interval = q.interval || '1h'
  if (!/^[A-Z0-9]{5,12}$/.test(symbol) || !BIN_INTERVALS.has(interval)) {
    return c.json({ error: 'bad params' }, 400)
  }
  const p = new URLSearchParams({ symbol, interval, limit: String(Math.min(parseInt(q.limit || '1000'), 1000)) })
  if (q.startTime) p.set('startTime', q.startTime)
  if (q.endTime) p.set('endTime', q.endTime)

  for (const host of ['https://data-api.binance.vision', 'https://api.binance.com']) {
    try {
      const r = await fetch(`${host}/api/v3/klines?${p}`, {
        signal: AbortSignal.timeout(12000),
        // @ts-ignore
        cf: { cacheTtl: 3600, cacheEverything: true },
      })
      if (r.ok) {
        const data = await r.text()
        if (!data.startsWith('{')) {
          return new Response(data, {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
          })
        }
      }
    } catch (_e) { /* next */ }
  }
  return c.json({ error: 'upstream failed' }, 502)
})

// ---------------------------------------------------------------------------
// Binance order-book depth archive (USD-M futures).
//   /api/binance/bookdepth?symbol=BTCUSDT&date=2025-06-02
// Upstream publishes one ZIP per symbol per day holding a CSV of
// `timestamp,percentage,depth,notional` rows: cumulative resting size at
// +/-1..5% away from mid, snapshotted roughly once a minute.
// We unzip and reshape into one compact row per snapshot so the client
// downloads ~10x less than the raw CSV.
//
// NOTE: this is depth-at-percentage-bands, NOT a full L2 ladder. Binance does
// not archive per-level book state; nothing free does. It is enough to model
// size-dependent slippage, and not enough to model limit-order queue position.
// ---------------------------------------------------------------------------
const DEPTH_PCTS = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]

// Minimal ZIP reader: these archives hold exactly one deflated entry.
async function unzipSingle(buf: ArrayBuffer): Promise<string> {
  const dv = new DataView(buf)
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error('not a zip')
  const method = dv.getUint16(8, true)
  const nameLen = dv.getUint16(26, true)
  const extraLen = dv.getUint16(28, true)
  const start = 30 + nameLen + extraLen
  const body = buf.slice(start)
  if (method === 0) return new TextDecoder().decode(body)
  if (method !== 8) throw new Error('unsupported zip method ' + method)
  const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return await new Response(stream).text()
}

app.get('/api/binance/bookdepth', async (c) => {
  const symbol = (c.req.query('symbol') || '').toUpperCase()
  const date = c.req.query('date') || ''
  if (!/^[A-Z0-9]{5,12}$/.test(symbol)) return c.json({ error: 'bad symbol' }, 400)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'bad date' }, 400)

  const url = `https://data.binance.vision/data/futures/um/daily/bookDepth/${symbol}/${symbol}-bookDepth-${date}.zip`
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      // @ts-ignore Cloudflare cache hint — these files are immutable once published
      cf: { cacheTtl: 604800, cacheEverything: true },
    })
    // 404 = no archive for that day (symbol not listed yet, or too recent).
    if (r.status === 404) {
      return c.json({ ok: true, symbol, date, levels: DEPTH_PCTS, snaps: [] }, 200, {
        'Cache-Control': 'public, max-age=3600',
      })
    }
    if (!r.ok) return c.json({ error: 'upstream ' + r.status, snaps: [] }, 502)

    const csv = await unzipSingle(await r.arrayBuffer())
    const lines = csv.split('\n')
    const colOf = new Map(DEPTH_PCTS.map((p, i) => [p, i]))
    const byTs = new Map<number, number[]>()

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      const parts = line.split(',')
      if (parts.length < 4) continue
      // "2025-06-02 00:00:10" -> unix seconds (upstream timestamps are UTC)
      const ts = Date.parse(parts[0].replace(' ', 'T') + 'Z') / 1000
      if (!Number.isFinite(ts)) continue
      const col = colOf.get(parseInt(parts[1], 10))
      if (col === undefined) continue
      let row = byTs.get(ts)
      if (!row) { row = new Array(DEPTH_PCTS.length).fill(0); byTs.set(ts, row) }
      row[col] = Math.round(parseFloat(parts[3]) || 0)
    }

    const snaps = [...byTs.entries()].sort((a, b) => a[0] - b[0]).map(([t, row]) => [t, ...row])
    return c.json({ ok: true, symbol, date, levels: DEPTH_PCTS, snaps }, 200, {
      'Cache-Control': 'public, max-age=604800',
    })
  } catch (e: any) {
    return c.json({ error: e.message || 'depth failed', snaps: [] }, 502)
  }
})

// ---------------------------------------------------------------------------
// Binance deep order book snapshot.
//   /api/binance/depth?symbol=BTCUSDT&limit=5000
// The websocket depth stream tops out at 20 levels, which on BTC covers about
// fifty dollars either side of the touch — far too narrow to show where the
// liquidity actually sits. This REST endpoint returns up to 5,000 levels per
// side, roughly +/-1% of price, which is what the heatmap needs to be worth
// looking at. Polled on an interval rather than streamed.
// ---------------------------------------------------------------------------
app.get('/api/binance/depth', async (c) => {
  const symbol = (c.req.query('symbol') || '').toUpperCase()
  const limit = Math.min(parseInt(c.req.query('limit') || '1000'), 5000)
  if (!/^[A-Z0-9]{5,12}$/.test(symbol)) return c.json({ error: 'bad symbol' }, 400)

  for (const host of ['https://data-api.binance.vision', 'https://api.binance.com']) {
    try {
      const r = await fetch(`${host}/api/v3/depth?symbol=${symbol}&limit=${limit}`, {
        signal: AbortSignal.timeout(12000),
      })
      if (r.ok) {
        const text = await r.text()
        if (!text.startsWith('{"code"')) {
          return new Response(text, {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          })
        }
      }
    } catch (_e) { /* try the next host */ }
  }
  return c.json({ error: 'upstream failed' }, 502)
})

// ---------------------------------------------------------------------------
// Binance aggregated trades.
//   /api/binance/aggtrades?symbol=BTCUSDT&startTime=..&endTime=..&limit=1000
//   /api/binance/aggtrades?symbol=BTCUSDT&fromId=..&limit=1000
// The footprint needs every print to know what traded at each price, and the
// websocket only starts at the moment you connect. This backfills the recent
// past so the panel opens with real bars instead of one column of nothing.
// ---------------------------------------------------------------------------
app.get('/api/binance/aggtrades', async (c) => {
  const q = c.req.query()
  const symbol = (q.symbol || '').toUpperCase()
  if (!/^[A-Z0-9]{5,12}$/.test(symbol)) return c.json({ error: 'bad symbol' }, 400)

  const p = new URLSearchParams({ symbol, limit: String(Math.min(parseInt(q.limit || '1000'), 1000)) })
  if (q.fromId) p.set('fromId', q.fromId)
  if (q.startTime) p.set('startTime', q.startTime)
  if (q.endTime) p.set('endTime', q.endTime)

  // The perpetual has its own tape, on its own host and path.
  const perp = c.req.query('market') === 'perp'
  const hosts = perp
    ? ['https://fapi.binance.com']
    : ['https://data-api.binance.vision', 'https://api.binance.com']
  const path = perp ? '/fapi/v1/aggTrades' : '/api/v3/aggTrades'

  for (const host of hosts) {
    try {
      const r = await fetch(`${host}${path}?${p}`, { signal: AbortSignal.timeout(15000) })
      if (r.ok) {
        const text = await r.text()
        if (text.startsWith('[')) {
          return new Response(text, {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
          })
        }
      }
    } catch (_e) { /* next host */ }
  }
  return c.json({ error: 'upstream failed' }, 502)
})

// ---------------------------------------------------------------------------
// Binance derivatives data: funding, open interest, positioning.
//   /api/binance/derivs?what=funding|oi|oihist|ratio&symbol=BTCUSDT&period=5m
// These say how the market is positioned rather than where it has been, which
// is the one thing a price series cannot tell you. Whitelisted by name so the
// endpoint cannot be pointed at arbitrary upstream paths.
// ---------------------------------------------------------------------------
const DERIV_PATHS: Record<string, string> = {
  funding: '/fapi/v1/premiumIndex',
  oi: '/fapi/v1/openInterest',
  oihist: '/futures/data/openInterestHist',
  ratio: '/futures/data/globalLongShortAccountRatio',
  taker: '/futures/data/takerlongshortRatio',
}
const DERIV_PERIODS = new Set(['5m', '15m', '30m', '1h', '4h', '1d'])

app.get('/api/binance/derivs', async (c) => {
  const q = c.req.query()
  const symbol = (q.symbol || '').toUpperCase()
  const path = DERIV_PATHS[q.what || '']
  if (!path) return c.json({ error: 'bad what' }, 400)
  if (!/^[A-Z0-9]{5,12}$/.test(symbol)) return c.json({ error: 'bad symbol' }, 400)

  const p = new URLSearchParams({ symbol })
  if (q.period) {
    if (!DERIV_PERIODS.has(q.period)) return c.json({ error: 'bad period' }, 400)
    p.set('period', q.period)
  }
  if (q.limit) p.set('limit', String(Math.min(parseInt(q.limit) || 30, 200)))

  try {
    const r = await fetch(`https://fapi.binance.com${path}?${p}`, {
      signal: AbortSignal.timeout(12000),
      // @ts-ignore short edge cache: funding moves slowly, OI is published in buckets
      cf: { cacheTtl: 30, cacheEverything: true },
    })
    if (r.ok) {
      const text = await r.text()
      if (text.startsWith('{') || text.startsWith('[')) {
        return new Response(text, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=20' },
        })
      }
    }
    return c.json({ error: 'upstream ' + r.status }, 502)
  } catch (e: any) {
    return c.json({ error: e.message || 'derivs failed' }, 502)
  }
})

app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }))

// ---------------------------------------------------------------------------
// Economic calendar (news) — real releases from ForexFactory.
//   /api/news?month=may.2024   -> that calendar month (historical or future)
//   /api/news                  -> current week
// Returns a normalised, slim payload: only what the chart needs.
// Cached hard at the edge: past months never change, upcoming ones change slowly.
// ---------------------------------------------------------------------------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.\d{4}$/

const IMPACT: Record<string, string> = {
  'High Impact Expected': 'high',
  'Medium Impact Expected': 'medium',
  'Low Impact Expected': 'low',
  'Non-Economic': 'holiday',
}

// Pull the `days: [...]` array out of the embedded calendarComponentStates blob.
function extractDays(html: string): any[] {
  const anchor = html.indexOf('calendarComponentStates[1] = {')
  if (anchor < 0) throw new Error('calendar payload not found')
  const start = html.indexOf('days: [', anchor)
  if (start < 0) throw new Error('days array not found')
  let i = start + 'days: '.length
  let depth = 0, inStr = false, esc = false
  const from = i
  for (; i < html.length; i++) {
    const ch = html[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '[') depth++
    else if (ch === ']') { depth--; if (depth === 0) { i++; break } }
  }
  return JSON.parse(html.slice(from, i))
}

app.get('/api/news', async (c) => {
  const month = c.req.query('month')
  if (month && !MONTH_RE.test(month)) return c.json({ error: 'bad month' }, 400)

  // For the current week ForexFactory publishes a plain JSON feed. Prefer it:
  // the HTML calendar is behind bot protection and now answers 403, and parsing
  // a blob out of a page was always going to rot. The month view has no JSON
  // equivalent, so historical ranges still go through the scrape.
  if (!month) {
    try {
      const r = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(12000),
        cf: { cacheTtl: 900, cacheEverything: true },
      } as RequestInit)
      if (r.ok) {
        const rows = await r.json() as any[]
        if (Array.isArray(rows) && rows.length) {
          const events = rows.map(e => ({
            t: Math.floor(Date.parse(e.date) / 1000),
            cur: e.country === 'All' ? '' : (e.country || ''),
            title: e.title || '',
            impact: String(e.impact || '').toLowerCase() === 'high' ? 'high'
              : String(e.impact || '').toLowerCase() === 'medium' ? 'medium'
              : String(e.impact || '').toLowerCase() === 'holiday' ? 'holiday' : 'low',
            actual: '', forecast: e.forecast || '', previous: e.previous || '', tone: '',
          })).filter(e => Number.isFinite(e.t)).sort((a, b) => a.t - b.t)
          return c.json({ ok: true, month: 'this-week', source: 'ff-json', count: events.length, events },
            200, { 'Cache-Control': 'public, max-age=900' })
        }
      }
    } catch (_e) { /* fall through to the scrape */ }
  }

  const url = month
    ? `https://www.forexfactory.com/calendar?month=${month}`
    : 'https://www.forexfactory.com/calendar?week=this'

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      cf: { cacheTtl: 21600, cacheEverything: true },
    } as RequestInit)
    if (!r.ok) return c.json({ error: 'upstream ' + r.status, events: [] }, 502)

    const days = extractDays(await r.text())
    const events: any[] = []
    for (const d of days) {
      for (const e of (d.events || [])) {
        if (!e.dateline) continue
        events.push({
          t: e.dateline,                              // unix seconds, UTC
          cur: e.currency || '',
          title: e.name || '',
          impact: IMPACT[e.impactTitle] || 'low',
          actual: e.actual || '',
          forecast: e.forecast || '',
          previous: e.previous || '',
          // 'better'/'worse'/'' — FF's own read on actual vs forecast
          tone: e.actualBetterWorse === 1 ? 'better' : e.actualBetterWorse === -1 ? 'worse' : '',
        })
      }
    }
    events.sort((a, b) => a.t - b.t)
    return c.json({ ok: true, month: month || 'this-week', count: events.length, events }, 200, {
      'Cache-Control': 'public, max-age=10800',
    })
  } catch (e: any) {
    return c.json({ error: e.message || 'parse failed', events: [] }, 502)
  }
})

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
app.get('/', (c) => c.html(dashboardHTML))
app.get('/terminal', (c) => c.html(terminalHTML))

export default app
