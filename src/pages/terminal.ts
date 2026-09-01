// Terminal workspace page (chart + backtest dock + editor)
export const terminalHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Terminal · BlackTick</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%230b0d10'/><path d='M6 21l6-7 5 4 9-11' stroke='%234dd4c0' stroke-width='2.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>">
<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"></script>
<script src="/static/lzma.js"></script>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0b0d10">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="BlackTick">
<link rel="apple-touch-icon" href="/static/icons/icon-192.png">
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.2/css/all.min.css" rel="stylesheet">
<link href="/static/css/theme.css" rel="stylesheet">
<link href="/static/css/terminal.css" rel="stylesheet">
<link href="/static/css/livecrypto.css" rel="stylesheet">
<link href="/static/css/mobile.css" rel="stylesheet">
</head>
<body>
<div id="terminal-root">

  <!-- ============================ TOP BAR ============================ -->
  <header id="topbar">
    <div class="tb-group">
      <a id="back-to-dash" href="/" data-tip="Back to dashboard">
        <span class="brand-mark"><i class="fa-solid fa-chart-line"></i></span>
        <i class="fa-solid fa-chevron-left" style="font-size:9px"></i>
      </a>
      <div class="tb-divider"></div>

      <button id="symbol-btn" data-tip="Change instrument  (press S)">
        <i class="fa-solid fa-magnifying-glass"></i>
        <span>
          <span class="sb-sym">EURUSD</span>
          <span class="sb-src">Dukascopy</span>
        </span>
        <i class="fa-solid fa-chevron-down"></i>
      </button>

      <div class="tf-bar">
        <button class="tf-btn" data-tf="1m">1m</button>
        <button class="tf-btn" data-tf="5m">5m</button>
        <button class="tf-btn" data-tf="15m">15m</button>
        <button class="tf-btn" data-tf="30m">30m</button>
        <button class="tf-btn active" data-tf="1h">1H</button>
        <button class="tf-btn" data-tf="4h">4H</button>
        <button class="tf-btn" data-tf="1d">1D</button>
        <button class="tf-btn" data-tf="1w">1W</button>
      </div>

      <div class="tb-divider"></div>
      <button id="btn-indicators" class="btn btn-ghost btn-sm" data-tip="Add indicators to the chart">
        <i class="fa-solid fa-wave-square"></i> Indicators
      </button>
      <button id="btn-session" class="btn btn-session btn-sm" data-tip="Manual backtesting — pick a market, a start date and a balance, then trade bar by bar">
        <i class="fa-solid fa-clock-rotate-left"></i> Backtesting Session
      </button>
    </div>

    <div class="tb-group">
      <span id="bars-info"></span>
      <div id="acct-chip" data-tip="Simulated account — no real money involved">
        <div class="ac-cell"><span class="ac-k">Balance</span><span class="ac-v" id="chip-balance">$100,000</span></div>
        <div class="ac-cell"><span class="ac-k">Equity</span><span class="ac-v" id="chip-equity">$100,000</span></div>
        <div class="ac-cell"><span class="ac-k">Open P/L</span><span class="ac-v" id="chip-pnl">$0.00</span></div>
      </div>
      <button id="btn-tester" class="btn btn-primary btn-sm" data-tip="Configure and run a backtest">
        <i class="fa-solid fa-play"></i> Run Backtest
      </button>
      <button id="btn-settings" class="btn btn-ghost btn-sm" data-tip="Account &amp; prop-firm settings"><i class="fa-solid fa-sliders"></i></button>
      <a class="btn btn-ghost btn-sm" href="/#docs" target="_blank" data-tip="Open the manual"><i class="fa-solid fa-circle-question"></i></a>
    </div>
  </header>

  <div id="work-row">
    <!-- ============================ DRAWING TOOLS ============================ -->
    <nav id="tools">
      <button class="tool-btn active" data-tool="cursor" data-tip="Cursor">     <i class="fa-solid fa-arrow-pointer"></i></button>
      <button class="tool-btn" data-tool="trendline" data-tip="Trend line">     <i class="fa-solid fa-slash"></i></button>
      <button class="tool-btn" data-tool="ray" data-tip="Ray">                  <i class="fa-solid fa-arrow-trend-up"></i></button>
      <button class="tool-btn" data-tool="hline" data-tip="Horizontal line">    <i class="fa-solid fa-grip-lines"></i></button>
      <button class="tool-btn" data-tool="vline" data-tip="Vertical line">      <i class="fa-solid fa-grip-lines-vertical"></i></button>
      <button class="tool-btn" data-tool="rect" data-tip="Rectangle / zone">    <i class="fa-regular fa-square"></i></button>
      <button class="tool-btn" data-tool="fib" data-tip="Fib retracement">      <i class="fa-solid fa-bars-staggered"></i></button>
      <button class="tool-btn" data-tool="brush" data-tip="Freehand brush">     <i class="fa-solid fa-paintbrush"></i></button>
      <button class="tool-btn" data-tool="text" data-tip="Text note">           <i class="fa-solid fa-font"></i></button>
      <button class="tool-btn" data-tool="ruler" data-tip="Measure move &amp; bars"><i class="fa-solid fa-ruler"></i></button>
      <div class="tool-sep"></div>
      <button class="tool-btn" data-tool="longpos" data-tip="Long position tool"><i class="fa-solid fa-arrow-up-long" style="color:var(--up)"></i></button>
      <button class="tool-btn" data-tool="shortpos" data-tip="Short position tool"><i class="fa-solid fa-arrow-down-long" style="color:var(--down)"></i></button>
      <div class="tool-sep"></div>
      <button class="tool-btn" id="tool-magnet" data-tip="Magnet — snap to OHLC"><i class="fa-solid fa-magnet"></i></button>
      <button class="tool-btn" id="tool-del" data-tip="Delete selected drawing"><i class="fa-solid fa-eraser"></i></button>
      <button class="tool-btn" id="tool-delall" data-tip="Clear all drawings"><i class="fa-solid fa-trash"></i></button>
    </nav>

    <!-- ============================ CHART + DOCK ============================ -->
    <div id="chart-zone">
      <div id="chart-wrap">
        <div id="chart-container"></div>
        <canvas id="trade-canvas"></canvas>
        <canvas id="draw-canvas"></canvas>
        <div id="chart-legend"></div>

        <div id="chart-loading">
          <i class="fa-solid fa-circle-notch spin cl-icon"></i>
          <div class="cl-text" id="cl-text">Downloading real market data…</div>
          <div class="cl-bar progress"><div class="progress-fill" id="cl-fill"></div></div>
        </div>

        <div id="chart-hint" class="hidden">
          <i class="fa-solid fa-lightbulb hint-ico"></i>
          <span id="hint-text"></span>
          <button id="hint-next" data-tip="Next tip"><i class="fa-solid fa-arrow-right"></i></button>
          <button id="hint-close" data-tip="Hide tips"><i class="fa-solid fa-xmark"></i></button>
        </div>

        <!-- Session playback controls -->
        <div id="replay-bar" class="hidden">
          <div class="rp-transport">
            <button id="rp-restart" data-tip="Restart this session from its first bar"><i class="fa-solid fa-rotate-left"></i></button>
            <button id="rp-back" data-tip="Step back one bar  (←)"><i class="fa-solid fa-backward-step"></i></button>
            <button id="rp-play" data-tip="Play  (Space)"><i class="fa-solid fa-play"></i></button>
            <button id="rp-fwd" data-tip="Step forward one bar  (→)"><i class="fa-solid fa-forward-step"></i></button>
            <button id="rp-skip" data-tip="Skip 10 bars forward"><i class="fa-solid fa-forward"></i></button>
          </div>
          <div class="rp-sep"></div>
          <select id="rp-speed" data-tip="Playback speed">
            <option value="2000">0.5&times;</option>
            <option value="1000" selected>1&times;</option>
            <option value="500">2&times;</option>
            <option value="250">4&times;</option>
            <option value="120">8&times;</option>
            <option value="60">16&times;</option>
            <option value="30">32&times;</option>
          </select>
          <div class="rp-sep"></div>
          <div class="rp-clock">
            <b id="rp-time">—</b>
            <small id="rp-count">0 / 0 bars</small>
          </div>
          <div class="rp-sep"></div>
          <button class="rp-txt" id="rp-goto"><i class="fa-solid fa-calendar-day"></i> Jump</button>
          <button class="rp-txt danger" id="rp-exit"><i class="fa-solid fa-stop"></i> End</button>
          <div id="rp-progress"><div id="rp-progress-fill"></div></div>
        </div>

        <!-- Manual order ticket -->
        <button id="tk-reopen" class="hidden" data-tip="Show the order ticket"><i class="fa-solid fa-bolt"></i></button>
        <div id="ticket" class="hidden">
          <div class="tk-head">
            <b><i class="fa-solid fa-bolt"></i> Order Ticket</b>
            <button id="tk-close" data-tip="Hide the ticket"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="tk-body">
            <div class="tk-quote">
              <div class="tk-q bid"><span>Bid · sell</span><b id="tk-bid">—</b></div>
              <div class="tk-q ask"><span>Ask · buy</span><b id="tk-ask">—</b></div>
            </div>

            <div class="tk-field">
              <label>Size <span>lots</span></label>
              <input id="tk-size" type="number" value="1" min="0.01" step="0.01">
            </div>

            <div class="tk-field">
              <label>Stop loss <span>price</span></label>
              <div class="tk-input-row">
                <input id="tk-sl" type="number" placeholder="—" step="any">
                <button class="tk-pick" id="tk-pick-sl" data-tip="Click the chart to place the stop"><i class="fa-solid fa-crosshairs"></i></button>
              </div>
            </div>

            <div class="tk-field">
              <label>Take profit <span>price</span></label>
              <div class="tk-input-row">
                <input id="tk-tp" type="number" placeholder="—" step="any">
                <button class="tk-pick" id="tk-pick-tp" data-tip="Click the chart to place the target"><i class="fa-solid fa-crosshairs"></i></button>
              </div>
            </div>

            <div class="tk-sizer">
              <span>Risk</span>
              <button class="tk-risk-btn" data-pct="0.25">0.25%</button>
              <button class="tk-risk-btn" data-pct="0.5">0.5%</button>
              <button class="tk-risk-btn" data-pct="1">1%</button>
              <button class="tk-risk-btn" data-pct="2">2%</button>
            </div>

            <div class="tk-risk">
              <div><span>Margin needed</span><b id="tk-margin">—</b></div>
              <div><span>Risk if SL hit</span><b id="tk-risk-cash">—</b></div>
              <div><span>% of balance</span><b id="tk-risk-pct">—</b></div>
              <div><span>Reward at TP</span><b id="tk-reward-cash">—</b></div>
              <div><span>Reward : risk</span><b id="tk-rr">—</b></div>
            </div>
          </div>
          <!-- Actions sit outside the scrolling body: on a short chart pane the
               fields scroll, but BUY / SELL / Close all stay reachable. -->
          <div class="tk-foot">
            <div class="tk-btns">
              <button class="btn btn-down" id="tk-sell">SELL <kbd>S</kbd></button>
              <button class="btn btn-up" id="tk-buy">BUY <kbd>B</kbd></button>
            </div>
            <button class="btn btn-outline btn-sm btn-block" id="tk-closeall">
              <i class="fa-solid fa-xmark"></i> Close all <kbd>C</kbd>
            </button>
          </div>
        </div>
      </div>

      <div id="dock-resize"></div>

      <!-- ============================ DOCK ============================ -->
      <section id="dock">
        <div id="dock-tabs">
          <button class="dock-tab active" data-tab="tester"><i class="fa-solid fa-flask-vial"></i> Backtest Report</button>
          <button class="dock-tab" data-tab="positions"><i class="fa-solid fa-layer-group"></i> Positions <span class="tab-count" id="cnt-open">0</span></button>
          <button class="dock-tab" data-tab="news"><i class="fa-solid fa-bullhorn"></i> News <span class="tab-count" id="cnt-news">0</span></button>
          <button class="dock-tab" data-tab="book"><i class="fa-solid fa-layer-group"></i> Order Book <span class="tab-count" id="cnt-venues">0</span></button>
          <button class="dock-tab" data-tab="liquidity"><i class="fa-solid fa-fire"></i> Liquidity</button>
          <button class="dock-tab" data-tab="editor"><i class="fa-solid fa-code"></i> Strategy Editor</button>
          <div id="dock-actions">
            <span id="dock-status"></span>
            <button class="btn btn-ghost btn-sm" id="dock-expand" data-tip="Toggle tall view"><i class="fa-solid fa-up-right-and-down-left-from-center"></i></button>
            <button class="btn btn-ghost btn-sm" id="dock-collapse" data-tip="Collapse panel"><i class="fa-solid fa-chevron-down"></i></button>
          </div>
        </div>

        <div id="dock-body">
          <!-- ---- Backtest report ---- -->
          <div class="dock-page active" data-page="tester">
            <div id="tester-empty" class="empty">
              <div class="empty-icon"><i class="fa-solid fa-flask-vial"></i></div>
              <h4>No backtest run yet</h4>
              <p>Pick a strategy in the <b>Strategy Editor</b> tab, then press <b>Run Backtest</b> in the top bar. Results — equity curve, trade list, monthly returns and prop-firm rule checks — appear here.</p>
              <div style="display:flex;gap:10px">
                <button class="btn btn-primary" id="empty-run"><i class="fa-solid fa-play"></i> Configure backtest</button>
                <button class="btn btn-outline" id="empty-editor"><i class="fa-solid fa-code"></i> Browse strategies</button>
              </div>
            </div>

            <div id="tester-results" class="hidden" style="display:none;flex-direction:column;height:100%">
              <div id="results-sub">
                <button class="res-tab active" data-res="overview">Overview</button>
                <button class="res-tab" data-res="performance">Performance</button>
                <button class="res-tab" data-res="trades">Trades</button>
                <button class="res-tab" data-res="monthly">Monthly</button>
                <button class="res-tab" data-res="prop">Prop Firm</button>
                <button class="res-tab" data-res="micro">Microstructure</button>
                <div id="results-meta"></div>
              </div>
              <div class="res-page overview-page active" data-res="overview">
                <div id="ov-kpis"></div>
                <div id="equity-panel">
                  <div class="eq-head">
                    <span class="eyebrow">Equity curve</span>
                    <span class="t-faint" style="font-size:11px">Balance + floating P/L, bar by bar</span>
                  </div>
                  <div id="equity-chart"></div>
                </div>
              </div>
              <div class="res-page" data-res="performance"><div id="perf-body"></div></div>
              <div class="res-page" data-res="trades"><div id="trades-body"></div></div>
              <div class="res-page" data-res="monthly"><div id="monthly-body"></div></div>
              <div class="res-page" data-res="prop"><div id="prop-body"></div></div>
              <div class="res-page" data-res="micro"><div id="micro-body"></div></div>
            </div>
          </div>

          <!-- ---- Positions ---- -->
          <div class="dock-page" data-page="positions">
            <div class="pos-scroll">
              <div id="session-stats" class="hidden"></div>
              <div class="section-head">
                <span class="eyebrow">Open positions</span>
                <span class="t-faint" style="font-size:11px">Drag the SL / TP lines on the chart to move them</span>
              </div>
              <div id="open-pos-host"></div>
              <div class="section-head" style="margin-top:22px">
                <span class="eyebrow">Closed trades</span>
              </div>
              <div id="closed-trades-host"></div>
            </div>
          </div>

          <!-- ---- Consolidated order book ---- -->
          <div class="dock-page" data-page="book">
            <div class="cb-wrap">
              <div class="cb-toolbar">
                <div class="cb-venues" id="cb-venues"></div>
                <div class="seg" id="cb-quote">
                  <button class="active" data-quote="USDT">USDT venues</button>
                  <button data-quote="USD">USD venues</button>
                  <button data-quote="all">Combine both</button>
                </div>
                <label class="cb-tick">Grouping
                  <select id="cb-tick"><option value="auto" selected>Auto</option></select>
                </label>
                <button class="btn btn-sm" id="cb-toggle"><i class="fa-solid fa-play"></i> Connect</button>
              </div>
              <div id="cb-status" class="cb-status"></div>
              <div id="cb-body" class="cb-body"></div>
            </div>
          </div>

          <!-- ---- Liquidity map + footprint ---- -->
          <div class="dock-page" data-page="liquidity">
            <div class="lq-wrap">
              <div class="lq-tools">
                <span class="eyebrow">Liquidity map</span>
                <div class="seg seg-xs" id="lq-band">
                  <button data-band="0.15">&plusmn;0.15%</button>
                  <button data-band="0.4" class="active">&plusmn;0.4%</button>
                  <button data-band="1">&plusmn;1%</button>
                </div>
                <span class="eyebrow" style="margin-left:18px">Footprint</span>
                <div class="seg seg-xs" id="lq-bars">
                  <button data-bars="6">6</button>
                  <button data-bars="12" class="active">12</button>
                  <button data-bars="20">20</button>
                </div>
                <div class="seg seg-xs" id="lq-mult">
                  <button data-mult="0" class="active">Auto</button>
                  <button data-mult="1">1&times;</button>
                  <button data-mult="5">5&times;</button>
                  <button data-mult="20">20&times;</button>
                </div>
                <span class="lq-note" id="lq-note"></span>
              </div>
              <div class="lq-grid">
                <div class="lq-pane"><canvas id="lq-heat"></canvas></div>
                <div class="lq-pane"><canvas id="lq-foot"></canvas></div>
              </div>
            </div>
          </div>

          <!-- ---- News ---- -->
          <div class="dock-page" data-page="news" style="padding:14px 16px;overflow:auto">
            <div class="news-toolbar">
              <div class="seg" id="news-scope">
                <button class="active" data-scope="range">In backtest range</button>
                <button data-scope="upcoming">Upcoming</button>
              </div>
              <div class="seg" id="news-imp">
                <button class="active" data-imp="high">High</button>
                <button data-imp="medium">+ Medium</button>
                <button data-imp="all">All</button>
              </div>
              <label class="switch" style="margin-left:auto">
                <input type="checkbox" id="news-only-sym" checked>
                <span>Only this symbol's currencies</span>
              </label>
              <label class="switch">
                <input type="checkbox" id="news-show-chart" checked>
                <span>Show on chart</span>
              </label>
            </div>
            <div id="news-host"></div>
          </div>

          <!-- ---- Editor ---- -->
          <div class="dock-page" data-page="editor">
            <div id="editor-page">
              <div id="editor-bar">
                <select id="strategy-lang" data-tip="Language the strategy is written in">
                  <option value="js">JavaScript</option>
                  <option value="pine">Pine Script (v5 subset)</option>
                  <option value="python">Python (numpy)</option>
                </select>
                <select id="strategy-pick" data-tip="Load a ready-made strategy"></select>
                <button class="btn btn-sm" id="editor-validate"><i class="fa-solid fa-check-double"></i> Check syntax</button>
                <button class="btn btn-primary btn-sm" id="editor-run"><i class="fa-solid fa-play"></i> Run Backtest</button>
                <span id="editor-msg"></span>
                <span style="flex:1"></span>
                <button class="btn btn-ghost btn-sm" id="api-help-toggle" data-tip="Show / hide API reference"><i class="fa-solid fa-book"></i></button>
              </div>
              <div id="strategy-about" style="padding:10px 14px;border-bottom:1px solid var(--line-soft);font-size:12px;color:var(--t-2);flex-shrink:0"></div>
              <div id="editor-split">
                <div id="code-area"><textarea id="strategy-code" spellcheck="false"></textarea></div>
                <aside id="api-help"></aside>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- ============================ RIGHT RAIL ============================ -->
    <aside id="rail">
      <div class="rail-sec grow" id="rail-watchlist-sec">
        <div class="rail-head">
          <span class="eyebrow"><i class="fa-solid fa-list"></i> Watchlist</span>
          <div class="rail-head-btns">
            <button id="rail-live-on" class="hidden" data-tip="Show the live crypto book for this pair"><i class="fa-solid fa-bolt"></i></button>
            <button id="wl-add" data-tip="Search all instruments"><i class="fa-solid fa-magnifying-glass"></i></button>
          </div>
        </div>
        <div id="watchlist"></div>
      </div>

      <!-- Live crypto stack — takes the watchlist's place while a crypto pair
           is open, because that is when there is something live to watch. -->
      <div class="rail-sec grow hidden" id="rail-live-sec">
        <div class="rail-head">
          <span class="eyebrow"><i class="fa-solid fa-bolt"></i> <span id="rail-live-sym">Live</span></span>
          <button id="rail-live-off" data-tip="Back to the watchlist"><i class="fa-solid fa-list"></i></button>
        </div>
        <div id="rail-live-venues" class="lc-venues"></div>
        <div class="lc-stack">
          <div class="lc-panel">
            <div class="lc-title">Order book</div>
            <div id="rail-book"></div>
          </div>
          <div class="lc-panel">
            <div class="lc-title">Delta</div>
            <div id="rail-delta"></div>
          </div>
          <div class="lc-panel">
            <div class="lc-title">Whales</div>
            <div id="rail-whales"></div>
          </div>
        </div>
      </div>

      <div class="rail-sec">
        <div class="rail-head"><span class="eyebrow"><i class="fa-solid fa-wallet"></i> Account</span></div>
        <div id="acct-rail">
          <div class="ar-row"><span>Balance <i class="info-dot" data-tip-wide data-tip="Cash from closed trades only.">?</i></span><b id="ar-balance">$100,000.00</b></div>
          <div class="ar-row"><span>Equity <i class="info-dot" data-tip-wide data-tip="Balance plus profit/loss on positions that are still open.">?</i></span><b id="ar-equity">$100,000.00</b></div>
          <div class="ar-row"><span>Open P/L</span><b id="ar-pnl">$0.00</b></div>
          <div class="ar-row"><span>Margin used</span><b id="ar-margin">$0.00</b></div>
          <div class="ar-row"><span>Free margin</span><b id="ar-free">$100,000.00</b></div>
          <div class="ar-row"><span>Leverage</span><b id="ar-lev">1:100</b></div>
          <div class="ar-bar" data-tip="Share of your equity locked as margin"><div id="ar-marginbar" style="width:0%"></div></div>
        </div>
      </div>

      <div class="rail-sec hidden" id="rail-prop-sec">
        <div class="rail-head"><span class="eyebrow"><i class="fa-solid fa-shield-halved"></i> Prop-firm rules</span></div>
        <div id="prop-rail">
          <div class="pr-status active" id="pr-status"><i class="fa-solid fa-circle-play"></i> Challenge active</div>
          <div class="rule-bars" id="pr-bars"></div>
        </div>
      </div>
    </aside>
  </div>
</div>

<div id="toast-host"></div>

<!-- ============================ DIALOGS ============================ -->
<div id="backdrop" class="backdrop hidden"></div>

<div id="dlg-symbol" class="dialog hidden">
  <div class="dialog-head">
    <div><h3><i class="fa-solid fa-magnifying-glass"></i> Choose an instrument</h3>
    <p>Type to search the <b>entire Dukascopy universe</b> — about 1,500 instruments: forex, indices, stocks, ETFs, commodities, bonds and crypto — plus Binance spot pairs.</p></div>
    <button class="dialog-close"><i class="fa-solid fa-xmark"></i></button>
  </div>
  <div class="dialog-body">
    <div id="sym-search-wrap">
      <i class="fa-solid fa-magnifying-glass"></i>
      <input id="symbol-search" type="search" placeholder="Search anything — EURUSD, gold, Tesla, DAX, Tencent, USDILS, BTC…" autocomplete="off">
    </div>
    <div class="chips" id="symbol-cats">
      <button class="chip active" data-cat="all">All</button>
      <button class="chip" data-cat="forex">Forex</button>
      <button class="chip" data-cat="indices">Indices</button>
      <button class="chip" data-cat="stocks">Stocks</button>
      <button class="chip" data-cat="etf">ETFs</button>
      <button class="chip" data-cat="commodities">Commodities</button>
      <button class="chip" data-cat="crypto">Crypto</button>
      <button class="chip" data-cat="bonds">Bonds</button>
    </div>
    <div id="symbol-list"></div>
  </div>
</div>

<!-- ============================ BACKTESTING SESSION ============================ -->
<div id="dlg-session" class="dialog hidden" style="width:560px">
  <div class="dialog-head">
    <div><h3><i class="fa-solid fa-clock-rotate-left"></i> New Backtesting Session</h3>
    <p>Everything in one place — pick a market, a start date and an account, then trade the chart bar by bar. No strategy required.</p></div>
    <button class="dialog-close"><i class="fa-solid fa-xmark"></i></button>
  </div>
  <div class="dialog-body ss-body">
    <div class="field">
      <label>Market</label>
      <div id="ss-sym-box">
        <div id="ss-sym-current">
          <span class="sr-ico" id="ss-cur-ico">FX</span>
          <span class="ss-cur-l"><b id="ss-cur-sym">EURUSD</b><small id="ss-cur-name">Euro / U.S. Dollar</small></span>
          <button class="btn btn-outline btn-sm" id="ss-change" type="button"><i class="fa-solid fa-magnifying-glass"></i> Change</button>
        </div>
        <div id="ss-search-wrap" class="hidden">
          <div id="ss-search-inner">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input id="ss-search" type="search" placeholder="Search ~1,500 markets — EURUSD, gold, Tesla, DAX, BTC…" autocomplete="off">
          </div>
          <div id="ss-results"></div>
        </div>
      </div>
    </div>

    <div class="form-grid cols-2">
      <div class="field">
        <label>Start date <i class="info-dot" data-tip-wide data-tip="The chart rewinds to this date and hides everything after it. You reveal the future one bar at a time.">?</i></label>
        <input id="ss-start" type="date">
      </div>
      <div class="field">
        <label>Timeframe</label>
        <select id="ss-tf">
          <option value="1m">1 minute</option>
          <option value="5m">5 minutes</option>
          <option value="15m" selected>15 minutes</option>
          <option value="30m">30 minutes</option>
          <option value="1h">1 hour</option>
          <option value="4h">4 hours</option>
          <option value="1d">1 day</option>
        </select>
      </div>
      <div class="field">
        <label>Starting balance ($)</label>
        <input id="ss-balance" type="number" value="100000" min="100" step="100">
      </div>
      <div class="field">
        <label>Leverage</label>
        <select id="ss-leverage">
          <option value="1">1:1</option><option value="10">1:10</option><option value="30">1:30</option>
          <option value="50">1:50</option><option value="100" selected>1:100</option>
          <option value="200">1:200</option><option value="500">1:500</option>
        </select>
      </div>
    </div>

    <details id="ss-adv">
      <summary>Costs &amp; prop-firm rules <span class="t-faint">(optional)</span></summary>
      <div class="form-grid cols-2" style="margin-top:12px">
        <div class="field"><label>Spread (pips / points)</label><input id="ss-spread" type="number" value="0.5" step="0.1" min="0"></div>
        <div class="field"><label>Commission ($/lot/side)</label><input id="ss-commission" type="number" value="3.5" step="0.5" min="0"></div>
        <div class="field form-row-full"><label>Prop-firm rule set</label>
          <select id="ss-prop">
            <option value="none">Off — plain account</option>
            <option value="ftmo1">Evaluation Phase 1 — target 10%, daily 5%, max 10%</option>
            <option value="ftmo2">Evaluation Phase 2 — target 5%, daily 5%, max 10%</option>
            <option value="funded">Funded account — no target, daily 5%, max 10%</option>
          </select>
        </div>
      </div>
    </details>

    <div id="ss-note" class="callout">
      <i class="fa-solid fa-circle-info"></i>
      <div id="ss-note-text">The session downloads real historical data from the start date forward. Lower timeframes cover a shorter window per session.</div>
    </div>

    <div id="ss-error" class="callout err-callout hidden">
      <i class="fa-solid fa-circle-exclamation"></i>
      <div id="ss-error-text"></div>
    </div>

    <div id="ss-progress" class="hidden">
      <div class="progress-label"><span id="ss-progress-text">Downloading market data…</span><b id="ss-progress-pct">0%</b></div>
      <div class="progress"><div class="progress-fill" id="ss-progress-fill"></div></div>
    </div>
  </div>
  <div class="dialog-foot">
    <span class="foot-note">Once running: <span class="kbd">→</span> next bar · <span class="kbd">Space</span> play · <span class="kbd">B</span> buy · <span class="kbd">S</span> sell</span>
    <button class="btn dialog-close">Cancel</button>
    <button class="btn btn-primary" id="ss-start-btn"><i class="fa-solid fa-play"></i> Start session</button>
  </div>
</div>

<div id="dlg-indicators" class="dialog hidden">
  <div class="dialog-head">
    <div><h3><i class="fa-solid fa-wave-square"></i> Indicators</h3>
    <p>Click to add or remove. Overlays draw on the price chart; oscillators get their own pane.</p></div>
    <button class="dialog-close"><i class="fa-solid fa-xmark"></i></button>
  </div>
  <div class="dialog-body"><div id="indicators-list"></div></div>
  <div class="dialog-foot">
    <span class="foot-note" id="ind-count">None active</span>
    <button class="btn btn-primary dialog-close">Done</button>
  </div>
</div>

<div id="dlg-backtest" class="dialog hidden">
  <div class="dialog-head">
    <div><h3><i class="fa-solid fa-flask-vial"></i> Backtest settings</h3>
    <p id="bt-context">Strategy will run on EURUSD 1H.</p></div>
    <button class="dialog-close"><i class="fa-solid fa-xmark"></i></button>
  </div>
  <div class="dialog-body">
    <div class="form-grid cols-2">
      <div class="field">
        <label>Start date</label>
        <input id="bt-start" type="date" value="2023-01-01">
      </div>
      <div class="field">
        <label>End date</label>
        <input id="bt-end" type="date" value="2024-12-31">
      </div>
      <div class="field">
        <label>Starting balance ($)</label>
        <input id="bt-balance" type="number" value="100000" min="100" step="100">
      </div>
      <div class="field">
        <label>Leverage <i class="info-dot" data-tip-wide data-tip="How much position size your margin supports. 1:100 means $1,000 margin controls $100,000 notional.">?</i></label>
        <select id="bt-leverage">
          <option value="1">1:1 (no leverage)</option>
          <option value="10">1:10</option>
          <option value="30">1:30 (EU retail)</option>
          <option value="50">1:50</option>
          <option value="100" selected>1:100 (typical)</option>
          <option value="200">1:200</option>
          <option value="500">1:500</option>
        </select>
      </div>
      <div class="field">
        <label>Spread (pips / points) <i class="info-dot" data-tip-wide data-tip="Cost baked into every entry and exit. Data files are BID prices; the ask is bid + spread.">?</i></label>
        <input id="bt-spread" type="number" value="0.5" step="0.1" min="0">
      </div>
      <div class="field">
        <label>Commission ($ per lot per side)</label>
        <input id="bt-commission" type="number" value="3.5" step="0.5" min="0">
      </div>
      <div class="field form-row-full">
        <label>Prop-firm rule set <i class="info-dot" data-tip-wide data-tip="Adds hard daily-loss and drawdown limits. The run stops the moment a rule is breached, exactly like a real challenge.">?</i></label>
        <select id="bt-prop">
          <option value="none">Off — plain trading account</option>
          <option value="ftmo1">Evaluation Phase 1 — target 10%, daily 5%, max 10%</option>
          <option value="ftmo2">Evaluation Phase 2 — target 5%, daily 5%, max 10%</option>
          <option value="funded">Funded account — no target, daily 5%, max 10%</option>
          <option value="custom">Custom…</option>
        </select>
      </div>
      <div id="bt-prop-custom" class="form-grid cols-2 form-row-full hidden">
        <div class="field"><label>Profit target %</label><input id="pc-target" type="number" value="10" step="0.5"></div>
        <div class="field"><label>Daily loss limit %</label><input id="pc-daily" type="number" value="5" step="0.5"></div>
        <div class="field"><label>Max drawdown %</label><input id="pc-max" type="number" value="10" step="0.5"></div>
        <div class="field"><label>Drawdown basis</label>
          <select id="pc-ddtype"><option value="static">Static — from starting balance</option><option value="trailing">Trailing — from equity peak</option></select>
        </div>
      </div>
    </div>
    <div class="field form-row-full" style="margin-top:4px">
      <label class="switch">
        <input type="checkbox" id="bt-news" checked>
        <span>Load the real economic calendar for this window</span>
      </label>
      <span class="field-hint">Marks releases on the chart and exposes them to strategies through
        <code>ctx.news</code>. Adds one request per calendar month.</span>
    </div>
    <div class="field form-row-full" style="margin-top:4px">
      <label class="switch">
        <input type="checkbox" id="bt-refine">
        <span>Re-price fills against real order-book data</span>
      </label>
      <span class="field-hint">After the run, every fill is priced again at the quote that actually
        existed: real bid/ask from tick files for forex, indices, commodities and shares; size-based
        slippage from archived book depth for crypto. Stops are re-priced at the tick that really
        crossed them, so gaps cost what they cost. Downloads a few hundred small files — only the
        bars where a trade opened or closed.</span>
    </div>
    <div class="callout brand" style="margin-top:16px">
      <i class="fa-solid fa-circle-info"></i>
      <div>Longer ranges and lower timeframes download more files and take longer. A 2-year 1H forex test is roughly 24 monthly files; a 1-month M1 test is ~22 daily files.</div>
    </div>
    <div id="bt-progress" class="hidden" style="margin-top:16px">
      <div class="progress-label"><span id="bt-progress-text">Preparing…</span><b id="bt-progress-pct">0%</b></div>
      <div class="progress"><div class="progress-fill" id="bt-progress-fill"></div></div>
    </div>
  </div>
  <div class="dialog-foot">
    <span class="foot-note" id="bt-lang-note"></span>
    <button class="btn dialog-close">Cancel</button>
    <button class="btn btn-primary" id="bt-run"><i class="fa-solid fa-play"></i> Run backtest</button>
  </div>
</div>

<div id="dlg-account" class="dialog hidden">
  <div class="dialog-head">
    <div><h3><i class="fa-solid fa-sliders"></i> Default trading account</h3>
    <p>The account a <b>Backtesting Session</b> starts with. Saved in this browser and pre-filled into the session popup.</p></div>
    <button class="dialog-close"><i class="fa-solid fa-xmark"></i></button>
  </div>
  <div class="dialog-body">
    <div class="form-grid cols-2">
      <div class="field"><label>Balance ($)</label><input id="am-balance" type="number" value="100000" min="100" step="100"></div>
      <div class="field"><label>Leverage</label>
        <select id="am-leverage">
          <option value="1">1:1</option><option value="10">1:10</option><option value="30">1:30</option>
          <option value="50">1:50</option><option value="100" selected>1:100</option>
          <option value="200">1:200</option><option value="500">1:500</option>
        </select>
      </div>
      <div class="field"><label>Spread (pips / points)</label><input id="am-spread" type="number" value="0.5" step="0.1" min="0"></div>
      <div class="field"><label>Commission ($/lot/side)</label><input id="am-commission" type="number" value="3.5" step="0.5" min="0"></div>
      <div class="field form-row-full"><label>Prop-firm rule set</label>
        <select id="am-prop">
          <option value="none">Off — plain account</option>
          <option value="ftmo1">Evaluation Phase 1 — target 10%, daily 5%, max 10%</option>
          <option value="ftmo2">Evaluation Phase 2 — target 5%, daily 5%, max 10%</option>
          <option value="funded">Funded account — no target, daily 5%, max 10%</option>
        </select>
      </div>
    </div>

    <div id="am-live-note" class="callout hidden" style="margin-top:16px">
      <i class="fa-solid fa-circle-info"></i>
      <div>A session is running right now. It keeps the account it started with — these
        numbers will apply to the <b>next</b> session you start.</div>
    </div>
  </div>
  <div class="dialog-foot">
    <span class="foot-note">Nothing here touches a running session.</span>
    <button class="btn dialog-close">Cancel</button>
    <button class="btn btn-primary" id="am-apply">Save settings</button>
  </div>
</div>

<div id="dlg-goto" class="dialog hidden" style="width:440px">
  <div class="dialog-head">
    <div><h3><i class="fa-solid fa-calendar-day"></i> Jump to date</h3>
    <p>The chart rewinds to this date. Everything after it is hidden until you step forward.</p></div>
    <button class="dialog-close"><i class="fa-solid fa-xmark"></i></button>
  </div>
  <div class="dialog-body">
    <div class="field"><label>Start from</label><input id="goto-date" type="date"></div>
    <div class="callout warn-callout" style="margin-top:14px">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <div>Jumping resets the account and clears this session's trades. The date must be
        inside the window that was downloaded when the session started.</div>
    </div>
    <div class="callout" style="margin-top:10px">
      <i class="fa-solid fa-keyboard"></i>
      <div><b>Shortcuts:</b> <span class="kbd">&rarr;</span> next bar · <span class="kbd">&larr;</span> previous bar · <span class="kbd">Space</span> play/pause</div>
    </div>
  </div>
  <div class="dialog-foot">
    <button class="btn dialog-close">Cancel</button>
    <button class="btn btn-primary" id="goto-apply">Jump</button>
  </div>
</div>

<script src="/static/js/symbols.js"></script>
<script src="/static/js/catalog.js"></script>
<script src="/static/js/data.js"></script>
<script src="/static/js/indicators.js"></script>
<script src="/static/js/chart.js"></script>
<script src="/static/js/drawings.js"></script>
<script src="/static/js/trade-overlay.js"></script>
<script src="/static/js/news.js"></script>
<script src="/static/js/engine.js"></script>
<script src="/static/js/book.js"></script>
<script src="/static/js/refine.js"></script>
<script src="/static/js/exchanges.js"></script>
<script src="/static/js/tape.js"></script>
<script src="/static/js/cryptohub.js"></script>
<script src="/static/js/livecrypto.js"></script>
<script src="/static/js/micropanels.js"></script>
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
<script src="/static/js/cbook.js"></script>
<script src="/static/js/live-chart.js"></script>
<script src="/static/js/micro-report.js"></script>
<script src="/static/js/pine.js"></script>
<script src="/static/js/strategies.js"></script>
<script src="/static/js/strategy.js"></script>
<script src="/static/js/replay.js"></script>
<script src="/static/js/backtest-ui.js"></script>
<script src="/static/js/app.js"></script>
<script src="/static/js/session.js"></script>
</body>
</html>`
