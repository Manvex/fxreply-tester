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
const DUKA_RE = /^[A-Z0-9]{3,20}\/\d{4}(\/\d{2}(\/\d{2}\/BID_candles_min_1\.bi5|\/BID_candles_hour_1\.bi5)|\/BID_candles_day_1\.bi5)$/

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

app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }))

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
app.get('/', (c) => c.html(dashboardHTML))
app.get('/terminal', (c) => c.html(terminalHTML))

export default app
