// Dashboard / landing page — the starting point of the platform.
export const dashboardHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BlackTick — Strategy Backtesting on Real Market Data</title>
<meta name="description" content="Backtest trading strategies on real Dukascopy and Binance market data. JavaScript, Pine Script and Python. Prop-firm rule simulation included.">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%230b0d10'/><path d='M6 21l6-7 5 4 9-11' stroke='%234dd4c0' stroke-width='2.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0b0d10">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="BlackTick">
<link rel="apple-touch-icon" href="/static/icons/icon-192.png">
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.2/css/all.min.css" rel="stylesheet">
<link href="/static/css/theme.css" rel="stylesheet">
<link href="/static/css/dashboard.css" rel="stylesheet">
<link href="/static/css/livecrypto.css" rel="stylesheet">
<link href="/static/css/mobile.css" rel="stylesheet">
</head>
<body>
<div id="shell">

  <!-- ======================== MOBILE TOP BAR ======================== -->
  <header id="mobile-bar">
    <button id="nav-toggle" aria-label="Open menu"><i class="fa-solid fa-bars"></i></button>
    <div class="mb-brand"><span class="brand-mark"><i class="fa-solid fa-chart-line"></i></span> BlackTick</div>
    <a class="mb-cta" href="/terminal" aria-label="Open terminal"><i class="fa-solid fa-chart-candlestick"></i></a>
  </header>
  <div id="nav-scrim"></div>

  <!-- ============================== SIDEBAR ============================== -->
  <nav id="sidenav">
    <div class="nav-brand">
      <span class="brand-mark"><i class="fa-solid fa-chart-line"></i></span>
      <span class="brand-text"><b>BlackTick</b><small>Backtesting</small></span>
    </div>

    <div class="nav-group">
      <div class="eyebrow">Workspace</div>
      <button class="nav-item active" data-nav="home"><i class="fa-solid fa-house"></i><span>Dashboard</span></button>
      <button class="nav-item" data-nav="wizard"><i class="fa-solid fa-wand-magic-sparkles"></i><span>New Backtest</span><span class="pill pill-brand nav-badge">Guided</span></button>
      <button class="nav-item" data-nav="strategies"><i class="fa-solid fa-code-branch"></i><span>Strategy Library</span></button>
      <button class="nav-item" data-nav="live"><i class="fa-solid fa-bolt"></i><span>Live Crypto</span><span class="pill pill-brand nav-badge">Live</span></button>
      <button class="nav-item" data-nav="markets"><i class="fa-solid fa-globe"></i><span>Markets</span></button>
    </div>

    <div class="nav-group">
      <div class="eyebrow">Learn</div>
      <button class="nav-item" data-nav="docs"><i class="fa-solid fa-book-open"></i><span>Manual</span></button>
      <button class="nav-item" data-nav="data"><i class="fa-solid fa-database"></i><span>Data Sources</span></button>
      <button class="nav-item" data-nav="faq"><i class="fa-solid fa-circle-question"></i><span>FAQ</span></button>
    </div>

    <div class="nav-group">
      <div class="eyebrow">Terminal</div>
      <a class="nav-item" href="/terminal"><i class="fa-solid fa-chart-candlestick"></i><span>Open Chart Terminal</span><i class="fa-solid fa-arrow-up-right-from-square" style="margin-left:auto;font-size:10px"></i></a>
    </div>

    <div class="nav-foot">
      <div class="data-status" id="data-status">
        <span class="dot warn" id="ds-dot"></span>
        <span id="ds-text">Checking data feeds…</span>
      </div>
    </div>
  </nav>

  <!-- ============================== MAIN ============================== -->
  <main id="main">

    <!-- ------------------------------ HOME ------------------------------ -->
    <section class="page active" data-page="home">
      <div class="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>A backtesting workbench built on real historical market data. Write a strategy, run it over years of price history, and see exactly how it would have performed — trade by trade.</p>
        </div>
        <div class="page-head-actions">
          <button class="btn btn-outline" data-goto="docs"><i class="fa-solid fa-book-open"></i> Read the manual</button>
          <button class="btn btn-primary btn-lg" data-goto="wizard"><i class="fa-solid fa-wand-magic-sparkles"></i> Start a backtest</button>
        </div>
      </div>

      <div class="page-body">

        <!-- Quick launcher — type a symbol, go straight to the chart -->
        <div class="launcher">
          <i class="fa-solid fa-magnifying-glass lc-ico"></i>
          <input id="lc-input" type="text" autocomplete="off" spellcheck="false"
                 placeholder="Search any instrument — EURUSD, BTCUSDT, NAS100, AAPL…">
          <button class="btn btn-primary" id="lc-go"><i class="fa-solid fa-chart-candlestick"></i> Open</button>
        </div>
        <div class="lc-results" id="lc-results"></div>

        <!-- Hero -->
        <div class="hero">
          <div class="hero-inner">
            <span class="pill pill-brand"><i class="fa-solid fa-circle-check"></i> Real data · no simulated prices</span>
            <h2>From idea to verified track record in four steps</h2>
            <p>Every candle you test against was recorded by a real exchange or liquidity provider. Nothing here is generated or interpolated — if the market was closed, there is no bar.</p>
            <div class="hero-actions">
              <button class="btn btn-primary btn-lg" data-goto="wizard"><i class="fa-solid fa-play"></i> Guided backtest</button>
              <a class="btn btn-outline btn-lg" href="/terminal"><i class="fa-solid fa-chart-candlestick"></i> Jump into the terminal</a>
            </div>
            <div class="steps">
              <div class="step"><div class="step-n">1</div><b>Pick a market</b><span>Search ~1,500 instruments — the entire Dukascopy universe plus Binance crypto.</span></div>
              <div class="step"><div class="step-n">2</div><b>Pick a strategy</b><span>A documented library, or write your own in JS, Pine or Python.</span></div>
              <div class="step"><div class="step-n">3</div><b>Set the account</b><span>Balance, leverage, spread, commission — and optional prop-firm limits.</span></div>
              <div class="step"><div class="step-n">4</div><b>Read the report</b><span>Equity curve, every trade, monthly returns, drawdown, rule breaches.</span></div>
            </div>
          </div>
        </div>

        <!-- Stats -->
        <div class="section">
          <div class="section-head"><h2><i class="fa-solid fa-gauge-high"></i> What's in the box</h2></div>
          <div class="stat-grid">
            <div class="stat accent">
              <div class="stat-label">Instruments</div>
              <div class="stat-value" id="stat-syms">~1,500</div>
              <div class="stat-sub">The full Dukascopy universe — forex · indices · stocks · ETFs · commodities · bonds — plus Binance crypto</div>
            </div>
            <div class="stat">
              <div class="stat-label">History depth</div>
              <div class="stat-value">2003<span style="font-size:15px;color:var(--t-3)">&nbsp;→ today</span></div>
              <div class="stat-sub">Minute-resolution archives for major pairs</div>
            </div>
            <div class="stat">
              <div class="stat-label">Strategy languages</div>
              <div class="stat-value">3</div>
              <div class="stat-sub">JavaScript · Pine Script v5 subset · Python + numpy</div>
            </div>
            <div class="stat">
              <div class="stat-label">Ready-made strategies</div>
              <div class="stat-value" id="stat-strats">12</div>
              <div class="stat-sub">Fully documented entry, exit and sizing rules</div>
            </div>
            <div class="stat">
              <div class="stat-label">Timeframes</div>
              <div class="stat-value">8</div>
              <div class="stat-sub">1m · 5m · 15m · 30m · 1H · 4H · 1D · 1W</div>
            </div>
            <div class="stat">
              <div class="stat-label">Prop-firm presets</div>
              <div class="stat-value">4</div>
              <div class="stat-sub">Daily loss, max drawdown, profit target enforcement</div>
            </div>
          </div>
        </div>

        <!-- Feature cards -->
        <div class="section">
          <div class="section-head">
            <h2><i class="fa-solid fa-layer-group"></i> Core capabilities</h2>
          </div>
          <div class="strat-grid">
            <article class="strat-card">
              <div class="sc-head"><h4><i class="fa-solid fa-microscope" style="color:var(--brand)"></i> Honest fill model</h4></div>
              <p class="sc-desc">Market orders fill at the close of the signal bar, spread is charged by direction, and when both stop and target sit inside one bar the <b>stop wins</b>. You get the pessimistic answer, not the flattering one.</p>
              <div class="sc-foot"><span class="pill">Conservative</span><span class="pill">Hedging account</span></div>
            </article>
            <article class="strat-card">
              <div class="sc-head"><h4><i class="fa-solid fa-shield-halved" style="color:var(--warn)"></i> Prop-firm simulator</h4></div>
              <p class="sc-desc">Daily loss and maximum drawdown are checked against the <b>worst price inside every bar</b>, not just the close. If the rule would have tripped intraday, the challenge fails — same as the real thing.</p>
              <div class="sc-foot"><span class="pill">Static or trailing DD</span><span class="pill">Intrabar checks</span></div>
            </article>
            <article class="strat-card">
              <div class="sc-head"><h4><i class="fa-solid fa-clock-rotate-left" style="color:var(--info)"></i> Bar replay</h4></div>
              <p class="sc-desc">Rewind the chart to any date, hide the future, and trade forward manually one bar at a time. The best way to test discretionary rules without lying to yourself.</p>
              <div class="sc-foot"><span class="pill">Manual trading</span><span class="pill">Keyboard driven</span></div>
            </article>
            <article class="strat-card">
              <div class="sc-head"><h4><i class="fa-solid fa-code" style="color:var(--up)"></i> Three languages</h4></div>
              <p class="sc-desc">Write in plain JavaScript, port a TradingView script with the Pine v5 subset, or use Python with numpy — the whole runtime executes in your browser, nothing is uploaded.</p>
              <div class="sc-foot"><span class="tag-lang tag-js">JS</span><span class="tag-lang tag-pine">Pine</span><span class="tag-lang tag-python">Python</span></div>
            </article>
          </div>
        </div>

        <!-- Instrument coverage -->
        <div class="section">
          <div class="section-head">
            <h2><i class="fa-solid fa-list-check"></i> Instrument coverage</h2>
            <button class="btn btn-ghost btn-sm" data-goto="markets">Browse all <i class="fa-solid fa-arrow-right"></i></button>
          </div>
          <div class="cov-grid" id="cov-grid"></div>
        </div>

        <!-- Economic calendar -->
        <div class="section">
          <div class="section-head">
            <div>
              <h2><i class="fa-solid fa-bullhorn"></i> Economic calendar</h2>
              <p>Live releases from ForexFactory. The same feed is plotted on your chart during a backtest and exposed to strategies as <code>ctx.news</code>.</p>
            </div>
            <div class="chips" id="news-home-scope">
              <button class="chip active" data-hscope="upcoming">Upcoming</button>
              <button class="chip" data-hscope="recent">Released</button>
            </div>
          </div>
          <div class="news-strip" id="news-home">
            <div class="ns-empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading the economic calendar…</div>
          </div>
        </div>

        <!-- Popular markets -->
        <div class="section">
          <div class="section-head">
            <h2><i class="fa-solid fa-globe"></i> Popular markets</h2>
            <button class="btn btn-ghost btn-sm" data-goto="markets">See all <i class="fa-solid fa-arrow-right"></i></button>
          </div>
          <div class="market-grid" id="home-markets"></div>
        </div>
      </div>
    </section>

    <!-- ------------------------------ WIZARD ------------------------------ -->
    <section class="page" data-page="wizard">
      <div class="page-head">
        <div>
          <h1>New Backtest</h1>
          <p>Four short steps. Each choice is explained as you go — nothing is assumed. At the end you land in the terminal with everything pre-loaded and the test already running.</p>
        </div>
      </div>
      <div class="page-body">
        <div class="wizard">
          <div class="wiz-rail" id="wiz-rail">
            <div class="wiz-node current" data-node="1"><span class="wn-circle">1</span><span class="wn-label">Market</span></div>
            <div class="wiz-line"></div>
            <div class="wiz-node" data-node="2"><span class="wn-circle">2</span><span class="wn-label">Strategy</span></div>
            <div class="wiz-line"></div>
            <div class="wiz-node" data-node="3"><span class="wn-circle">3</span><span class="wn-label">Account</span></div>
            <div class="wiz-line"></div>
            <div class="wiz-node" data-node="4"><span class="wn-circle">4</span><span class="wn-label">Review</span></div>
          </div>

          <!-- Step 1 -->
          <div class="wiz-step active" data-step="1">
            <div class="section-head">
              <div><h2><i class="fa-solid fa-globe"></i> Which market do you want to test?</h2>
              <p>Pick the instrument and the candle size. Lower timeframes give more trades but download more data.</p></div>
            </div>
            <div class="chips" id="wiz-cats">
              <button class="chip active" data-cat="forex">Forex</button>
              <button class="chip" data-cat="indices">Indices</button>
              <button class="chip" data-cat="stocks">Stocks</button>
              <button class="chip" data-cat="commodities">Commodities</button>
              <button class="chip" data-cat="crypto">Crypto</button>
            </div>
            <div class="market-grid" id="wiz-markets" style="margin-bottom:22px"></div>

            <div class="section-head"><div><h2><i class="fa-solid fa-clock"></i> Timeframe</h2>
            <p>One candle equals this much time. 1H is a good default for a first test.</p></div></div>
            <div class="opt-cards" id="wiz-tfs">
              <button class="opt-card" data-tf="5m"><b>5 minutes</b><span>Scalping. Heavy download, needs tight spread assumptions.</span></button>
              <button class="opt-card" data-tf="15m"><b>15 minutes</b><span>Intraday. Several trades per session.</span></button>
              <button class="opt-card" data-tf="1h" ><b>1 hour</b><span>Recommended. Balanced signal count and data volume.</span></button>
              <button class="opt-card" data-tf="4h" ><b>4 hours</b><span>Swing trading. A handful of trades per month.</span></button>
              <button class="opt-card" data-tf="1d" ><b>1 day</b><span>Position trading. Decades of history load instantly.</span></button>
            </div>
            <div class="hero-actions">
              <button class="btn btn-primary btn-lg" data-wiz-next="2">Continue <i class="fa-solid fa-arrow-right"></i></button>
            </div>
          </div>

          <!-- Step 2 -->
          <div class="wiz-step" data-step="2">
            <div class="section-head">
              <div><h2><i class="fa-solid fa-code-branch"></i> Which strategy should we test?</h2>
              <p>Every strategy below states its exact entry, exit and position-sizing rules. Pick one now — you can edit the code afterwards in the terminal.</p></div>
            </div>
            <div class="chips" id="wiz-fams"></div>
            <div class="strat-grid" id="wiz-strats" style="margin-bottom:22px"></div>
            <div class="hero-actions">
              <button class="btn btn-outline" data-wiz-next="1"><i class="fa-solid fa-arrow-left"></i> Back</button>
              <button class="btn btn-primary btn-lg" data-wiz-next="3">Continue <i class="fa-solid fa-arrow-right"></i></button>
            </div>
          </div>

          <!-- Step 3 -->
          <div class="wiz-step" data-step="3">
            <div class="section-head">
              <div><h2><i class="fa-solid fa-wallet"></i> Account &amp; costs</h2>
              <p>These numbers decide whether a strategy that looks good on paper survives real trading costs.</p></div>
            </div>
            <div class="form-grid cols-2" style="margin-bottom:22px">
              <div class="field">
                <label>Date range start</label>
                <input id="w-start" type="date" value="2023-01-01">
                <span class="field-hint">Earlier than the data allows is clamped automatically.</span>
              </div>
              <div class="field">
                <label>Date range end</label>
                <input id="w-end" type="date" value="2024-12-31">
                <span class="field-hint">Two years of 1H data is a solid sample.</span>
              </div>
              <div class="field">
                <label>Starting balance ($)</label>
                <input id="w-balance" type="number" value="100000" step="1000" min="100">
                <span class="field-hint">Risk-based strategies size positions from this.</span>
              </div>
              <div class="field">
                <label>Leverage</label>
                <select id="w-leverage">
                  <option value="1">1:1 — no leverage</option>
                  <option value="10">1:10</option>
                  <option value="30">1:30 — EU retail cap</option>
                  <option value="50">1:50</option>
                  <option value="100" selected>1:100 — typical broker</option>
                  <option value="200">1:200</option>
                  <option value="500">1:500</option>
                </select>
                <span class="field-hint">Only limits how big a position your margin allows. It does not change profit per pip.</span>
              </div>
              <div class="field">
                <label>Spread (pips / points)</label>
                <input id="w-spread" type="number" value="0.5" step="0.1" min="0">
                <span class="field-hint">Charged on entry and exit. 0.5 is realistic for EURUSD, 1.5–3 for indices.</span>
              </div>
              <div class="field">
                <label>Commission ($ per lot per side)</label>
                <input id="w-commission" type="number" value="3.5" step="0.5" min="0">
                <span class="field-hint">Typical raw-spread broker charge. Set 0 for a spread-only account.</span>
              </div>
            </div>

            <div class="section-head"><div><h2><i class="fa-solid fa-shield-halved"></i> Prop-firm rules</h2>
            <p>Optional. Adds hard limits — the run stops the instant one is breached, exactly like a funded challenge.</p></div></div>
            <div class="opt-cards" id="w-props">
              <button class="opt-card active" data-prop="none"><b>Off</b><span>Plain trading account with no external rules.</span></button>
              <button class="opt-card" data-prop="ftmo1"><b>Evaluation Phase 1</b><span>Target +10% · daily loss 5% · max drawdown 10%.</span></button>
              <button class="opt-card" data-prop="ftmo2"><b>Evaluation Phase 2</b><span>Target +5% · daily loss 5% · max drawdown 10%.</span></button>
              <button class="opt-card" data-prop="funded"><b>Funded account</b><span>No target · daily loss 5% · max drawdown 10%.</span></button>
            </div>
            <div class="hero-actions">
              <button class="btn btn-outline" data-wiz-next="2"><i class="fa-solid fa-arrow-left"></i> Back</button>
              <button class="btn btn-primary btn-lg" data-wiz-next="4">Review <i class="fa-solid fa-arrow-right"></i></button>
            </div>
          </div>

          <!-- Step 4 -->
          <div class="wiz-step" data-step="4">
            <div class="section-head">
              <div><h2><i class="fa-solid fa-clipboard-check"></i> Review &amp; run</h2>
              <p>Check the setup, then launch. The terminal opens with the data downloading and the backtest queued.</p></div>
            </div>
            <div class="card" style="margin-bottom:20px">
              <div class="card-head"><span class="card-title"><i class="fa-solid fa-list-check"></i> Test configuration</span></div>
              <div class="card-body"><table class="kv" id="w-review"></table></div>
            </div>
            <div id="w-rules-card" class="card" style="margin-bottom:20px">
              <div class="card-head"><span class="card-title"><i class="fa-solid fa-scroll"></i> Strategy rules in plain English</span></div>
              <div class="card-body"><table class="kv" id="w-rules"></table></div>
            </div>
            <div class="callout warn">
              <i class="fa-solid fa-triangle-exclamation"></i>
              <div><b>Past performance is not a forecast.</b> A backtest shows what a rule set would have done on data that already happened. Slippage, news gaps, requotes and your own discipline are not modelled.</div>
            </div>
            <div class="hero-actions">
              <button class="btn btn-outline" data-wiz-next="3"><i class="fa-solid fa-arrow-left"></i> Back</button>
              <button class="btn btn-primary btn-lg" id="w-launch"><i class="fa-solid fa-rocket"></i> Run backtest in terminal</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ------------------------------ STRATEGIES ------------------------------ -->
    <section class="page" data-page="strategies">
      <div class="page-head">
        <div>
          <h1>Strategy Library</h1>
          <p>Twelve strategies with documented rules, sensible risk sizing and no hidden look-ahead. Use them as-is, or as a starting skeleton for your own idea.</p>
        </div>
        <div class="page-head-actions">
          <button class="btn btn-primary" data-goto="wizard"><i class="fa-solid fa-wand-magic-sparkles"></i> Test one now</button>
        </div>
      </div>
      <div class="page-body">
        <div class="callout brand" style="margin-bottom:22px">
          <i class="fa-solid fa-circle-info"></i>
          <div>Every strategy uses <b>risk-based sizing</b>: position size is derived from your balance and the stop distance, so a wider stop automatically means a smaller position. Fixed-lot sizing hides risk — this doesn't.</div>
        </div>
        <div class="chips" id="lib-filters"></div>
        <div class="strat-grid" id="lib-grid"></div>
      </div>
    </section>

    <!-- ------------------------------ MARKETS ------------------------------ -->
    <!-- --------------------------- LIVE CRYPTO -------------------------- -->
    <section class="page" data-page="live">
      <div class="page-head">
        <div>
          <h1>Live Crypto</h1>
          <p>The consolidated book, the liquidity map, the footprint and the tape for one pair,
             streamed live from <b>twelve venues at once</b> — Binance, Bybit, OKX, Gate.io, Bitget,
             Kraken, Coinbase, Bitstamp and Bitfinex on spot, plus the Binance, Bybit and OKX
             perpetuals. Spot and perps are kept apart because they are different instruments
             trading at different prices; switch between them above.</p>
        </div>
      </div>
      <div class="page-body">
        <div class="lcp-bar">
          <div class="seg seg-xs" id="lcp-class">
            <button data-class="crypto" class="active">Crypto</button>
            <button data-class="index">Indices</button>
          </div>
          <div class="lcp-pairs" id="lcp-pairs"></div>
          <div class="seg seg-xs" id="lcp-market">
            <button data-market="spot" class="active">Spot</button>
            <button data-market="perp">Perps</button>
            <button data-market="all">Both</button>
          </div>
          <div class="seg seg-xs" id="lcp-quote">
            <button data-quote="USDT" class="active">USDT</button>
            <button data-quote="USD">USD</button>
            <button data-quote="all">Both</button>
          </div>
          <div class="lc-venues" id="lcp-venues"></div>
          <div class="pwa-bar" id="lcp-pwa"></div>
        </div>
        <div class="card lcp-chart-card">
          <div class="card-head">
            <div class="card-title">Chart</div>
            <div class="seg seg-xs" id="lcp-tf">
              <button data-tf="1m">1m</button>
              <button data-tf="5m" class="active">5m</button>
              <button data-tf="15m">15m</button>
              <button data-tf="1h">1h</button>
              <button data-tf="4h">4h</button>
              <button data-tf="1d">1d</button>
            </div>
            <span class="lcp-ovnote" id="lcp-ovnote"></span>
          </div>
          <div class="card-body" style="padding:0">
            <div id="lcp-chart-wrap"><div id="lcp-chart"></div></div>
          </div>
        </div>

        <div class="lcp-trend" id="lcp-trend"></div>

        <div class="lcp-index hidden" id="lcp-index">
          <div class="card lcp-card">
            <div class="card-head">
              <div class="card-title">Sessions</div>
              <span class="pill" id="lcp-tz">local</span>
            </div>
            <div class="card-body">
              <div class="ses-chips" id="lcp-sessions"></div>
              <div id="lcp-ses-now"></div>
            </div>
          </div>
          <div class="card lcp-card">
            <div class="card-head">
              <div class="card-title">At the open</div>
              <span class="pill" id="lcp-open-n">—</span>
            </div>
            <div class="card-body" id="lcp-openstats"></div>
          </div>
        </div>

        <div class="lcp-call hidden" id="lcp-call-wrap">
          <div class="card lcp-card">
            <div class="card-head">
              <div class="card-title">Today's open</div>
              <span class="pill" id="lcp-call-when">—</span>
              <span class="pill" id="lcp-call-score">no record yet</span>
            </div>
            <div class="card-body" id="lcp-call"></div>
          </div>
        </div>

        <div class="lcp-index hidden" id="lcp-index2">
          <div class="card lcp-card">
            <div class="card-head">
              <div class="card-title">Open forecast</div>
              <div class="seg seg-xs" id="lcp-hist">
                <button data-days="30" class="active">30d</button>
                <button data-days="60">60d</button>
                <button data-days="90">90d</button>
              </div>
              <span class="pill" id="lcp-fc-n">—</span>
            </div>
            <div class="card-body" id="lcp-forecast"></div>
          </div>
          <div class="card lcp-card">
            <div class="card-head">
              <div class="card-title">How violent each open is</div>
              <span class="pill" id="lcp-vol-n">—</span>
            </div>
            <div class="card-body" id="lcp-volprofile"></div>
          </div>
        </div>

        <div class="lcp-micro">
          <div class="card lcp-card lcp-mcard">
            <div class="card-head">
              <div class="card-title">Liquidity map</div>
              <div class="seg seg-xs" id="lcp-band">
                <button data-band="0.15">&plusmn;0.15%</button>
                <button data-band="0.4" class="active">&plusmn;0.4%</button>
                <button data-band="1">&plusmn;1%</button>
              </div>
              <span class="lcp-ovnote" id="lcp-heat-note"></span>
            </div>
            <div class="card-body lcp-canvas-body"><canvas id="lcp-heat"></canvas></div>
          </div>

          <div class="card lcp-card lcp-mcard">
            <div class="card-head">
              <div class="card-title">Footprint</div>
              <div class="seg seg-xs" id="lcp-fpbars">
                <button data-bars="6">6</button>
                <button data-bars="12" class="active">12</button>
                <button data-bars="20">20</button>
              </div>
              <div class="seg seg-xs" id="lcp-fpmult">
                <button data-mult="0" class="active">Auto</button>
                <button data-mult="1">1&times;</button>
                <button data-mult="5">5&times;</button>
                <button data-mult="20">20&times;</button>
              </div>
              <span class="lcp-ovnote" id="lcp-foot-note"></span>
            </div>
            <div class="card-body lcp-canvas-body"><canvas id="lcp-foot"></canvas></div>
          </div>
        </div>

        <div class="lcp-grid">
          <div class="card lcp-card">
            <div class="card-head"><div class="card-title">Order book</div>
              <span class="pill" id="lcp-sym">—</span></div>
            <div class="card-body" id="lcp-book"></div>
          </div>
          <div class="lcp-col">
            <div class="card lcp-card">
              <div class="card-head"><div class="card-title">Account</div>
                <span class="pill" id="lcp-risk-note">sizing</span></div>
              <div class="card-body">
                <div class="rk-grid">
                  <label class="rk-f"><span>Balance</span>
                    <input id="rk-balance" type="number" min="0" step="100"></label>
                  <label class="rk-f"><span>Risk per trade</span>
                    <input id="rk-risk" type="number" min="0.1" max="10" step="0.1"></label>
                  <label class="rk-f"><span>Leverage</span>
                    <input id="rk-lev" type="number" min="1" max="125" step="1"></label>
                  <label class="rk-f"><span>Hold (hours)</span>
                    <input id="rk-hold" type="number" min="0" max="72" step="1"></label>
                </div>
                <p class="sg-note">Sizing comes from the stop, not from a fixed contract
                  count: a wider stop means a smaller position for the same money at risk.
                  Leverage does not change the risk — it only decides where the exchange
                  liquidates you.</p>
              </div>
            </div>
            <div class="card lcp-card lcp-signal-card">
              <div class="card-head"><div class="card-title">Signal</div>
                <span class="pill" id="lcp-sig-state">idle</span></div>
              <div class="card-body" id="lcp-signal"></div>
            </div>
            <div class="card lcp-card">
              <div class="card-head"><div class="card-title">Calendar</div>
                <span class="pill" id="lcp-news-count">0</span></div>
              <div class="card-body" id="lcp-news"></div>
            </div>
            <div class="card lcp-card">
              <div class="card-head"><div class="card-title">Delta</div></div>
              <div class="card-body" id="lcp-delta"></div>
            </div>
            <div class="card lcp-card">
              <div class="card-head"><div class="card-title">Whales</div></div>
              <div class="card-body" id="lcp-whales"></div>
            </div>
          </div>
        </div>
        <div class="callout" style="margin-top:16px">
          <i class="fa-solid fa-circle-info"></i>
          <div>Live only. No exchange publishes historical per-level book state, so none of this
               can feed a backtest — what history does support is the <b>Microstructure</b> pass in
               the terminal's backtest report. Binance, Bybit and OKX quote in USDT while Kraken and
               Coinbase quote in USD; the ladder consolidates the USDT venues so a single price is
               comparing like with like.</div>
        </div>
      </div>
    </section>

    <section class="page" data-page="markets">
      <div class="page-head">
        <div>
          <h1>Markets</h1>
          <p>The curated list below is ready to trade. On top of it, <b>search the full Dukascopy universe</b> — about 1,500 instruments across forex, indices, stocks, ETFs, commodities and bonds — and open any of them straight in the terminal.</p>
        </div>
      </div>
      <div class="page-body">
        <div class="mk-search" id="mk-search-wrap">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input id="mk-search" type="search" placeholder="Search ~1,500 markets — try “Tencent”, “Netflix”, “USDILS”, “DAX”, “silver”…" autocomplete="off">
        </div>
        <div id="mk-results" class="hidden"></div>
        <div class="chips" id="mk-filters">
          <button class="chip active" data-cat="all">All</button>
          <button class="chip" data-cat="forex">Forex</button>
          <button class="chip" data-cat="indices">Indices</button>
          <button class="chip" data-cat="stocks">Stocks</button>
          <button class="chip" data-cat="commodities">Commodities</button>
          <button class="chip" data-cat="crypto">Crypto</button>
        </div>
        <div class="card">
          <div class="table-wrap" style="max-height:none">
            <table class="dt" id="mk-table">
              <thead><tr>
                <th>Symbol</th><th style="text-align:left">Name</th><th style="text-align:left">Class</th>
                <th style="text-align:left">Feed</th><th>Contract size</th><th>Pip / point</th><th>Digits</th>
              </tr></thead>
              <tbody id="mk-rows"></tbody>
            </table>
          </div>
        </div>
      </div>
    </section>

    <!-- ------------------------------ DATA ------------------------------ -->
    <section class="page" data-page="data">
      <div class="page-head">
        <div>
          <h1>Data Sources</h1>
          <p>Where every candle comes from, how it is decoded, and exactly what its limitations are. Read this before you trust a result.</p>
        </div>
        <div class="page-head-actions">
          <button class="btn btn-outline" id="ds-test"><i class="fa-solid fa-plug-circle-check"></i> Test live feeds</button>
        </div>
      </div>
      <div class="page-body">
        <div class="stat-grid" style="margin-bottom:26px">
          <div class="stat accent">
            <div class="stat-label">Forex · Indices · Stocks · Commodities</div>
            <div class="stat-value sm">Dukascopy</div>
            <div class="stat-sub">Swiss bank tick archive · BID prices · from 2003</div>
          </div>
          <div class="stat">
            <div class="stat-label">Cryptocurrency</div>
            <div class="stat-value sm">Binance</div>
            <div class="stat-sub">Spot klines REST API · from 2017</div>
          </div>
          <div class="stat">
            <div class="stat-label">Feed status</div>
            <div class="stat-value sm" id="ds-live">—</div>
            <div class="stat-sub" id="ds-live-sub">Press “Test live feeds”</div>
          </div>
        </div>
        <div class="card">
          <div class="card-body prose" id="data-prose"></div>
        </div>
      </div>
    </section>

    <!-- ------------------------------ DOCS ------------------------------ -->
    <section class="page" data-page="docs">
      <div class="page-head">
        <div>
          <h1>Manual</h1>
          <p>The complete reference: how the engine fills orders, how prop rules are enforced, and the full API for all three strategy languages.</p>
        </div>
      </div>
      <div class="page-body">
        <div class="docs-layout">
          <aside class="docs-toc">
            <div class="eyebrow">On this page</div>
            <nav id="toc"></nav>
          </aside>
          <article class="prose" id="docs-prose"></article>
        </div>
      </div>
    </section>

    <!-- ------------------------------ FAQ ------------------------------ -->
    <section class="page" data-page="faq">
      <div class="page-head">
        <div>
          <h1>FAQ</h1>
          <p>Short answers to the questions that come up most often — especially the ones about why a result looks worse than expected.</p>
        </div>
      </div>
      <div class="page-body" style="max-width:900px">
        <div id="faq-list"></div>
      </div>
    </section>

  </main>
</div>

<div id="toast-host"></div>

<script src="/static/js/symbols.js"></script>
<script src="/static/js/catalog.js"></script>
<script src="/static/js/news.js"></script>
<script src="/static/js/strategies.js"></script>
<script src="/static/js/docs-content.js"></script>
<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"></script>
<script src="/static/lzma.js"></script>
<script src="/static/js/data.js"></script>
<script src="/static/js/indicators.js"></script>
<script src="/static/js/chart.js"></script>
<script src="/static/js/exchanges.js"></script>
<script src="/static/js/tape.js"></script>
<script src="/static/js/cryptohub.js"></script>
<script src="/static/js/livecrypto.js"></script>
<script src="/static/js/micropanels.js"></script>
<script src="/static/js/live-chart.js"></script>
<script src="/static/js/sessions.js"></script>
<script src="/static/js/openstats.js"></script>
<script src="/static/js/sessionbot.js"></script>
<script src="/static/js/dailycall.js"></script>
<script src="/static/js/pwa.js"></script>
<script src="/static/js/derivs.js"></script>
<script src="/static/js/risk.js"></script>
<script src="/static/js/reads.js"></script>
<script src="/static/js/signals.js"></script>
<script src="/static/js/signal-ui.js"></script>
<script src="/static/js/dashboard.js"></script>
</body>
</html>`
