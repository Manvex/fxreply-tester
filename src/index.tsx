import { Hono } from 'hono'
import { cors } from 'hono/cors'

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
// Main page
// ---------------------------------------------------------------------------
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BlackTick — Backtesting Terminal</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='black'/><path d='M6 14l4-5 4 3 4-6' stroke='white' stroke-width='2' fill='none'/></svg>">
<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"></script>
<script src="/static/lzma.js"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.2/css/all.min.css" rel="stylesheet">
<link href="/static/css/app.css" rel="stylesheet">
</head>
<body>
<div id="app-root">

  <!-- ======================= TOP TOOLBAR ======================= -->
  <header id="topbar">
    <div class="tb-left">
      <div id="logo"><i class="fa-solid fa-chart-line"></i> <span>BlackTick</span></div>
      <button id="symbol-btn" class="tb-btn" title="Symbol Search"><i class="fa-solid fa-magnifying-glass"></i><span id="symbol-label">EURUSD</span></button>
      <div class="tb-sep"></div>
      <div id="tf-group">
        <button class="tf-btn" data-tf="1m">1m</button>
        <button class="tf-btn" data-tf="5m">5m</button>
        <button class="tf-btn" data-tf="15m">15m</button>
        <button class="tf-btn" data-tf="30m">30m</button>
        <button class="tf-btn active" data-tf="1h">1H</button>
        <button class="tf-btn" data-tf="4h">4H</button>
        <button class="tf-btn" data-tf="1d">1D</button>
        <button class="tf-btn" data-tf="1w">1W</button>
      </div>
      <div class="tb-sep"></div>
      <button id="indicators-btn" class="tb-btn"><i class="fa-solid fa-flask"></i><span>Indicators</span></button>
      <div class="tb-sep"></div>
      <button id="replay-btn" class="tb-btn"><i class="fa-solid fa-clock-rotate-left"></i><span>Bar Replay</span></button>
      <button id="backtest-btn" class="tb-btn accent"><i class="fa-solid fa-robot"></i><span>Strategy Tester</span></button>
    </div>
    <div class="tb-right">
      <div id="range-info"></div>
      <div id="acct-chip" title="Simulated account">
        <span class="chip-label">Balance</span><span id="chip-balance">$100,000</span>
        <span class="chip-label">Equity</span><span id="chip-equity">$100,000</span>
        <span class="chip-label">PnL</span><span id="chip-pnl" class="flat">$0.00</span>
      </div>
      <button id="acct-settings-btn" class="tb-btn" title="Account & Prop Firm settings"><i class="fa-solid fa-gear"></i></button>
    </div>
  </header>

  <div id="main-row">
    <!-- ======================= LEFT DRAWING TOOLBAR ======================= -->
    <nav id="left-toolbar">
      <button class="draw-btn active" data-tool="cursor" title="Cursor"><i class="fa-solid fa-arrow-pointer"></i></button>
      <button class="draw-btn" data-tool="crosshair" title="Crosshair"><i class="fa-solid fa-plus"></i></button>
      <div class="lt-sep"></div>
      <button class="draw-btn" data-tool="trendline" title="Trend Line"><i class="fa-solid fa-slash"></i></button>
      <button class="draw-btn" data-tool="ray" title="Ray"><i class="fa-solid fa-arrow-trend-up"></i></button>
      <button class="draw-btn" data-tool="hline" title="Horizontal Line"><i class="fa-solid fa-grip-lines"></i></button>
      <button class="draw-btn" data-tool="vline" title="Vertical Line"><i class="fa-solid fa-grip-lines-vertical"></i></button>
      <button class="draw-btn" data-tool="rect" title="Rectangle"><i class="fa-regular fa-square"></i></button>
      <button class="draw-btn" data-tool="fib" title="Fib Retracement"><i class="fa-solid fa-bars-staggered"></i></button>
      <button class="draw-btn" data-tool="brush" title="Brush"><i class="fa-solid fa-paintbrush"></i></button>
      <button class="draw-btn" data-tool="text" title="Text"><i class="fa-solid fa-font"></i></button>
      <button class="draw-btn" data-tool="ruler" title="Measure"><i class="fa-solid fa-ruler"></i></button>
      <button class="draw-btn" data-tool="longpos" title="Long Position"><i class="fa-solid fa-arrow-up-long" style="color:var(--green)"></i></button>
      <button class="draw-btn" data-tool="shortpos" title="Short Position"><i class="fa-solid fa-arrow-down-long" style="color:var(--red)"></i></button>
      <div class="lt-sep"></div>
      <button class="draw-btn" id="magnet-btn" title="Magnet (snap to OHLC)"><i class="fa-solid fa-magnet"></i></button>
      <button class="draw-btn" id="del-last-btn" title="Delete selected (Del)"><i class="fa-solid fa-eraser"></i></button>
      <button class="draw-btn" id="del-all-btn" title="Delete all drawings"><i class="fa-solid fa-trash"></i></button>
    </nav>

    <!-- ======================= CHART AREA ======================= -->
    <div id="chart-zone">
      <div id="chart-wrap">
        <div id="chart-container"></div>
        <canvas id="draw-canvas"></canvas>
        <div id="chart-legend"></div>
        <div id="chart-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading data…</div>
        <!-- Replay controls -->
        <div id="replay-bar" class="hidden">
          <button id="rp-step-back" title="Step back"><i class="fa-solid fa-backward-step"></i></button>
          <button id="rp-play" title="Play/Pause"><i class="fa-solid fa-play"></i></button>
          <button id="rp-step" title="Step forward"><i class="fa-solid fa-forward-step"></i></button>
          <select id="rp-speed">
            <option value="2000">0.5x</option><option value="1000" selected>1x</option>
            <option value="500">2x</option><option value="200">5x</option><option value="100">10x</option><option value="33">30x</option>
          </select>
          <span id="rp-time"></span>
          <button id="rp-goto" class="rp-text-btn">Go to date…</button>
          <button id="rp-exit" class="rp-text-btn danger">Exit Replay</button>
        </div>
        <!-- Manual trade panel (replay) -->
        <div id="trade-panel" class="hidden">
          <div class="tp-head">Order <i class="fa-solid fa-xmark" id="tp-close"></i></div>
          <div class="tp-row"><label>Size (lots)</label><input id="tp-size" type="number" value="1" min="0.01" step="0.01"></div>
          <div class="tp-row"><label>SL (price)</label><input id="tp-sl" type="number" placeholder="optional" step="any"></div>
          <div class="tp-row"><label>TP (price)</label><input id="tp-tp" type="number" placeholder="optional" step="any"></div>
          <div class="tp-btns">
            <button id="tp-sell" class="sell-btn">SELL<span id="tp-bid">—</span></button>
            <button id="tp-buy" class="buy-btn">BUY<span id="tp-ask">—</span></button>
          </div>
          <button id="tp-closeall" class="tp-closeall">Close All Positions</button>
        </div>
      </div>

      <!-- ======================= BOTTOM PANEL ======================= -->
      <div id="bottom-panel">
        <div id="bp-tabs">
          <button class="bp-tab active" data-tab="tester">Strategy Tester</button>
          <button class="bp-tab" data-tab="positions">Positions & History</button>
          <button class="bp-tab" data-tab="editor">Strategy Editor</button>
          <span id="bp-status"></span>
          <button id="bp-collapse" title="Collapse"><i class="fa-solid fa-chevron-down"></i></button>
        </div>
        <div id="bp-content">
          <!-- Strategy tester tab -->
          <div class="bp-page active" data-page="tester">
            <div id="tester-empty">
              <i class="fa-solid fa-robot"></i>
              <p>Configure a backtest: pick a strategy in <b>Strategy Editor</b>, set account &amp; dates, then press <b>Run Backtest</b>.</p>
              <button id="tester-run-shortcut" class="accent-btn"><i class="fa-solid fa-play"></i> Open Backtest Settings</button>
            </div>
            <div id="tester-results" class="hidden">
              <div id="tr-subtabs">
                <button class="tr-subtab active" data-sub="overview">Overview</button>
                <button class="tr-subtab" data-sub="performance">Performance</button>
                <button class="tr-subtab" data-sub="trades">List of Trades</button>
                <button class="tr-subtab" data-sub="monthly">Monthly</button>
                <button class="tr-subtab" data-sub="propfirm">Prop Firm</button>
              </div>
              <div class="tr-page active" data-trpage="overview">
                <div id="ov-stats"></div>
                <div id="equity-chart"></div>
              </div>
              <div class="tr-page" data-trpage="performance"><div id="perf-table"></div></div>
              <div class="tr-page" data-trpage="trades"><div id="trades-table"></div></div>
              <div class="tr-page" data-trpage="monthly"><div id="monthly-table"></div></div>
              <div class="tr-page" data-trpage="propfirm"><div id="propfirm-report"></div></div>
            </div>
          </div>
          <!-- Positions tab -->
          <div class="bp-page" data-page="positions">
            <div id="positions-wrap">
              <h4>Open Positions</h4>
              <div id="open-positions-table"></div>
              <h4>Closed Trades</h4>
              <div id="closed-trades-table"></div>
            </div>
          </div>
          <!-- Editor tab -->
          <div class="bp-page" data-page="editor">
            <div id="editor-wrap">
              <div id="editor-toolbar">
                <select id="strategy-lang">
                  <option value="js">JavaScript</option>
                  <option value="pine">Pine Script (subset)</option>
                  <option value="python">Python (Pyodide)</option>
                </select>
                <select id="strategy-example"></select>
                <button id="editor-validate" class="tb-btn"><i class="fa-solid fa-check"></i> Validate</button>
                <button id="editor-run" class="accent-btn"><i class="fa-solid fa-play"></i> Run Backtest</button>
                <span id="editor-msg"></span>
              </div>
              <textarea id="strategy-code" spellcheck="false"></textarea>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ======================= RIGHT SIDEBAR ======================= -->
    <aside id="right-sidebar">
      <div id="watchlist-head">WATCHLIST <i class="fa-solid fa-magnifying-glass" id="wl-search-ico"></i></div>
      <div id="watchlist"></div>
      <div id="acct-panel">
        <div class="ap-head">ACCOUNT</div>
        <div class="ap-grid">
          <span>Balance</span><b id="ap-balance">$100,000.00</b>
          <span>Equity</span><b id="ap-equity">$100,000.00</b>
          <span>Margin Used</span><b id="ap-margin">$0.00</b>
          <span>Free Margin</span><b id="ap-free">$100,000.00</b>
          <span>Leverage</span><b id="ap-leverage">1:100</b>
          <span>Open PnL</span><b id="ap-pnl">$0.00</b>
        </div>
        <div id="ap-propfirm" class="hidden">
          <div class="ap-head warn">PROP FIRM RULES</div>
          <div class="ap-grid">
            <span>Daily Loss</span><b id="pf-daily">—</b>
            <span>Max Drawdown</span><b id="pf-maxdd">—</b>
            <span>Profit Target</span><b id="pf-target">—</b>
            <span>Status</span><b id="pf-status" class="ok">ACTIVE</b>
          </div>
        </div>
      </div>
    </aside>
  </div>
</div>

<!-- ======================= MODALS ======================= -->
<div id="modal-backdrop" class="hidden"></div>

<div id="symbol-modal" class="modal hidden">
  <div class="modal-head">Symbol Search <i class="fa-solid fa-xmark modal-close"></i></div>
  <input id="symbol-search-input" placeholder="Search: EURUSD, BTC, NAS100, AAPL…" autocomplete="off">
  <div id="symbol-cats">
    <button class="sc-btn active" data-cat="all">All</button>
    <button class="sc-btn" data-cat="forex">Forex</button>
    <button class="sc-btn" data-cat="indices">Indices</button>
    <button class="sc-btn" data-cat="stocks">Stocks</button>
    <button class="sc-btn" data-cat="crypto">Crypto</button>
    <button class="sc-btn" data-cat="commodities">Commodities</button>
  </div>
  <div id="symbol-list"></div>
</div>

<div id="indicators-modal" class="modal hidden">
  <div class="modal-head">Indicators <i class="fa-solid fa-xmark modal-close"></i></div>
  <div id="indicators-list"></div>
  <div class="modal-sub">Active</div>
  <div id="active-indicators"></div>
</div>

<div id="backtest-modal" class="modal hidden">
  <div class="modal-head">Backtest Settings <i class="fa-solid fa-xmark modal-close"></i></div>
  <div class="bm-grid">
    <label>Initial Balance ($)</label><input id="bt-balance" type="number" value="100000" min="10">
    <label>Leverage</label>
    <select id="bt-leverage">
      <option value="1">1:1</option><option value="5">1:5</option><option value="10">1:10</option>
      <option value="20">1:20</option><option value="30">1:30</option><option value="50">1:50</option>
      <option value="100" selected>1:100</option><option value="200">1:200</option><option value="500">1:500</option>
    </select>
    <label>Start Date</label><input id="bt-start" type="date" value="2024-01-01">
    <label>End Date</label><input id="bt-end" type="date" value="2024-06-30">
    <label>Spread (pips/pts)</label><input id="bt-spread" type="number" value="0.5" step="0.1" min="0">
    <label>Commission ($/lot/side)</label><input id="bt-commission" type="number" value="3.5" step="0.5" min="0">
    <label>Prop Firm Mode</label>
    <select id="bt-propfirm">
      <option value="none">Off — normal account</option>
      <option value="ftmo1">FTMO-style Phase 1 (target 10%, daily 5%, max 10%)</option>
      <option value="ftmo2">FTMO-style Phase 2 (target 5%, daily 5%, max 10%)</option>
      <option value="funded">Funded (no target, daily 5%, max 10%)</option>
      <option value="custom">Custom…</option>
    </select>
    <div id="pf-custom" class="hidden pf-custom-grid">
      <label>Profit target %</label><input id="pf-c-target" type="number" value="10" step="0.5">
      <label>Daily loss %</label><input id="pf-c-daily" type="number" value="5" step="0.5">
      <label>Max drawdown %</label><input id="pf-c-max" type="number" value="10" step="0.5">
      <label>DD type</label><select id="pf-c-ddtype"><option value="static">Static (from initial)</option><option value="trailing">Trailing (from peak)</option></select>
    </div>
  </div>
  <div class="modal-actions">
    <button id="bt-run" class="accent-btn big"><i class="fa-solid fa-play"></i> Run Backtest on <span id="bt-symbol-label">EURUSD</span> (<span id="bt-tf-label">1H</span>)</button>
  </div>
  <div id="bt-progress" class="hidden"><div id="bt-progress-fill"></div><span id="bt-progress-text">0%</span></div>
</div>

<div id="acct-modal" class="modal hidden">
  <div class="modal-head">Account & Prop Firm (Manual / Replay) <i class="fa-solid fa-xmark modal-close"></i></div>
  <div class="bm-grid">
    <label>Balance ($)</label><input id="am-balance" type="number" value="100000">
    <label>Leverage</label>
    <select id="am-leverage">
      <option value="1">1:1</option><option value="10">1:10</option><option value="30">1:30</option>
      <option value="50">1:50</option><option value="100" selected>1:100</option><option value="200">1:200</option><option value="500">1:500</option>
    </select>
    <label>Spread (pips/pts)</label><input id="am-spread" type="number" value="0.5" step="0.1">
    <label>Commission ($/lot/side)</label><input id="am-commission" type="number" value="3.5" step="0.5">
    <label>Prop Firm Mode</label>
    <select id="am-propfirm">
      <option value="none">Off</option>
      <option value="ftmo1">FTMO-style Phase 1</option>
      <option value="ftmo2">FTMO-style Phase 2</option>
      <option value="funded">Funded</option>
    </select>
  </div>
  <div class="modal-actions"><button id="am-apply" class="accent-btn big">Apply & Reset Account</button></div>
</div>

<div id="goto-modal" class="modal hidden">
  <div class="modal-head">Go to date <i class="fa-solid fa-xmark modal-close"></i></div>
  <div class="bm-grid"><label>Date</label><input id="goto-date" type="date"></div>
  <div class="modal-actions"><button id="goto-apply" class="accent-btn big">Start Replay Here</button></div>
</div>

<script src="/static/js/symbols.js"></script>
<script src="/static/js/data.js"></script>
<script src="/static/js/indicators.js"></script>
<script src="/static/js/chart.js"></script>
<script src="/static/js/drawings.js"></script>
<script src="/static/js/engine.js"></script>
<script src="/static/js/pine.js"></script>
<script src="/static/js/strategy.js"></script>
<script src="/static/js/replay.js"></script>
<script src="/static/js/backtest-ui.js"></script>
<script src="/static/js/app.js"></script>
</body>
</html>`)
})

export default app
