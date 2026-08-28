# BlackTick — Strategy Backtesting on Real Market Data

## Project Overview
- **Name**: BlackTick
- **Goal**: A browser-based backtesting platform for trading strategies, running against
  real historical market data. Strictly a backtesting tool — there is no live trading,
  no broker connection and no account to create.
- **Main features**:
  - Guided dashboard + 4-step wizard that takes a beginner from "pick a market" to a
    finished backtest report without needing to understand the terminal first
  - Real market data: Dukascopy tick-derived candles (forex, indices, stocks, commodities)
    and Binance klines (crypto). No synthetic or generated prices anywhere.
  - 13 documented strategies across JavaScript, Pine Script and Python, each with its
    entry / exit / sizing rules spelled out in plain English
  - Realistic broker model: spread, commission, leverage, margin, hedged positions,
    intrabar stop-loss / take-profit, margin call and stop-out
  - Prop-firm rule engine (FTMO-style presets + custom) evaluated on intrabar worst-case
    equity, so it is stricter than a bar-close check
  - Bar replay with manual order ticket and true step-back (broker state rewinds too)
  - Full report: KPI cards, equity curve, performance table, trade blotter with CSV export,
    monthly heat grid, prop-firm verdict with rule-usage bars
  - Built-in manual, data-sources documentation and FAQ — all in English

## URLs
- **Local dev**: http://localhost:3000
- **Sandbox preview**: https://3000-ilhy1mv9u12j9drpexji6-3c7ff1b5.sandbox.novita.ai
- **Production**: not deployed yet

### Routes
| Path | Purpose |
|---|---|
| `/` | Dashboard — home, wizard, strategy library, markets, data sources, manual, FAQ |
| `/terminal` | Chart workspace — charting, drawing tools, strategy editor, backtest report, replay |
| `/terminal?run=1` | Terminal opening with the wizard's configuration pre-applied |
| `/api/duka/<SYM>/<YYYY>[/<MM>[/<DD>]]/BID_candles_<min_1\|hour_1\|day_1>.bi5` | Dukascopy proxy, returns raw LZMA `.bi5` bytes |
| `/api/binance/klines?symbol=&interval=&limit=` | Binance klines proxy |
| `/api/health` | Health check |

## Data Architecture
- **Sources** (both real, both fetched live per backtest):
  - **Dukascopy** — `.bi5` files: LZMA-compressed, 24 bytes per candle, big-endian
    `u32 time_offset, u32 open, u32 close, u32 low, u32 high, f32 volume`. Decoded in the
    browser. Prices are BID. M1 = one file per day, H1 = per month, D1 = per year.
  - **Binance** — `data-api.binance.vision` REST klines (fallback `api.binance.com`).
- **Verification**: the decoder was cross-checked against known 2024 prices for EURUSD,
  USDJPY, XAUUSD, SPX500, NAS100, AAPL and USOIL. Method and results are documented on
  the **Data Sources** page, including a runnable Python snippet so anyone can re-verify.
- **Storage services**: none. The platform is stateless — data is fetched on demand and
  discarded. Only UI preferences, drawings and the wizard hand-off live in `localStorage`.
- **Data flow**: browser → Cloudflare Worker proxy (caches 24h at the edge) → upstream
  feed → LZMA decode + aggregation in the browser → backtest engine → report.

## User Guide
1. Open `/` — the dashboard. The home page explains the 4 steps.
2. Click **Start a backtest** to open the wizard:
   - **Step 1** pick a market and timeframe
   - **Step 2** pick a strategy (each card shows its exact rules)
   - **Step 3** set the date range, balance, leverage, spread, commission and optionally
     a prop-firm rule set
   - **Step 4** review and launch — this jumps to the terminal and runs the backtest
3. Read the report in the bottom dock: **Overview → Performance → Trades → Monthly → Prop Firm**.
4. To iterate, open the **Strategy Editor** tab, change the code, and hit **Run Backtest**.
5. To trade the chart by hand, click **Replay**, choose a start date, and step through bars
   with the order ticket.
6. The **Manual** and **FAQ** pages on the dashboard explain the engine's fill rules,
   metric definitions and common pitfalls.

## Tech Stack
- **Backend**: Hono 4 on Cloudflare Pages / Workers (proxy + page routes only)
- **Build**: Vite 8 + `@hono/vite-build`, served locally by `wrangler pages dev` under PM2
- **Charts**: TradingView Lightweight Charts 4.2.3
- **Strategy runtimes**: native JS, a custom Pine Script v5 subset interpreter, Pyodide 0.26 (+numpy)
- **Decompression**: LZMA-JS
- **Styling**: hand-written CSS design-token system (no framework)

## Project Structure
```
src/
  index.tsx              Hono app: API proxies + page routes
  pages/dashboard.ts     Dashboard markup
  pages/terminal.ts      Terminal markup
public/static/
  css/theme.css          Design tokens + shared components
  css/dashboard.css      Dashboard layout
  css/terminal.css       Chart workspace layout
  js/symbols.js          134 instruments with contract specs
  js/data.js             Feed loading, .bi5 decoding, timeframe aggregation
  js/indicators.js       TA library + indicator definitions
  js/chart.js            Chart manager
  js/drawings.js         Drawing tools
  js/engine.js           Broker model + statistics
  js/pine.js             Pine Script v5 subset interpreter
  js/strategy.js         Strategy runner + ctx API (JS / Pine / Python)
  js/strategies.js       13-strategy library
  js/replay.js           Bar replay + manual trading
  js/backtest-ui.js      Run flow + report rendering
  js/app.js              Terminal controller
  js/dashboard.js        Dashboard controller
  js/docs-content.js     Manual, data-sources doc, FAQ content
```

## Development
```bash
npm run build                      # build to dist/
pm2 start ecosystem.config.cjs     # serve on :3000
pm2 logs webapp --nostream         # check logs
curl http://localhost:3000/api/health
```

## Known Limitations
- All timestamps are UTC; no exchange-local session handling
- Intrabar order of high/low is unknown, so stops are assumed to fill before targets
  (the conservative assumption)
- No slippage, no swap/financing, no dividend adjustment on stock CFDs
- One crypto venue (Binance) — crypto results are venue-specific
- Cloudflare Workers free tier has a 10 ms CPU limit per request; all heavy computation
  runs in the browser, which is why backtests are client-side

## Deployment
- **Platform**: Cloudflare Pages
- **Status**: ❌ Not yet deployed (runs locally in the sandbox)
- **Last Updated**: 2026-08-28

## Economic Calendar (news)

Real releases from the ForexFactory calendar, proxied by the Worker so the
browser never talks to the upstream site directly.

- **Route**: `GET /api/news` — current week; `GET /api/news?month=may.2024` — a
  full historical month. Response: `{ ok, count, events[] }` where each event is
  `{ t, cur, title, impact, actual, forecast, previous, tone }`.
- **Cached** at the Cloudflare edge for 6 hours, and in-memory per month on the
  client (`NewsStore`), including negative caching for months that fail.
- **On the chart**: news markers are a second marker layer merged with the trade
  arrows, coloured by impact (red = high, amber = medium) and snapped onto the
  bar containing the release. Toggle with *Plot economic calendar* in the
  backtest dialog, or from the **News** tab in the terminal dock.
- **On the dashboard**: an Economic Calendar section shows upcoming and already
  released high/medium impact events.
- **In strategies**:
  - JavaScript — `ctx.news.minsToNext(['high'])`, `minsSinceLast`, `isNear(mins, …)`,
    `next`, `last`, `today`, `count`
  - Python — `ctx.news_mins_to_next(['high'])`, `news_mins_since_last`,
    `news_is_near`, `news_count`
  - Pine — `news.mins_to_next("high")`, `news.mins_since_last`, `news.is_near`,
    `news.count`
  All of them return `Infinity` when nothing matches, so a strategy still runs
  normally if the calendar is unreachable.

Worked examples in the library: **News Blackout Trend** (JS) and
**Post-Release Momentum** (Python).

## Mobile

`public/static/css/mobile.css` is loaded last on both pages and carries the
responsive layer:

- **≤ 1100px** — right rail hidden, grids collapse to two columns
- **≤ 780px** — the sidebar becomes an off-canvas drawer behind `#nav-toggle`
  with a scrim; the terminal topbar wraps, the tools become a scrolling strip,
  the order ticket becomes a bottom sheet, dialogs become bottom sheets, and
  wide tables scroll horizontally instead of squashing
- **≤ 420px** and `prefers-reduced-motion` refinements

Tap targets are 40–42px and inputs are 15px so iOS does not zoom on focus.

## No demo data, no accounts

- Every candle comes from Dukascopy or Binance; every calendar event from
  ForexFactory. Nothing is generated, interpolated or mocked — if the market was
  closed there is simply no bar.
- There is no login, signup or account system. All state (drawings, saved
  strategies, wizard hand-off) lives in the browser's `localStorage`.
