# BlackTick — TradingView-style Backtesting Terminal

Un terminal de backtesting în browser care combină **TradingView** (chart, unelte de desen, indicatori) cu **FXReplay** (bar replay + trading manual simulat), pe **date istorice reale**:

- **Dukascopy** (bi5/LZMA, decodat client-side) — Forex, Indici (US30, NAS100, SPX500, GER40…), Stocks (AAPL, NVDA, TSLA…), Commodities (XAUUSD, USOIL…)
- **Binance** (klines REST) — Crypto (BTCUSDT, ETHUSDT, SOLUSDT…)

**Fără bază de date, fără conturi** — totul rulează în browser; desenele se salvează în `localStorage`.

## Funcționalități

### 📈 Chart (TradingView Lightweight Charts)
- Candles verde/roșu pe temă neagră/albă, volum, 8 timeframes (1m → 1W)
- Legend OHLC live la crosshair, watchlist, căutare simboluri pe categorii
- **Indicatori**: SMA 20/50/200, EMA 20/50, Bollinger, VWAP, RSI, MACD, Stochastic, ATR

### ✏️ Unelte de desen (canvas overlay ancorat în timp/preț)
Trend line, Ray, Linie orizontală/verticală, Dreptunghi, **Fib Retracement**, Brush, Text, **Ruler** (măsurare pips/%/bare), **Long/Short Position** (RR vizual), magnet (snap la OHLC), ștergere selecție/tot. Persistență per simbol+TF.

### 🤖 Strategy Tester (boti / strategii / indicatori)
- **3 limbaje**: **JavaScript**, **Pine Script v5 (subset)** — parser+interpretor propriu (`ta.*`, `strategy.entry/exit/close`, `if/else`, serii `[n]`, `var`, ternar, `input.*`, `math.*`), **Python** real în browser via **Pyodide**
- Setări: **balanță inițială, leverage (1:1 → 1:500), interval de date (start/end), spread, comision**
- Rezultate: Overview + **equity curve**, Performance (PF, Sharpe, DD, win rate, consecutive W/L…), **List of Trades**, **Monthly breakdown** (grid an × lună, % și $ pe fiecare lună), **Prop Firm report**

### 🏦 Simulare Prop Firm (backtest + manual)
- Presets FTMO-style Phase 1 / Phase 2 / Funded + **Custom** (target %, daily loss %, max DD %, static/trailing)
- Verificare **intrabar worst-case** a daily loss și max drawdown, jurnal zilnic, status PASSED / FAILED (daily / max DD) / ACTIVE

### ⏪ Bar Replay (stil FXReplay)
- Go to date, step forward/back, play cu viteze 0.5x → 30x
- **Trading manual**: BUY/SELL cu lots, SL, TP, close all; broker simulat cu leverage, margin, stop-out 50%, spread, comisioane; markere pe chart + linii de poziție; panou cont live (balance/equity/margin/PnL) + regulile prop firm live

## Rulare locală

```bash
npm install
npm run build
npx wrangler pages dev dist --ip 0.0.0.0 --port 3000
```

## Arhitectură

```
src/index.tsx            Hono backend (Cloudflare Pages Functions)
  /api/duka/*            proxy Dukascopy .bi5 (retry + cache)
  /api/binance/klines    proxy Binance (mirror data-api.binance.vision)
public/static/js/
  symbols.js             univers simboluri + factori zecimali Dukascopy
  data.js                fetch bi5 + LZMA decode + agregare timeframe
  indicators.js          bibliotecă TA
  chart.js               Lightweight Charts manager
  drawings.js            unelte desen pe canvas overlay
  engine.js              Broker simulat + statistici + reguli prop firm
  pine.js                interpretor Pine Script v5 (subset)
  strategy.js            runner JS / Pine / Python (Pyodide) + exemple
  replay.js              bar replay + trading manual
  backtest-ui.js         UI rezultate backtest
  app.js                 bootstrap & wiring
```

### Detalii date Dukascopy
- Fișiere `.bi5` = LZMA, 24 bytes/candelă: `time_offset(u32) open close low high (u32) volume(f32)`, big-endian
- Factori zecimali: forex 1e5 (JPY: 1e3), indici/stocks/commodities 1e3
- M1: fișier pe zi · H1: fișier pe lună · D1: fișier pe an (luna/anul curent → fallback la granularitate mai fină + agregare)
- Prețurile sunt BID; ask = bid + spread configurabil

### Model broker
- Fill la close-ul barei de semnal, spread aplicat pe intrare/ieșire după direcție
- SL/TP verificate intrabar (SL prioritar — conservator), margin call/stop-out la 50%
- PnL în USD pe `lotUnits` per instrument (forex 100k/lot, indici 1/lot, stocks 100/lot…)

## Limitări cunoscute
- Pine Script = subset v5 (fără librării externe, `request.security`, arrays/matrices)
- Python: prima rulare descarcă Pyodide (~15 MB)
- Dukascopy publică datele cu ~1-2 zile întârziere; rate-limit la burst-uri (client-ul face retry cu backoff)
- Sharpe este aproximat din randamente per-bară

## Tech Stack
Hono + TypeScript (Cloudflare Pages) · TradingView Lightweight Charts · LZMA-JS · Pyodide · vanilla JS frontend

## Deployment
- **Platform**: Cloudflare Pages (sandbox dev prin `wrangler pages dev`)
- **Status**: ✅ Functional în sandbox
- **Last Updated**: 2026-08-28
