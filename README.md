# BlackTick — Backtesting Terminal

TradingView-style backtesting platform (FXReplay × TradingView), black & white UI with green/red candles, powered by **real market data** — no accounts, no database.

## Project Overview
- **Name**: BlackTick (webapp)
- **Goal**: Full backtesting terminal: strategy backtesting (bots), manual bar-replay trading, prop-firm simulation — on real historical data.
- **Data**: Dukascopy (forex, indices, stocks, commodities — decoded from raw `.bi5` LZMA files) and Binance (crypto, klines REST).

## Currently Completed Features
- **Chart**: TradingView Lightweight Charts, candlesticks (green/red), volume, black/white theme, OHLC legend, crosshair
- **Symbols (49)**: Forex majors/crosses (EURUSD…), Indices (US30, NAS100, SPX500, GER40, UK100, JPN225…), Stocks (AAPL, NVDA, TSLA, META…), Commodities (XAUUSD, USOIL…), Crypto (BTCUSDT, ETHUSDT…)
- **Timeframes**: 1m, 5m, 15m, 30m, 1H, 4H, 1D, 1W (aggregated client-side from M1/H1/D1 sources)
- **Drawing tools**: trend line, ray, horizontal/vertical line, rectangle, Fibonacci retracement, brush, text, ruler (measure), long/short position tool, magnet snap, delete — persisted per symbol+TF in localStorage
- **Indicators**: SMA/EMA (20/50/200), Bollinger Bands, VWAP, RSI, MACD, Stochastic, ATR — overlay + sub-pane
- **Strategy Tester** (bots/strategies):
  - **JavaScript** — `init()`/`bar()` API with TA library
  - **Pine Script v5 subset** — real interpreter: `ta.*`, `strategy.entry/exit/close/close_all`, `input.*`, if/else, series history `[n]`, ternary, and/or/not, math.*
  - **Python** — real Python via Pyodide (numpy included) in browser
- **Backtest settings**: initial balance, leverage (1:1 → 1:500), start/end date, spread, commission
- **Prop firm simulation**: FTMO-style Phase 1/2, Funded, or custom (profit target %, daily loss %, max DD %, static/trailing) — applies to bots AND manual replay; live rule tracking, fail/pass detection with timestamps, daily breakdown
- **Results**: overview + equity curve, full performance table (PF, Sharpe, win rate, max DD, consecutive W/L…), trade list, **monthly PnL breakdown per year**, prop firm report; trades plotted on chart as markers
- **Bar Replay** (fxreplay-style): pick date, step/play (0.5x–30x), manual BUY/SELL with lots/SL/TP, live equity/margin, position lines on chart, close-all
- **Broker model**: hedging, bid/ask spread, commission per lot, margin + 50% stop-out, intrabar SL/TP fills (conservative)

## URLs
- **Dev (sandbox)**: https://3000-idabg0su6pgo22jn0enpi-2b54fc91.sandbox.novita.ai
- **GitHub**: (pending authorization — see Deployment)

## Data Architecture
- **Dukascopy**: `/api/duka/*` proxy → raw `.bi5` LZMA files decoded **in browser** (patched LZMA-JS), big-endian 24-byte candle records, calibrated decimal factors (1e5 forex, 1e3 JPY/indices/stocks/commodities)
- **Binance**: `/api/binance/klines` proxy → `data-api.binance.vision` (works worldwide)
- **Granularity strategy**: M1 day-files for minute TFs, H1 month-files for hour TFs, D1 year-files for daily+ — with automatic fallback to finer files for the current (incomplete) month/year
- **Storage**: none (per requirement). Drawings only → localStorage
- **Backend**: Hono on Cloudflare Pages — pure proxy + static, all compute client-side

## User Guide
1. Pick a symbol (search or watchlist) and timeframe.
2. **Backtest a bot**: Strategy Editor tab → choose language (JS / Pine / Python) → pick an example or write your own → Run Backtest → set balance/leverage/dates/prop-firm → Run. Check Overview / Performance / Trades / **Monthly** / Prop Firm tabs.
3. **Manual replay**: Bar Replay → pick start date → trade with the order panel (BUY/SELL, SL/TP) while stepping/playing bars. Account & prop rules update live (gear icon to configure).
4. Draw on the chart with the left toolbar (Del removes selected).

## Deployment
- **Platform**: Cloudflare Pages (Hono + Vite)
- **Status**: ✅ running in sandbox; GitHub push pending authorization
- **Tech Stack**: Hono + TypeScript + Lightweight Charts + Pyodide + LZMA-JS
- **Local**: `npm run build && pm2 start ecosystem.config.cjs`
- **Last Updated**: 2026-08-28

## Not Yet Implemented / Next Steps
- More Pine built-ins (security(), arrays, plots rendered on chart)
- Multi-position sizing UI for strategies (risk % per trade)
- Tick-level fills (currently M1/bar-level), ask-side candles
- Export results (CSV), shareable backtest links
- Drawing tools: ellipse, pitchfork, gann; editing existing drawings by dragging points
