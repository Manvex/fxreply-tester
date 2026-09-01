// ===========================================================================
// Terminal bootstrap — wires the chart workspace: symbol/timeframe switching,
// dialogs, watchlist, legend, account rail, editor, replay, onboarding hints.
// ===========================================================================
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ---- account settings: persisted so what you set is what you get --------
  const SETTINGS_KEY = 'bt_manual_settings';
  const DEFAULT_SETTINGS = { balance: 100000, leverage: 100, spread: 0.5, commission: 3.5, propMode: 'none' };

  function readSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (!s) return { ...DEFAULT_SETTINGS };
      return {
        balance: Number(s.balance) || DEFAULT_SETTINGS.balance,
        leverage: parseInt(s.leverage) || DEFAULT_SETTINGS.leverage,
        spread: Number.isFinite(+s.spread) ? +s.spread : DEFAULT_SETTINGS.spread,
        commission: Number.isFinite(+s.commission) ? +s.commission : DEFAULT_SETTINGS.commission,
        propMode: s.propMode || 'none',
      };
    } catch (_) { return { ...DEFAULT_SETTINGS }; }
  }

  const App = {
    currentSymbol: 'EURUSD',
    currentTF: '1h',
    get currentSymbolInfo() { return getSymbol(this.currentSymbol); },
    manualSettings: readSettings(),
    chartRange: { from: null, to: null },
  };
  window.App = App;

  /**
   * Single writer for the manual/session account settings. Persists, mirrors
   * into every dialog and — crucially — never resets a live session's broker.
   */
  App.setManualSettings = (s, opts = {}) => {
    App.manualSettings = {
      balance: Number(s.balance) || DEFAULT_SETTINGS.balance,
      leverage: parseInt(s.leverage) || DEFAULT_SETTINGS.leverage,
      spread: Number.isFinite(+s.spread) ? +s.spread : 0,
      commission: Number.isFinite(+s.commission) ? +s.commission : 0,
      propMode: s.propMode || 'none',
    };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(App.manualSettings)); } catch (_) {}
    syncSettingsDialog();
    if (!Replay.isActive()) App.resetAccountUI();
    if (!opts.silent) App.toast('Account settings saved', 'ok');
    return App.manualSettings;
  };

  function syncSettingsDialog() {
    const s = App.manualSettings;
    if ($('#am-balance')) $('#am-balance').value = s.balance;
    if ($('#am-leverage')) $('#am-leverage').value = String(s.leverage);
    if ($('#am-spread')) $('#am-spread').value = s.spread;
    if ($('#am-commission')) $('#am-commission').value = s.commission;
    if ($('#am-prop')) $('#am-prop').value = s.propMode;
  }

  const fmt$ = (v) => (v < 0 ? '-$' : '$') + Math.abs(Number(v) || 0).toLocaleString(undefined,
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cls = (v) => v > 0 ? 'up' : v < 0 ? 'down' : '';
  App.fmt$ = fmt$;

  // ------------------------------------------------------------------ toast
  App.toast = (msg, kind = 'info') => {
    const host = $('#toast-host');
    if (!host) return;
    const ico = { ok: 'fa-circle-check', err: 'fa-circle-exclamation', warn: 'fa-triangle-exclamation', info: 'fa-circle-info' }[kind] || 'fa-circle-info';
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = `<i class="fa-solid ${ico}"></i><span>${msg}</span>`;
    host.appendChild(el);
    setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 240); }, 4000);
  };

  // ------------------------------------------------------------------ dialogs
  App.closeModals = () => {
    $$('.dialog').forEach(d => d.classList.add('hidden'));
    $('#backdrop').classList.add('hidden');
  };
  function openDialog(sel) {
    App.closeModals();
    $(sel).classList.remove('hidden');
    $('#backdrop').classList.remove('hidden');
  }
  App.openDialog = openDialog;
  App.anyDialogOpen = () => $$('.dialog:not(.hidden)').length > 0;
  $('#backdrop').addEventListener('click', App.closeModals);
  $$('.dialog-close').forEach(b => b.addEventListener('click', App.closeModals));
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (TradeOverlay.isPicking()) { TradeOverlay.cancelPick(); return; }
    App.closeModals();
  });

  // ------------------------------------------------------------------ chart
  ChartMgr.init($('#chart-container'));
  Draw.init($('#draw-canvas'), $('#chart-wrap'));
  TradeOverlay.init($('#trade-canvas'), $('#chart-wrap'));

  // The legend is a function, not just a crosshair callback, so it is always
  // populated — before you ever move the mouse, and after every replay step.
  // (Previously it only filled in on crosshair move, so it read as "blank/
  // disappearing" during a session.)
  function renderLegend(param) {
    const info = App.currentSymbolInfo;
    const legend = $('#chart-legend');
    if (!legend) return;
    let bar = null;
    if (param && param.time && param.seriesData) bar = param.seriesData.get(ChartMgr.series);
    if (!bar) { const c = ChartMgr.candles; bar = c[c.length - 1]; }
    if (!bar) { legend.innerHTML = ''; return; }

    const dg = info.digits;
    const up = bar.close >= bar.open;
    const k = up ? 'up' : 'down';
    const chg = bar.close - bar.open;
    const chgPct = bar.open ? (chg / bar.open * 100) : 0;

    const inds = [...ChartMgr.activeIndicators].map(id => {
      const d = INDICATOR_DEFS.find(x => x.id === id);
      return d ? `<span class="lg-ind-item"><span class="lg-swatch" style="background:${d.color || 'var(--t-2)'}"></span>${d.name}</span>` : '';
    }).join('');

    legend.innerHTML = `
      <div class="lg-top">
        <span class="lg-sym">${App.currentSymbol}</span>
        <span class="lg-tf">${App.currentTF.toUpperCase()}</span>
        <span class="lg-src">${info.source === 'binance' ? 'Binance' : 'Dukascopy'}</span>
      </div>
      <div class="lg-ohlc">
        <span>O<b class="${k}">${(+bar.open).toFixed(dg)}</b></span>
        <span>H<b class="${k}">${(+bar.high).toFixed(dg)}</b></span>
        <span>L<b class="${k}">${(+bar.low).toFixed(dg)}</b></span>
        <span>C<b class="${k}">${(+bar.close).toFixed(dg)}</b></span>
        <span><b class="${k}">${chg >= 0 ? '+' : ''}${chg.toFixed(dg)} (${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%)</b></span>
      </div>
      ${inds ? `<div class="lg-inds">${inds}</div>` : ''}`;
  }
  App.renderLegend = renderLegend;
  ChartMgr.chart.subscribeCrosshairMove(renderLegend);

  // ------------------------------------------------------------------ loading
  function setLoading(on, text, pct) {
    const el = $('#chart-loading');
    if (!on) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (text) $('#cl-text').textContent = text;
    $('#cl-fill').style.width = (pct == null ? 0 : Math.round(pct * 100)) + '%';
  }

  const SPANS = {
    '1m': 5 * 86400, '5m': 20 * 86400, '15m': 45 * 86400, '30m': 80 * 86400,
    '1h': 320 * 86400, '4h': 900 * 86400, '1d': 8 * 365 * 86400, '1w': 15 * 365 * 86400,
  };

  /**
   * Guard: switching symbol or timeframe destroys the session's candle array,
   * so ask instead of silently wiping the user's trades.
   */
  function confirmLeaveSession(what) {
    if (!Replay.isActive()) return true;
    const ok = confirm(`A backtesting session is running.\n\nChanging the ${what} will end it and discard its trades. Continue?`);
    if (ok) Replay.exit();
    return ok;
  }

  let loadSeq = 0;
  async function loadChart() {
    const info = App.currentSymbolInfo;
    const seq = ++loadSeq;
    setLoading(true, 'Downloading real market data…', 0);
    $('#symbol-btn .sb-sym').textContent = App.currentSymbol;
    $('#symbol-btn .sb-src').textContent = info.source === 'binance' ? 'Binance' : 'Dukascopy';
    $('#bt-context').textContent = `Strategy will run on ${App.currentSymbol} ${App.currentTF.toUpperCase()} (${info.name}).`;
    if (Replay.isActive()) Replay.exit();

    const now = Math.floor(Date.now() / 1000);
    const from = now - (SPANS[App.currentTF] || 90 * 86400);

    try {
      const candles = await DataStore.load(App.currentSymbol, App.currentTF, from, now,
        (p) => { if (seq === loadSeq) setLoading(true, 'Downloading real market data…', p); });
      if (seq !== loadSeq) return;   // a newer load superseded this one
      if (!candles.length) {
        App.toast('No data available for ' + App.currentSymbol + ' on this timeframe', 'warn');
      }
      ChartMgr.setData(candles, info, { lastBars: 260 });
      ChartMgr.setMarkers([]);
      renderLegend();
      App.chartRange = { from, to: now };
      Draw.setStoreKey(App.currentSymbol + ':' + App.currentTF);
      $('#bars-info').innerHTML = candles.length
        ? `<i class="fa-solid fa-database" style="font-size:9px"></i> ${candles.length.toLocaleString()} bars`
        : '';
    } catch (e) {
      console.error(e);
      if (seq === loadSeq) App.toast('Could not load data: ' + e.message, 'err');
    } finally {
      if (seq === loadSeq) setLoading(false);
    }
  }
  App.loadChart = loadChart;

  // ------------------------------------------------------------------ timeframe
  $$('.tf-btn').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.tf === App.currentTF && !Replay.isActive()) return;
    if (!confirmLeaveSession('timeframe')) return;
    $$('.tf-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    App.currentTF = b.dataset.tf;
    loadChart();
  }));
  function selectTF(tf) {
    const b = $(`.tf-btn[data-tf="${tf}"]`);
    if (!b) return;
    $$('.tf-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    App.currentTF = tf;
    window.LiveChart && LiveChart.refresh();
  }

  // ------------------------------------------------------------------ symbol picker
  const CAT_LABEL = { forex: 'FX', indices: 'IDX', stocks: 'EQ', etf: 'ETF', commodities: 'CMD', crypto: 'CRY', bonds: 'BND', funds: 'FND' };
  let symFilter = '', symCat = 'all', symIdx = -1, symSearchSeq = 0;

  function symRowHTML(s, i, isCatalog) {
    return `
      <div class="sym-row ${i === symIdx ? 'kb' : ''}" data-sym="${s.sym}" data-catalog="${isCatalog ? 1 : 0}">
        <span class="sr-ico">${CAT_LABEL[s.cat] || '?'}</span>
        <span class="sr-l">
          <div class="sr-sym">${s.sym}${s.label && s.label !== s.sym ? ` <small style="color:var(--t-4);font-weight:400">${s.label}</small>` : ''}</div>
          <div class="sr-name">${s.name}</div>
        </span>
        <span class="sr-r">
          ${s.since ? `<span class="pill">since ${s.since}</span>` : ''}
          <span class="pill">${s.source === 'binance' ? 'Binance' : 'Dukascopy'}</span>
        </span>
      </div>`;
  }

  function bindSymbolRows() {
    $$('#symbol-list .sym-row').forEach(r => r.addEventListener('click', () => pickSymbol(r.dataset.sym)));
  }

  async function renderSymbolList() {
    const f = symFilter.trim();
    const host = $('#symbol-list');
    const seq = ++symSearchSeq;

    // No query: show the curated list only (search-first for the full catalog)
    if (!f) {
      const items = SYMBOLS.filter(s => symCat === 'all' || s.cat === symCat);
      host.innerHTML = items.map((s, i) => symRowHTML(s, i, false)).join('') +
        `<div class="ss-hint" style="margin-top:6px"><i class="fa-solid fa-magnifying-glass"></i>
         Type to search the full Dukascopy catalog — ~1,500 more instruments (stocks, ETFs, exotics, bonds…)</div>`;
      bindSymbolRows();
      return;
    }

    let res;
    try { res = await Catalog.search(f, symCat, 60); }
    catch (_) {
      const F = f.toUpperCase();
      const items = SYMBOLS.filter(s => (symCat === 'all' || s.cat === symCat) &&
        (s.sym.includes(F) || s.name.toUpperCase().includes(F)));
      res = { curated: items, catalog: [] };
    }
    if (seq !== symSearchSeq) return; // stale response

    let i = 0;
    const parts = [];
    if (res.curated.length) parts.push(res.curated.map(s => symRowHTML(s, i++, false)).join(''));
    if (res.catalog.length) {
      parts.push(`<div class="ss-group">Full Dukascopy catalog</div>`);
      parts.push(res.catalog.map(s => symRowHTML(s, i++, true)).join(''));
    }
    host.innerHTML = parts.length ? parts.join('')
      : `<div class="empty" style="padding:30px"><div class="empty-icon"><i class="fa-solid fa-magnifying-glass"></i></div>
         <h4>Nothing matches “${symFilter}”</h4><p>Try a ticker (AAPL), a name (gold, Tencent, DAX) or a pair (EURUSD).</p></div>`;
    bindSymbolRows();
  }
  async function pickSymbol(sym) {
    let info = window.findSymbol(sym);
    if (!info && window.Catalog) info = await Catalog.findAndRegister(sym);
    if (!info) { App.toast('Unknown instrument: ' + sym, 'err'); return; }
    if (info.sym === App.currentSymbol && !Replay.isActive()) { App.closeModals(); return; }
    if (!confirmLeaveSession('instrument')) return;
    App.currentSymbol = info.sym;
    App.closeModals();
    loadChart();
    highlightWatchlist();
    App.refreshDom && App.refreshDom();
  }
  function openSymbolPicker() {
    openDialog('#dlg-symbol');
    symIdx = -1;
    $('#symbol-search').value = symFilter;
    renderSymbolList();
    setTimeout(() => $('#symbol-search').focus(), 40);
  }
  $('#symbol-btn').addEventListener('click', openSymbolPicker);
  $('#wl-add').addEventListener('click', openSymbolPicker);
  $('#symbol-search').addEventListener('input', e => { symFilter = e.target.value; symIdx = -1; renderSymbolList(); });
  $('#symbol-search').addEventListener('keydown', e => {
    const rows = $$('#symbol-list .sym-row');
    if (e.key === 'ArrowDown') { e.preventDefault(); symIdx = Math.min(symIdx + 1, rows.length - 1); renderSymbolList(); rows[symIdx]?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'ArrowUp') { e.preventDefault(); symIdx = Math.max(symIdx - 1, 0); renderSymbolList(); }
    if (e.key === 'Enter') {
      const target = rows[symIdx] || rows[0];
      if (target) pickSymbol(target.dataset.sym);
    }
  });
  $$('#symbol-cats .chip').forEach(c => c.addEventListener('click', () => {
    $$('#symbol-cats .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    symCat = c.dataset.cat; symIdx = -1;
    renderSymbolList();
  }));

  // ------------------------------------------------------------------ watchlist
  const WL = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30', 'NAS100', 'SPX500', 'AAPL', 'NVDA', 'TSLA', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  function renderWatchlist() {
    $('#watchlist').innerHTML = WL.map(sym => {
      const s = getSymbol(sym);
      return `<div class="wl-item" data-sym="${sym}">
        <span class="wl-l"><div class="wl-sym">${sym}</div><div class="wl-name">${s.name}</div></span>
        <span class="wl-r"><div class="wl-px" id="wlp-${sym}">—</div></span>
      </div>`;
    }).join('');
    $$('.wl-item').forEach(r => r.addEventListener('click', () => pickSymbol(r.dataset.sym)));
    highlightWatchlist();
  }
  function highlightWatchlist() {
    $$('.wl-item').forEach(r => r.classList.toggle('active', r.dataset.sym === App.currentSymbol));
  }

  // ------------------------------------------------------------------ indicators
  function renderIndicators() {
    $('#indicators-list').innerHTML = INDICATOR_DEFS.map(d => {
      const on = ChartMgr.activeIndicators.has(d.id);
      return `<div class="ind-row ${on ? 'on' : ''}" data-ind="${d.id}">
        <span class="ir-sw" style="background:${d.color || 'var(--t-3)'}"></span>
        <span class="ir-l">
          <div class="ir-name">${d.name}</div>
          <div class="ir-desc">${d.desc || (d.pane === 'main' ? 'Price overlay' : 'Separate pane')}</div>
        </span>
        <span class="ir-check"><i class="fa-solid fa-check"></i></span>
      </div>`;
    }).join('');
    $$('#indicators-list .ind-row').forEach(r => r.addEventListener('click', () => {
      ChartMgr.toggleIndicator(r.dataset.ind);
      renderIndicators();
    }));
    const n = ChartMgr.activeIndicators.size;
    $('#ind-count').textContent = n ? `${n} indicator${n > 1 ? 's' : ''} on the chart` : 'None active';
  }
  $('#btn-indicators').addEventListener('click', () => { openDialog('#dlg-indicators'); renderIndicators(); });

  // ------------------------------------------------------------------ drawing tools
  $$('.tool-btn[data-tool]').forEach(b => b.addEventListener('click', () => {
    $$('.tool-btn[data-tool]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    Draw.setTool(b.dataset.tool);
  }));
  $('#tool-magnet').addEventListener('click', function () {
    this.classList.toggle('active', Draw.toggleMagnet());
  });
  $('#tool-del').addEventListener('click', () => Draw.deleteSelected());
  $('#tool-delall').addEventListener('click', () => {
    Draw.deleteAll();
    App.toast('All drawings cleared', 'ok');
  });

  // ------------------------------------------------------------------ dock
  function openTab(tab) {
    $$('.dock-tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
    $$('.dock-page').forEach(p => p.classList.toggle('active', p.dataset.page === tab));
    $('#dock').classList.remove('collapsed');
  }
  App.openTab = openTab;
  $$('.dock-tab').forEach(b => b.addEventListener('click', () => openTab(b.dataset.tab)));
  $('#dock-collapse').addEventListener('click', () => {
    const c = $('#dock').classList.toggle('collapsed');
    $('#dock-collapse').innerHTML = `<i class="fa-solid fa-chevron-${c ? 'up' : 'down'}"></i>`;
  });
  $('#dock-expand').addEventListener('click', () => $('#dock').classList.toggle('tall'));

  // drag resize
  (() => {
    const handle = $('#dock-resize'), dock = $('#dock');
    let start = 0, h0 = 0, on = false;
    handle.addEventListener('mousedown', e => { on = true; start = e.clientY; h0 = dock.offsetHeight; e.preventDefault(); document.body.style.userSelect = 'none'; });
    window.addEventListener('mousemove', e => {
      if (!on) return;
      const h = Math.min(Math.max(h0 + (start - e.clientY), 39), window.innerHeight - 160);
      dock.classList.remove('tall');
      dock.style.height = h + 'px';
    });
    window.addEventListener('mouseup', () => { on = false; document.body.style.userSelect = ''; });
  })();

  $$('.res-tab').forEach(b => b.addEventListener('click', () => {
    $$('.res-tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $$('.res-page').forEach(p => p.classList.toggle('active', p.dataset.res === b.dataset.res));
  }));

  $('#empty-run').addEventListener('click', () => openDialog('#dlg-backtest'));
  $('#empty-editor').addEventListener('click', () => openTab('editor'));

  // ------------------------------------------------------------------ editor
  const langSel = $('#strategy-lang'), pickSel = $('#strategy-pick'), codeTA = $('#strategy-code');

  const API_DOCS = {
    js: [
      ['Trading', [
        ['ctx.buy(lots, sl, tp)', 'Open a long position'],
        ['ctx.sell(lots, sl, tp)', 'Open a short position'],
        ['ctx.closeAll()', 'Close everything at this bar'],
        ['ctx.setStops(sl, tp)', 'Modify stops on open positions'],
      ]],
      ['Sizing & state', [
        ['ctx.riskLots(pct, dist)', 'Lots risking pct% over dist'],
        ['ctx.position()', 'Net lots: + long, − short'],
        ['ctx.openCount()', 'Number of open positions'],
        ['ctx.balance()', 'Realised cash'],
        ['ctx.equity()', 'Balance + floating P/L'],
        ['ctx.symInfo', 'pip, lotUnits, digits…'],
      ]],
      ['Indicators (ctx.ta)', [
        ['ta.sma(arr, n)', 'Simple moving average'],
        ['ta.ema(arr, n)', 'Exponential MA'],
        ['ta.rsi(arr, n)', 'Relative strength index'],
        ['ta.atr(candles, n)', 'Average true range'],
        ['ta.stdev(arr, n)', 'Standard deviation'],
        ['ta.bollinger(arr, n, k)', '{upper, basis, lower}'],
        ['ta.macd(arr, f, s, sig)', '{macd, signal, hist}'],
        ['ta.highest(arr, n)', 'Rolling maximum'],
        ['ta.lowest(arr, n)', 'Rolling minimum'],
        ['ta.crossover(a, b, i)', 'a crossed above b'],
        ['ta.crossunder(a, b, i)', 'a crossed below b'],
        ['ctx.atr14[i]', 'Pre-computed ATR(14)'],
      ]],
      ['Economic calendar (ctx.news)', [
        ['ctx.news.minsToNext([imp], [cur])', 'Minutes to the next release (Infinity if none)'],
        ['ctx.news.minsSinceLast([imp], [cur])', 'Minutes since the last release'],
        ['ctx.news.isNear(mins, [imp], [cur])', 'True inside +/- mins of a release'],
        ['ctx.news.next([imp], [cur])', 'The next event object, or null'],
        ['ctx.news.last([imp], [cur])', 'The last released event, or null'],
        ['ctx.news.today([imp], [cur])', "Events on this bar's calendar day"],
        ['ctx.news.count()', 'Events loaded for this backtest'],
      ]],
    ],
    pine: [
      ['Series', [
        ['open high low close', 'Current bar prices'],
        ['volume  hl2  hlc3  ohlc4', 'Derived series'],
        ['close[1]', 'Value n bars ago'],
        ['bar_index  time', 'Bar counter, timestamp'],
      ]],
      ['ta.*', [
        ['ta.sma / ema / rma / wma', 'Moving averages'],
        ['ta.rsi(close, n)', 'RSI'],
        ['ta.atr(n)  ta.tr', 'True range family'],
        ['ta.stdev(close, n)', 'Standard deviation'],
        ['ta.highest / lowest', 'Rolling extremes'],
        ['ta.macd(src, f, s, sig)', 'Returns 3 series'],
        ['ta.crossover / crossunder', 'Cross detection'],
        ['ta.change(src)', 'Difference vs previous bar'],
      ]],
      ['strategy.*', [
        ['strategy.entry(id, dir, qty)', 'Market entry (netting)'],
        ['strategy.exit(id, from_entry=…, stop=…, limit=…)', 'Attach stop / target'],
        ['strategy.close(id)', 'Close a named entry'],
        ['strategy.close_all()', 'Flatten'],
        ['strategy.position_size', 'Net position'],
        ['strategy.long / short', 'Direction constants'],
      ]],
      ['news.* (BlackTick extension)', [
        ['news.mins_to_next("high")', 'Minutes to the next release'],
        ['news.mins_since_last("high")', 'Minutes since the last release'],
        ['news.is_near(30, "high")', 'True inside the window'],
        ['news.count()', 'Events loaded'],
      ]],
      ['Not supported', [
        ['request.security()', 'No multi-timeframe'],
        ['functions, arrays, maps', 'Not implemented'],
        ['alerts, labels, boxes', 'Ignored'],
      ]],
    ],
    python: [
      ['Trading', [
        ['ctx.buy(lots, sl=None, tp=None)', 'Open a long'],
        ['ctx.sell(lots, sl=None, tp=None)', 'Open a short'],
        ['ctx.close_all()', 'Flatten everything'],
        ['ctx.set_stops(sl, tp)', 'Modify open stops'],
      ]],
      ['Sizing & state', [
        ['ctx.risk_lots(pct, dist)', 'Risk-based size'],
        ['ctx.position()', 'Net lots'],
        ['ctx.open_count()', 'Open position count'],
        ['ctx.balance()  ctx.equity()', 'Account state'],
        ['ctx.log(*args)', 'Print to console'],
      ]],
      ['Data', [
        ['candles[i]["close"]', 'dict per bar'],
        ['import numpy as np', 'numpy is available'],
        ['def init(candles, ctx)', 'Optional pre-compute hook'],
        ['def bar(i, candles, ctx)', 'Required per-bar hook'],
      ]],
      ['Economic calendar', [
        ['ctx.news_mins_to_next(["high"])', 'Minutes to the next release'],
        ['ctx.news_mins_since_last(["high"])', 'Minutes since the last release'],
        ['ctx.news_is_near(30, ["high"])', 'True inside the window'],
        ['ctx.news_count()', 'Events loaded'],
      ]],
    ],
  };

  function renderApiHelp() {
    const groups = API_DOCS[langSel.value] || [];
    $('#api-help').innerHTML = groups.map(([title, fns]) =>
      `<h5>${title}</h5>` + fns.map(([sig, desc]) =>
        `<span class="api-fn" data-ins="${sig.replace(/"/g, '&quot;')}">${sig}<em>${desc}</em></span>`).join('')
    ).join('');
    $$('#api-help .api-fn').forEach(a => a.addEventListener('click', () => {
      const t = codeTA, ins = a.dataset.ins;
      const p = t.selectionStart;
      t.value = t.value.slice(0, p) + ins + t.value.slice(t.selectionEnd);
      t.selectionStart = t.selectionEnd = p + ins.length;
      t.focus();
    }));
  }
  $('#api-help-toggle').addEventListener('click', () => $('#api-help').classList.toggle('hidden'));

  function describeStrategy(st) {
    if (!st) { $('#strategy-about').innerHTML = ''; return; }
    if (st.family === 'template') {
      $('#strategy-about').innerHTML = `<i class="fa-solid fa-file-code" style="color:var(--t-3)"></i>
        <b>${st.name}</b> — ${st.summary}`;
      return;
    }
    const fam = FAMILY_META[st.family];
    $('#strategy-about').innerHTML = `
      <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:5px">
        <i class="fa-solid ${fam.icon}" style="color:${fam.color}"></i>
        <b style="color:var(--t-1);font-size:12.5px">${st.name}</b>
        <span class="pill">${fam.label}</span>
        <span class="pill">Best on ${st.tf.join(' · ')}</span>
      </div>
      <div>${st.summary}</div>
      <div style="margin-top:6px;color:var(--t-3);font-size:11.5px">
        <b style="color:var(--t-2)">Exit:</b> ${st.rules.exit} &nbsp;·&nbsp;
        <b style="color:var(--t-2)">Size:</b> ${st.rules.sizing}
      </div>`;
  }

  function fillPicker(selectId) {
    const list = strategiesByLang(langSel.value);
    const grouped = {};
    list.forEach(s => { (grouped[s.family] ||= []).push(s); });
    pickSel.innerHTML = Object.entries(grouped).map(([fam, items]) =>
      `<optgroup label="${(FAMILY_META[fam] || { label: fam }).label}">` +
      items.map(s => `<option value="${s.id}">${s.name}</option>`).join('') + '</optgroup>').join('');
    const target = (selectId && list.find(s => s.id === selectId)) ? selectId : list[0]?.id;
    if (target) {
      pickSel.value = target;
      const st = getStrategy(target);
      codeTA.value = st.code;
      describeStrategy(st);
    }
    renderApiHelp();
  }
  App.loadStrategyById = (id) => {
    const st = getStrategy(id);
    if (!st) return false;
    langSel.value = st.lang;
    fillPicker(id);
    return true;
  };
  App.currentStrategyLang = () => langSel.value;
  App.currentStrategyCode = () => codeTA.value;

  langSel.addEventListener('change', () => fillPicker());
  pickSel.addEventListener('change', () => {
    const st = getStrategy(pickSel.value);
    codeTA.value = st.code;
    describeStrategy(st);
  });
  fillPicker();

  $('#editor-validate').addEventListener('click', () => {
    const v = StrategyRunner.validate(langSel.value, codeTA.value);
    const msg = $('#editor-msg');
    msg.className = v.ok ? 'ok' : 'err';
    msg.innerHTML = v.ok
      ? '<i class="fa-solid fa-circle-check"></i> Syntax looks fine'
      : `<i class="fa-solid fa-circle-xmark"></i> ${v.error}`;
    setTimeout(() => { msg.innerHTML = ''; msg.className = ''; }, 6000);
  });
  $('#editor-run').addEventListener('click', () => openDialog('#dlg-backtest'));
  $('#btn-tester').addEventListener('click', () => openDialog('#dlg-backtest'));

  // ------------------------------------------------------------------ live crypto rail
  // The watchlist and the live stack share the rail's tall slot. Crypto gets the
  // live view by default because that is the only feed with something to show in
  // real time; the user can pin it back to the watchlist and that choice sticks.
  const RAIL_LS = 'bt_rail_mode';
  let railPref = null;                       // null = follow the instrument
  try { railPref = localStorage.getItem(RAIL_LS); } catch (_e) {}

  function railWantsLive() {
    if (!window.CryptoHub || !CryptoHub.isCrypto(App.currentSymbol)) return false;
    return railPref !== 'watchlist';
  }

  function syncRail() {
    const wl = $('#rail-watchlist-sec'), lv = $('#rail-live-sec');
    if (!wl || !lv) return;
    const crypto = window.CryptoHub && CryptoHub.isCrypto(App.currentSymbol);
    const live = railWantsLive();

    wl.classList.toggle('hidden', live);
    lv.classList.toggle('hidden', !live);
    $('#rail-live-on') && $('#rail-live-on').classList.toggle('hidden', !crypto || live);
    if (live) {
      $('#rail-live-sym').textContent = App.currentSymbol;
      CryptoHub.setSymbol(App.currentSymbol);
      LiveCrypto.mount({
        book: $('#rail-book'), delta: $('#rail-delta'),
        whales: $('#rail-whales'), venues: $('#rail-live-venues'),
      }, { density: 'rail', symbol: App.currentSymbol });
    } else {
      window.LiveCrypto && LiveCrypto.unmount();
    }
  }

  $('#lq-band') && $('#lq-band').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('#lq-band button').forEach(x => x.classList.toggle('active', x === b));
    MicroPanels.setBand(parseFloat(b.dataset.band));
  });
  $('#lq-mult') && $('#lq-mult').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('#lq-mult button').forEach(x => x.classList.toggle('active', x === b));
    MicroPanels.setFpMult(parseInt(b.dataset.mult));
  });
  $('#lq-bars') && $('#lq-bars').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('#lq-bars button').forEach(x => x.classList.toggle('active', x === b));
    MicroPanels.setBars(parseInt(b.dataset.bars));
  });

  $('#rail-live-on') && $('#rail-live-on').addEventListener('click', () => {
    railPref = 'live';
    try { localStorage.setItem(RAIL_LS, railPref); } catch (_e) {}
    syncRail();
  });
  $('#rail-live-off') && $('#rail-live-off').addEventListener('click', () => {
    railPref = 'watchlist';
    try { localStorage.setItem(RAIL_LS, railPref); } catch (_e) {}
    syncRail();
  });

  // Called whenever the instrument, timeframe or session state changes.
  App.refreshDom = () => {
    window.ConsolidatedBook && ConsolidatedBook.onSymbolChange();
    window.LiveChart && LiveChart.refresh();
    window.MicroPanels && MicroPanels.onSymbolChange();
    syncRail();
  };
  // The liquidity panels hold exchange sockets open, so they only run while
  // their tab is the one on screen.
  function syncLiquidityTab() {
    const on = $('.dock-tab[data-tab="liquidity"]')?.classList.contains('active');
    if (!window.MicroPanels) return;
    if (on && CryptoHub.isCrypto(App.currentSymbol)) {
      MicroPanels.mount({ heat: $('#lq-heat'), foot: $('#lq-foot') });
    } else {
      MicroPanels.unmount();
    }
    const note = $('#lq-note');
    if (note) {
      if (!CryptoHub.isCrypto(App.currentSymbol)) {
        note.textContent = `${App.currentSymbol} has no per-level feed — crypto only`;
      } else {
        const st = MicroPanels.status();
        note.textContent = `${st.seconds}s of book · ${st.backfill || st.bars + ' bars'}`;
      }
    }
  }
  $$('.dock-tab').forEach(t => t.addEventListener('click', () => setTimeout(syncLiquidityTab, 30)));
  setInterval(() => { if ($('#lq-note')) syncLiquidityTab(); }, 2000);

  window.PWA && PWA.init();
  window.ConsolidatedBook && ConsolidatedBook.init();
  window.LiveChart && LiveChart.init();
  syncRail();

  // ------------------------------------------------------------------ backtest dialog
  $('#bt-prop').addEventListener('change', e =>
    $('#bt-prop-custom').classList.toggle('hidden', e.target.value !== 'custom'));
  $('#bt-run').addEventListener('click', () => BacktestUI.runBacktest());
  function updateLangNote() {
    $('#bt-lang-note').textContent = langSel.value === 'python'
      ? 'Python needs a ~10 MB runtime on first run.' : '';
  }
  langSel.addEventListener('change', updateLangNote);
  updateLangNote();

  // ------------------------------------------------------------------ account settings
  $('#btn-settings').addEventListener('click', () => {
    syncSettingsDialog();
    $('#am-live-note').classList.toggle('hidden', !Replay.isActive());
    openDialog('#dlg-account');
  });
  $('#am-apply').addEventListener('click', () => {
    const wasLive = Replay.isActive();
    App.setManualSettings({
      balance: parseFloat($('#am-balance').value),
      leverage: parseInt($('#am-leverage').value),
      spread: parseFloat($('#am-spread').value),
      commission: parseFloat($('#am-commission').value),
      propMode: $('#am-prop').value,
    }, { silent: true });
    App.closeModals();
    App.toast(wasLive
      ? 'Saved — these apply to the next session, the running one keeps its own account'
      : 'Account settings saved', 'ok');
  });

  // ------------------------------------------------------------------ replay / session
  // The "Backtesting Session" popup (session.js) owns session start.
  // #dlg-goto stays as the in-session "jump to date" tool.
  $('#goto-apply').addEventListener('click', () => {
    App.closeModals();
    Replay.gotoDate($('#goto-date').value);
  });

  // Called by session.js after it has downloaded candles for the chosen market.
  App.applySessionData = (info, tf, candles, range) => {
    App.currentSymbol = info.sym;
    selectTF(tf);
    $('#symbol-btn .sb-sym').textContent = info.sym;
    $('#symbol-btn .sb-src').textContent = info.source === 'binance' ? 'Binance' : 'Dukascopy';
    $('#bt-context').textContent = `Strategy will run on ${info.sym} ${tf.toUpperCase()} (${info.name}).`;
    if (Replay.isActive()) Replay.exit();
    ChartMgr.setData(candles, info, { fit: false, lastBars: 200 });
    ChartMgr.setMarkers([]);
    renderLegend();
    App.chartRange = range;
    Draw.setStoreKey(info.sym + ':' + tf);
    $('#bars-info').innerHTML = candles.length
      ? `<i class="fa-solid fa-database" style="font-size:9px"></i> ${candles.length.toLocaleString()} bars`
      : '';
    highlightWatchlist();
  };

  /** Re-render everything that depends on live session state. */
  App.refreshSessionUI = () => {
    if (!Replay.isActive()) return;
    const b = Replay.broker(), bar = Replay.currentBar();
    if (!b || !bar) return;
    App.updateAccountUI(b, bar);
    App.renderPositions(b, bar);
  };

  $('#rp-goto').addEventListener('click', () => {
    const m = Replay.sessionMeta && Replay.sessionMeta();
    if (m && m.startDate) $('#goto-date').value = m.startDate;
    openDialog('#dlg-goto');
  });
  $('#rp-fwd').addEventListener('click', () => Replay.stepForward());
  $('#rp-back').addEventListener('click', () => Replay.stepBack());
  $('#rp-play').addEventListener('click', () => Replay.play());
  $('#rp-skip').addEventListener('click', () => Replay.skip(10));
  $('#rp-restart').addEventListener('click', () => Replay.restart());
  $('#rp-exit').addEventListener('click', () => {
    if (Replay.broker() && Replay.broker().positions.length) {
      if (!confirm('You still have open positions. End the session anyway?')) return;
    }
    Replay.exit();
  });
  $('#rp-speed').addEventListener('change', () => Replay.setSpeed());

  // ---------------------------------------------------------- order ticket
  const tkSize = $('#tk-size'), tkSL = $('#tk-sl'), tkTP = $('#tk-tp');

  function ticketVals() {
    const num = (v) => { const n = parseFloat(v); return isFinite(n) && n !== 0 ? n : null; };
    return { lots: parseFloat(tkSize.value) || 0, sl: num(tkSL.value), tp: num(tkTP.value) };
  }

  function submitOrder(dir) {
    if (Replay.manualOrder(dir)) {
      // clear the brackets so the next order starts clean, like a real ticket
      tkSL.value = ''; tkTP.value = '';
      TradeOverlay.clearPreview();
      App.updateTicketRisk();
    }
  }

  $('#tk-buy').addEventListener('click', () => submitOrder(1));
  $('#tk-sell').addEventListener('click', () => submitOrder(-1));
  $('#tk-closeall').addEventListener('click', () => Replay.closeAllManual());
  $('#tk-close').addEventListener('click', () => {
    $('#ticket').classList.add('hidden');
    $('#tk-reopen').classList.remove('hidden');
  });
  $('#tk-reopen').addEventListener('click', () => {
    $('#ticket').classList.remove('hidden');
    $('#tk-reopen').classList.add('hidden');
  });

  // "pick on chart" buttons — click the chart to set SL / TP visually
  $('#tk-pick-sl').addEventListener('click', () => {
    if (!Replay.isActive()) { App.toast('Start a session first', 'warn'); return; }
    TradeOverlay.startPick('sl', (price) => {
      tkSL.value = price.toFixed(App.currentSymbolInfo.digits);
      App.updateTicketRisk();
    });
  });
  $('#tk-pick-tp').addEventListener('click', () => {
    if (!Replay.isActive()) { App.toast('Start a session first', 'warn'); return; }
    TradeOverlay.startPick('tp', (price) => {
      tkTP.value = price.toFixed(App.currentSymbolInfo.digits);
      App.updateTicketRisk();
    });
  });

  // risk-percent quick sizing: solve lots from % of balance and stop distance
  $$('.tk-risk-btn').forEach(btn => btn.addEventListener('click', () => {
    const pct = parseFloat(btn.dataset.pct);
    const b = Replay.broker && Replay.broker();
    const bar = Replay.currentBar && Replay.currentBar();
    if (!b || !bar) { App.toast('Start a session first', 'warn'); return; }
    const { sl } = ticketVals();
    if (sl === null) { App.toast('Set a stop loss first — risk sizing needs a stop distance', 'warn'); return; }
    const dist = Math.abs(bar.close - sl);
    if (dist <= 0) { App.toast('Stop loss is at the current price', 'warn'); return; }
    const lots = (b.balance * pct / 100) / (dist * b.symInfo.lotUnits);
    tkSize.value = Math.max(0.01, Math.round(lots * 100) / 100);
    App.updateTicketRisk();
  }));

  [tkSize, tkSL, tkTP].forEach(el => el.addEventListener('input', () => App.updateTicketRisk()));

  App.updateTicketRisk = () => {
    const b = Replay.broker && Replay.broker();
    const bar = Replay.currentBar && Replay.currentBar();
    if (!b || !bar) return;
    const { lots, sl, tp } = ticketVals();
    const units = b.symInfo.lotUnits;
    const bid = bar.close, ask = bid + b.spreadPrice;

    $('#tk-margin').textContent = fmt$(b.marginRequired(bid, lots));

    if (sl !== null && lots > 0) {
      const risk = Math.abs(bid - sl) * lots * units;
      $('#tk-risk-cash').textContent = fmt$(risk);
      const pct = b.balance > 0 ? risk / b.balance * 100 : 0;
      const el = $('#tk-risk-pct');
      el.textContent = pct.toFixed(2) + '%';
      el.style.color = pct > 2 ? 'var(--down)' : pct > 1 ? 'var(--warn)' : 'var(--up)';
    } else {
      $('#tk-risk-cash').textContent = 'no stop set';
      $('#tk-risk-pct').textContent = '—';
      $('#tk-risk-pct').style.color = '';
    }

    if (tp !== null && lots > 0) {
      const reward = Math.abs(tp - bid) * lots * units;
      $('#tk-reward-cash').textContent = fmt$(reward);
      if (sl !== null) {
        const risk = Math.abs(bid - sl) * lots * units;
        $('#tk-rr').textContent = risk > 0 ? (reward / risk).toFixed(2) + ' : 1' : '—';
      } else $('#tk-rr').textContent = '—';
    } else {
      $('#tk-reward-cash').textContent = 'no target set';
      $('#tk-rr').textContent = '—';
    }

    // live preview on the chart, so you see the zones before you commit
    if (Replay.isActive() && lots > 0 && (sl !== null || tp !== null)) {
      // guess direction from where the stop sits relative to price
      const dir = sl !== null ? (sl < bid ? 1 : -1) : (tp > bid ? 1 : -1);
      TradeOverlay.setPreview({ dir, lots, entry: dir > 0 ? ask : bid, sl, tp });
    } else {
      TradeOverlay.clearPreview();
    }
  };

  // ------------------------------------------------------------------ keyboard
  // In a session the letters do trading things (B buy / S sell), outside it they
  // open panels. Shortcuts never fire while a dialog is open or you are typing.
  window.addEventListener('keydown', e => {
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (App.anyDialogOpen()) return;

    const live = Replay.isActive();

    // session controls first
    if (live) {
      if (e.key === 'ArrowRight') { e.preventDefault(); Replay.stepForward(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); Replay.stepBack(); return; }
      if (e.key === ' ') { e.preventDefault(); Replay.play(); return; }
    }

    const k = e.key.toLowerCase();
    if (live && k === 'b') { e.preventDefault(); submitOrder(1); return; }
    if (live && k === 's') { e.preventDefault(); submitOrder(-1); return; }
    if (live && k === 'c') { e.preventDefault(); Replay.closeAllManual(); return; }

    if (k === 's') { e.preventDefault(); openSymbolPicker(); }
    else if (k === 'i') { e.preventDefault(); openDialog('#dlg-indicators'); renderIndicators(); }
    else if (k === 'b') { e.preventDefault(); openDialog('#dlg-backtest'); }
    else if (k === 'r') { e.preventDefault(); $('#btn-session').click(); }
  });

  // ------------------------------------------------------------------ account UI
  App.updateAccountUI = (broker, bar) => {
    const bid = bar.close;
    const eq = broker.equity(bid);
    const pnl = broker.floatPnl(bid);
    const um = broker.usedMargin(bid);

    $('#chip-balance').textContent = fmt$(broker.balance);
    $('#chip-equity').textContent = fmt$(eq);
    const cp = $('#chip-pnl');
    cp.textContent = fmt$(pnl);
    cp.className = 'ac-v ' + cls(pnl);

    $('#ar-balance').textContent = fmt$(broker.balance);
    $('#ar-equity').textContent = fmt$(eq);
    $('#ar-pnl').textContent = fmt$(pnl);
    $('#ar-pnl').className = cls(pnl);
    $('#ar-margin').textContent = fmt$(um);
    $('#ar-free').textContent = fmt$(eq - um);
    $('#ar-lev').textContent = '1:' + broker.leverage;
    $('#ar-marginbar').style.width = (eq > 0 ? Math.min(100, um / eq * 100) : 0) + '%';

    $('#cnt-open').textContent = broker.positions.length;

    // prop rail
    const sec = $('#rail-prop-sec');
    if (broker.propState) {
      sec.classList.remove('hidden');
      const ps = broker.propState, pr = broker.prop;
      const st = $('#pr-status');
      if (ps.status === 'active') { st.className = 'pr-status active'; st.innerHTML = '<i class="fa-solid fa-circle-play"></i> Challenge active'; }
      else if (ps.status === 'passed') { st.className = 'pr-status passed'; st.innerHTML = '<i class="fa-solid fa-circle-check"></i> Target reached — passed'; }
      else { st.className = 'pr-status failed'; st.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Failed — ${ps.status === 'failed_daily' ? 'daily loss' : 'max drawdown'}`; }

      const dailyLimit = ps.dayStartEquity * pr.dailyPct / 100;
      const dailyUsed = Math.max(0, ps.dayStartEquity - eq);
      const ddBase = pr.ddType === 'trailing' ? ps.peakEquity : broker.initial;
      const ddLimit = ddBase * pr.maxPct / 100;
      const ddUsed = Math.max(0, ddBase - eq);
      const target = pr.targetPct > 0 ? broker.initial * pr.targetPct / 100 : 0;
      const gained = Math.max(0, eq - broker.initial);

      const bars = [
        ['Daily loss used', dailyUsed, dailyLimit, true],
        ['Total drawdown used', ddUsed, ddLimit, true],
      ];
      if (target > 0) bars.push(['Progress to target', gained, target, false]);

      $('#pr-bars').innerHTML = bars.map(([label, used, limit, isRisk]) => {
        const pct = limit > 0 ? Math.min(100, used / limit * 100) : 0;
        const k = isRisk ? (pct > 80 ? 'bad' : pct > 50 ? 'warn' : 'ok') : 'ok';
        return `<div class="rule-bar">
          <div class="rb-top"><span>${label}</span><b>${fmt$(used)} / ${fmt$(limit)}</b></div>
          <div class="rb-track"><div class="rb-fill ${k}" style="width:${pct}%"></div></div>
        </div>`;
      }).join('');
    } else {
      sec.classList.add('hidden');
    }
  };

  /**
   * Reset the account panels to a flat account.
   * @param {object} [override] use these numbers instead of App.manualSettings
   *   (Replay.exit passes its own frozen config so the panel matches the
   *   session that just ended rather than jumping to unrelated values).
   */
  App.resetAccountUI = (override) => {
    const s = override || App.manualSettings;
    $('#chip-balance').textContent = fmt$(s.balance);
    $('#chip-equity').textContent = fmt$(s.balance);
    $('#chip-pnl').textContent = '$0.00';
    $('#chip-pnl').className = 'ac-v';
    $('#ar-balance').textContent = fmt$(s.balance);
    $('#ar-equity').textContent = fmt$(s.balance);
    $('#ar-pnl').textContent = '$0.00';
    $('#ar-pnl').className = '';
    $('#ar-margin').textContent = '$0.00';
    $('#ar-free').textContent = fmt$(s.balance);
    $('#ar-lev').textContent = '1:' + s.leverage;
    $('#ar-marginbar').style.width = '0%';
    $('#cnt-open').textContent = '0';
    $('#rail-prop-sec').classList.add('hidden');
    $('#open-pos-host').innerHTML = emptyBlock('fa-layer-group', 'No open positions',
      'Start a Backtesting Session and use the order ticket, or run a backtest to see filled trades here.');
    $('#closed-trades-host').innerHTML = emptyBlock('fa-clock-rotate-left', 'No closed trades yet', '');
  };

  function emptyBlock(icon, title, text) {
    return `<div class="empty" style="padding:26px 10px;height:auto">
      <div class="empty-icon"><i class="fa-solid ${icon}"></i></div>
      <h4>${title}</h4>${text ? `<p>${text}</p>` : ''}</div>`;
  }

  App.renderPositions = (broker, bar) => {
    const info = App.currentSymbolInfo;
    const dg = info.digits;
    const pip = info.pip || 0.0001;
    const units = info.lotUnits || 100000;
    const bid = bar.close;
    const live = Replay.isActive();

    $('#open-pos-host').innerHTML = broker.positions.length ? `
      <div class="table-wrap"><table class="dt compact pos-table">
        <thead><tr>
          <th>#</th><th>Side</th><th>Lots</th><th>Entry</th><th>Stop</th><th>Target</th>
          <th>Pips</th><th>Risk</th><th>Open P/L</th>${live ? '<th></th>' : ''}
        </tr></thead>
        <tbody>${broker.positions.map(p => {
          const pnl = broker.posPnl(p, bid);
          const pips = (p.dir > 0 ? (bid - p.entry) : (p.entry - (bid + broker.spreadPrice))) / pip;
          const risk = p.sl != null ? Math.abs(p.entry - p.sl) * p.lots * units : null;
          return `<tr>
            <td>${p.id}</td>
            <td><span class="badge-side ${p.dir > 0 ? 'long' : 'short'}">${p.dir > 0 ? 'LONG' : 'SHORT'}</span></td>
            <td>${p.lots}</td><td>${p.entry.toFixed(dg)}</td>
            <td>${p.sl != null ? p.sl.toFixed(dg) : '—'}</td>
            <td>${p.tp != null ? p.tp.toFixed(dg) : '—'}</td>
            <td class="${cls(pips)}">${pips >= 0 ? '+' : ''}${pips.toFixed(1)}</td>
            <td>${risk != null ? fmt$(risk) : '—'}</td>
            <td class="${cls(pnl)}">${fmt$(pnl)}</td>
            ${live ? `<td class="pos-actions">
              <button class="mini-btn" data-be="${p.id}" data-tip="Move stop to break-even">BE</button>
              <button class="mini-btn danger" data-close="${p.id}" data-tip="Close this position">Close</button>
            </td>` : ''}
          </tr>`;
        }).join('')}</tbody></table></div>`
      : emptyBlock('fa-layer-group', 'No open positions', '');

    if (live) {
      $$('#open-pos-host [data-close]').forEach(b =>
        b.addEventListener('click', () => Replay.closeOne(parseInt(b.dataset.close))));
      $$('#open-pos-host [data-be]').forEach(b =>
        b.addEventListener('click', () => Replay.breakEven(parseInt(b.dataset.be))));
    }

    $('#closed-trades-host').innerHTML = broker.closed.length ? `
      <div class="table-wrap"><table class="dt compact">
        <thead><tr><th>#</th><th>Side</th><th>Lots</th><th>Entry</th><th>Exit</th><th>Closed by</th><th>Net P/L</th></tr></thead>
        <tbody>${[...broker.closed].reverse().map(t => `<tr>
          <td>${t.id}</td>
          <td><span class="badge-side ${t.dir > 0 ? 'long' : 'short'}">${t.dir > 0 ? 'LONG' : 'SHORT'}</span></td>
          <td>${t.lots}</td><td>${t.entry.toFixed(dg)}</td><td>${t.exit.toFixed(dg)}</td>
          <td>${REASON[t.reason] || t.reason}</td>
          <td class="${cls(t.pnl)}">${fmt$(t.pnl)}</td></tr>`).join('')}</tbody></table></div>`
      : emptyBlock('fa-clock-rotate-left', 'No closed trades yet', '');

    // session stats strip
    const strip = $('#session-stats');
    if (strip) {
      if (live && broker.closed.length) {
        const wins = broker.closed.filter(t => t.pnl > 0).length;
        const net = broker.closed.reduce((s, t) => s + t.pnl, 0);
        const wr = (wins / broker.closed.length * 100);
        strip.classList.remove('hidden');
        strip.innerHTML = `
          <span><i>Trades</i><b>${broker.closed.length}</b></span>
          <span><i>Win rate</i><b>${wr.toFixed(0)}%</b></span>
          <span><i>Net</i><b class="${cls(net)}">${fmt$(net)}</b></span>
          <span><i>Open</i><b>${broker.positions.length}</b></span>`;
      } else strip.classList.add('hidden');
    }
  };

  const REASON = {
    sl: 'Stop loss', tp: 'Take profit', strategy: 'Strategy',
    margin_call: 'Margin call', reverse: 'Reversed', manual: 'Manual',
    prop_fail: 'Rule breach', end: 'End of test',
  };
  App.REASON = REASON;


  // ------------------------------------------------------------------ news panel
  // Real economic-calendar releases. Two scopes: the events inside the last
  // backtest window, or what is coming up from today.
  let newsEvents = [];      // events for the current backtest range
  let newsUpcoming = [];    // events ahead of now
  let newsTf = '1h';
  let newsScope = 'range';
  let newsImp = 'high';

  const IMP_META = {
    high:    { label: 'High',    cls: 'imp-high',    ico: 'fa-fire' },
    medium:  { label: 'Medium',  cls: 'imp-medium',  ico: 'fa-bolt' },
    low:     { label: 'Low',     cls: 'imp-low',     ico: 'fa-circle' },
    holiday: { label: 'Holiday', cls: 'imp-holiday', ico: 'fa-umbrella-beach' },
  };

  function impactsWanted() {
    if (newsImp === 'high') return ['high'];
    if (newsImp === 'medium') return ['high', 'medium'];
    return ['high', 'medium', 'low', 'holiday'];
  }

  function newsCurrencies() {
    if (!$('#news-only-sym') || !$('#news-only-sym').checked) return null;
    return NewsStore.currenciesFor(App.currentSymbolInfo);
  }

  App.setNewsEvents = (events, tf) => {
    newsEvents = events || [];
    newsTf = tf || App.currentTF;
    newsScope = 'range';
    syncSeg('#news-scope', 'scope', 'range');
    renderNews();
    pushNewsToChart();
  };

  function syncSeg(sel, attr, val) {
    const host = $(sel); if (!host) return;
    host.querySelectorAll('button').forEach(b =>
      b.classList.toggle('active', b.dataset[attr] === val));
  }

  function pushNewsToChart() {
    if (!ChartMgr.setNewsMarkers) return;
    const on = !$('#news-show-chart') || $('#news-show-chart').checked;
    if (!on) { ChartMgr.clearNewsMarkers(); return; }
    const src = newsScope === 'range' ? newsEvents : newsUpcoming;
    const shown = NewsStore.filter(src, { impacts: impactsWanted(), currencies: newsCurrencies() });
    const tfSec = DataStore.TF_SEC[newsTf] || 3600;
    ChartMgr.setNewsMarkers(NewsStore.toMarkers(shown, ChartMgr.candles, tfSec));
  }

  function newsRow(e, isPast) {
    const m = IMP_META[e.impact] || IMP_META.low;
    const d = new Date(e.t * 1000);
    const when = d.toISOString().replace('T', ' ').slice(0, 16);
    const vals = [];
    if (e.actual) vals.push(`<span class="nv"><i>Actual</i><b class="${e.tone === 'better' ? 't-up' : e.tone === 'worse' ? 't-down' : ''}">${e.actual}</b></span>`);
    if (e.forecast) vals.push(`<span class="nv"><i>Forecast</i><b>${e.forecast}</b></span>`);
    if (e.previous) vals.push(`<span class="nv"><i>Previous</i><b>${e.previous}</b></span>`);
    let rel = '';
    if (!isPast) {
      const mins = (e.t - Date.now() / 1000) / 60;
      rel = mins < 60 ? `in ${Math.max(0, Math.round(mins))}m`
          : mins < 1440 ? `in ${(mins / 60).toFixed(0)}h`
          : `in ${(mins / 1440).toFixed(0)}d`;
    }
    return `<div class="news-row ${m.cls}">
      <div class="nr-imp" title="${m.label} impact"><i class="fa-solid ${m.ico}"></i></div>
      <div class="nr-when"><b>${when}</b><span>UTC${rel ? ' · ' + rel : ''}</span></div>
      <div class="nr-cur">${e.cur}</div>
      <div class="nr-title">${e.title}</div>
      <div class="nr-vals">${vals.join('') || '<span class="nv-none">no figures</span>'}</div>
    </div>`;
  }

  async function renderNews() {
    const host = $('#news-host');
    if (!host) return;
    const cnt = $('#cnt-news');

    if (newsScope === 'upcoming') {
      host.innerHTML = '<div class="news-loading"><i class="fa-solid fa-spinner spin"></i> Loading upcoming releases…</div>';
      try {
        if (!newsUpcoming.length) newsUpcoming = await NewsStore.upcoming(21);
      } catch (_) {
        host.innerHTML = `<div class="empty"><div class="empty-icon"><i class="fa-solid fa-plug-circle-xmark"></i></div>
          <h3>Calendar unavailable</h3><p>The economic calendar could not be reached. Try again shortly.</p></div>`;
        return;
      }
      const shown = NewsStore.filter(newsUpcoming, { impacts: impactsWanted(), currencies: newsCurrencies() });
      if (cnt) cnt.textContent = shown.length;
      host.innerHTML = shown.length
        ? `<div class="news-head"><b>${shown.length}</b> upcoming release${shown.length === 1 ? '' : 's'} · next 3 weeks</div>` +
          shown.map(e => newsRow(e, false)).join('')
        : `<div class="empty"><div class="empty-icon"><i class="fa-solid fa-calendar-check"></i></div>
           <h3>Nothing scheduled</h3><p>No releases match this filter in the next three weeks.
           Widen the impact filter or untick the currency filter.</p></div>`;
      pushNewsToChart();
      return;
    }

    // range scope
    if (!newsEvents.length) {
      if (cnt) cnt.textContent = '0';
      host.innerHTML = `<div class="empty"><div class="empty-icon"><i class="fa-solid fa-bullhorn"></i></div>
        <h3>No calendar loaded yet</h3>
        <p>Run a backtest with <b>Load the real economic calendar</b> enabled, and every release
        inside the tested window shows up here and on the chart — with the figure that was actually
        published at the time.</p>
        <button class="btn btn-primary btn-sm" id="news-run"><i class="fa-solid fa-play"></i> Open Backtest Settings</button></div>`;
      const b = $('#news-run');
      if (b) b.addEventListener('click', () => $('#btn-tester').click());
      pushNewsToChart();
      return;
    }
    const shown = NewsStore.filter(newsEvents, { impacts: impactsWanted(), currencies: newsCurrencies() });
    if (cnt) cnt.textContent = shown.length;
    const nowSec = Date.now() / 1000;
    host.innerHTML =
      `<div class="news-head"><b>${shown.length}</b> release${shown.length === 1 ? '' : 's'} inside the backtest window
       <span style="color:var(--t-3)">· figures shown are the ones published at the time</span></div>` +
      (shown.length ? shown.map(e => newsRow(e, e.t < nowSec)).join('')
        : `<div class="empty"><div class="empty-icon"><i class="fa-solid fa-filter"></i></div>
           <h3>Nothing matches the filter</h3><p>Loosen the impact filter or untick the currency filter.</p></div>`);
    pushNewsToChart();
  }

  // news panel controls
  const nScope = $('#news-scope');
  if (nScope) nScope.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    newsScope = b.dataset.scope;
    syncSeg('#news-scope', 'scope', newsScope);
    renderNews();
  });
  const nImp = $('#news-imp');
  if (nImp) nImp.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    newsImp = b.dataset.imp;
    syncSeg('#news-imp', 'imp', newsImp);
    renderNews();
  });
  ['#news-only-sym', '#news-show-chart'].forEach(sel => {
    const el = $(sel);
    if (el) el.addEventListener('change', renderNews);
  });
  App.renderNews = renderNews;

  // ------------------------------------------------------------------ onboarding hints
  const HINTS = [
    'Press <b>S</b> to search instruments, <b>I</b> for indicators, <b>B</b> for backtest settings, <b>R</b> for a session.',
    'Scroll to zoom, drag to pan. Double-click the price scale to reset the view.',
    'In a session, drag the <b>SL</b> or <b>TP</b> line straight on the chart to move it — the order updates live.',
    'In a session: <b>Space</b> plays, <b>→</b> steps one bar, <b>B</b> buys, <b>S</b> sells, <b>C</b> closes everything.',
    'Run the same backtest twice, once with zero spread. The difference is what costs do to your edge.',
  ];
  let hintIdx = 0;
  function showHint() {
    if (localStorage.getItem('bt_hints_off') === '1') return;
    if (Replay.isActive()) return;   // never overlap the session controls
    $('#hint-text').innerHTML = HINTS[hintIdx % HINTS.length];
    $('#chart-hint').classList.remove('hidden');
  }
  $('#hint-next').addEventListener('click', () => { hintIdx++; showHint(); });
  $('#hint-close').addEventListener('click', () => {
    $('#chart-hint').classList.add('hidden');
    try { localStorage.setItem('bt_hints_off', '1'); } catch (_) {}
  });

  // ------------------------------------------------------------------ boot
  renderWatchlist();
  syncSettingsDialog();
  App.resetAccountUI();

  // apply URL / wizard config
  const params = new URLSearchParams(location.search);
  let pending = null;
  if (params.get('run') === '1') {
    try { pending = JSON.parse(localStorage.getItem('bt_pending') || 'null'); } catch (_) {}
    localStorage.removeItem('bt_pending');
  }
  const urlSym = params.get('symbol');
  if (pending) {
    if (findSymbol(pending.symbol)) App.currentSymbol = pending.symbol;
    selectTF(pending.tf || '1h');
    App.loadStrategyById(pending.strategy);
    $('#bt-start').value = pending.start;
    $('#bt-end').value = pending.end;
    $('#bt-balance').value = pending.balance;
    $('#bt-leverage').value = String(pending.leverage);
    $('#bt-spread').value = pending.spread;
    $('#bt-commission').value = pending.commission;
    $('#bt-prop').value = pending.prop;
  } else if (urlSym) {
    if (findSymbol(urlSym)) App.currentSymbol = urlSym;
  }

  loadChart().then(() => {
    setTimeout(showHint, 900);
    if (pending) {
      openTab('tester');
      App.toast('Configuration loaded — starting backtest', 'ok');
      setTimeout(() => BacktestUI.runBacktest(), 500);
    }
  });
})();
