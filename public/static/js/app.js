// ===========================================================================
// Terminal bootstrap — wires the chart workspace: symbol/timeframe switching,
// dialogs, watchlist, legend, account rail, editor, replay, onboarding hints.
// ===========================================================================
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const App = {
    currentSymbol: 'EURUSD',
    currentTF: '1h',
    get currentSymbolInfo() { return getSymbol(this.currentSymbol); },
    manualSettings: { balance: 100000, leverage: 100, spread: 0.5, commission: 3.5, propMode: 'none' },
    chartRange: { from: null, to: null },
  };
  window.App = App;

  const fmt$ = (v) => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined,
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
  $('#backdrop').addEventListener('click', App.closeModals);
  $$('.dialog-close').forEach(b => b.addEventListener('click', App.closeModals));
  window.addEventListener('keydown', e => { if (e.key === 'Escape') App.closeModals(); });

  // ------------------------------------------------------------------ chart
  ChartMgr.init($('#chart-container'));
  Draw.init($('#draw-canvas'), $('#chart-wrap'));

  ChartMgr.chart.subscribeCrosshairMove(param => {
    const info = App.currentSymbolInfo;
    const legend = $('#chart-legend');
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
  });

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

  async function loadChart() {
    const info = App.currentSymbolInfo;
    setLoading(true, 'Downloading real market data…', 0);
    $('#symbol-btn .sb-sym').textContent = App.currentSymbol;
    $('#symbol-btn .sb-src').textContent = info.source === 'binance' ? 'Binance' : 'Dukascopy';
    $('#bt-context').textContent = `Strategy will run on ${App.currentSymbol} ${App.currentTF.toUpperCase()} (${info.name}).`;
    if (Replay.isActive()) Replay.exit();

    const now = Math.floor(Date.now() / 1000);
    const from = now - (SPANS[App.currentTF] || 90 * 86400);

    try {
      const candles = await DataStore.load(App.currentSymbol, App.currentTF, from, now,
        (p) => setLoading(true, 'Downloading real market data…', p));
      if (!candles.length) {
        App.toast('No data available for ' + App.currentSymbol + ' on this timeframe', 'warn');
      }
      ChartMgr.setData(candles, info);
      ChartMgr.setMarkers([]);
      App.chartRange = { from, to: now };
      Draw.setStoreKey(App.currentSymbol + ':' + App.currentTF);
      $('#bars-info').innerHTML = candles.length
        ? `<i class="fa-solid fa-database" style="font-size:9px"></i> ${candles.length.toLocaleString()} bars`
        : '';
    } catch (e) {
      console.error(e);
      App.toast('Could not load data: ' + e.message, 'err');
    } finally {
      setLoading(false);
    }
  }
  App.loadChart = loadChart;

  // ------------------------------------------------------------------ timeframe
  $$('.tf-btn').forEach(b => b.addEventListener('click', () => {
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
  }

  // ------------------------------------------------------------------ symbol picker
  const CAT_LABEL = { forex: 'FX', indices: 'IDX', stocks: 'EQ', commodities: 'CMD', crypto: 'CRY' };
  let symFilter = '', symCat = 'all', symIdx = -1;

  function renderSymbolList() {
    const f = symFilter.trim().toUpperCase();
    const items = SYMBOLS.filter(s =>
      (symCat === 'all' || s.cat === symCat) &&
      (!f || s.sym.includes(f) || s.name.toUpperCase().includes(f)));
    $('#symbol-list').innerHTML = items.length ? items.map((s, i) => `
      <div class="sym-row ${i === symIdx ? 'kb' : ''}" data-sym="${s.sym}">
        <span class="sr-ico">${CAT_LABEL[s.cat] || '?'}</span>
        <span class="sr-l">
          <div class="sr-sym">${s.sym}</div>
          <div class="sr-name">${s.name}</div>
        </span>
        <span class="sr-r">
          <span class="pill">${s.source === 'binance' ? 'Binance' : 'Dukascopy'}</span>
        </span>
      </div>`).join('')
      : `<div class="empty" style="padding:30px"><div class="empty-icon"><i class="fa-solid fa-magnifying-glass"></i></div>
         <h4>Nothing matches “${symFilter}”</h4><p>Try a shorter search — for example “eur”, “gold”, “nas” or “btc”.</p></div>`;

    $$('#symbol-list .sym-row').forEach(r => r.addEventListener('click', () => pickSymbol(r.dataset.sym)));
  }
  function pickSymbol(sym) {
    App.currentSymbol = sym;
    App.closeModals();
    loadChart();
    highlightWatchlist();
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
  $('#btn-settings').addEventListener('click', () => openDialog('#dlg-account'));
  $('#am-apply').addEventListener('click', () => {
    App.manualSettings = {
      balance: parseFloat($('#am-balance').value) || 100000,
      leverage: parseInt($('#am-leverage').value) || 100,
      spread: parseFloat($('#am-spread').value) || 0,
      commission: parseFloat($('#am-commission').value) || 0,
      propMode: $('#am-prop').value,
    };
    App.resetAccountUI();
    App.closeModals();
    if (Replay.isActive()) Replay.exit();
    App.toast('Account settings applied', 'ok');
  });

  // ------------------------------------------------------------------ replay
  $('#btn-replay').addEventListener('click', () => {
    if (Replay.isActive()) { Replay.exit(); return; }
    openDialog('#dlg-goto');
    const c = ChartMgr.candles;
    if (c.length) {
      const t = c[Math.floor(c.length * 0.35)].time;
      $('#goto-date').value = new Date(t * 1000).toISOString().slice(0, 10);
    }
  });
  $('#goto-apply').addEventListener('click', () => {
    App.closeModals();
    Replay.gotoDate($('#goto-date').value);
  });
  $('#rp-goto').addEventListener('click', () => openDialog('#dlg-goto'));
  $('#rp-fwd').addEventListener('click', () => Replay.stepForward());
  $('#rp-back').addEventListener('click', () => Replay.stepBack());
  $('#rp-play').addEventListener('click', () => Replay.play());
  $('#rp-exit').addEventListener('click', () => Replay.exit());
  $('#rp-speed').addEventListener('change', () => {
    if (Replay.isActive() && Replay.isPlaying()) { Replay.pause(); Replay.play(); }
  });

  // order ticket
  $('#tk-buy').addEventListener('click', () => Replay.manualOrder(1));
  $('#tk-sell').addEventListener('click', () => Replay.manualOrder(-1));
  $('#tk-closeall').addEventListener('click', () => Replay.closeAllManual());
  $('#tk-close').addEventListener('click', () => $('#ticket').classList.add('hidden'));
  ['#tk-size', '#tk-sl'].forEach(s => $(s).addEventListener('input', () => App.updateTicketRisk()));

  App.updateTicketRisk = () => {
    const b = Replay.broker && Replay.broker();
    const bar = Replay.currentBar && Replay.currentBar();
    if (!b || !bar) return;
    const lots = parseFloat($('#tk-size').value) || 0;
    const sl = parseFloat($('#tk-sl').value);
    const units = b.symInfo.lotUnits;
    const margin = b.marginRequired(bar.close, lots);
    $('#tk-margin').textContent = fmt$(margin);
    if (isFinite(sl) && sl > 0) {
      const risk = Math.abs(bar.close - sl) * lots * units;
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
  };

  // ------------------------------------------------------------------ keyboard
  window.addEventListener('keydown', e => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (typing) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); openSymbolPicker(); }
    else if (k === 'i') { e.preventDefault(); openDialog('#dlg-indicators'); renderIndicators(); }
    else if (k === 'b') { e.preventDefault(); openDialog('#dlg-backtest'); }
    else if (k === 'r') { e.preventDefault(); $('#btn-replay').click(); }
    else if (Replay.isActive()) {
      if (e.key === 'ArrowRight') { e.preventDefault(); Replay.stepForward(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); Replay.stepBack(); }
      if (e.key === ' ') { e.preventDefault(); Replay.play(); }
    }
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

  App.resetAccountUI = () => {
    const s = App.manualSettings;
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
      'Start Bar Replay and use the order ticket, or run a backtest to see filled trades here.');
    $('#closed-trades-host').innerHTML = emptyBlock('fa-clock-rotate-left', 'No closed trades yet', '');
  };

  function emptyBlock(icon, title, text) {
    return `<div class="empty" style="padding:26px 10px;height:auto">
      <div class="empty-icon"><i class="fa-solid ${icon}"></i></div>
      <h4>${title}</h4>${text ? `<p>${text}</p>` : ''}</div>`;
  }

  App.renderPositions = (broker, bar) => {
    const dg = App.currentSymbolInfo.digits;
    const bid = bar.close;

    $('#open-pos-host').innerHTML = broker.positions.length ? `
      <div class="table-wrap"><table class="dt compact">
        <thead><tr><th>#</th><th>Side</th><th>Lots</th><th>Entry</th><th>Stop</th><th>Target</th><th>Open P/L</th></tr></thead>
        <tbody>${broker.positions.map(p => {
          const pnl = broker.posPnl(p, bid);
          return `<tr>
            <td>${p.id}</td>
            <td><span class="badge-side ${p.dir > 0 ? 'long' : 'short'}">${p.dir > 0 ? 'LONG' : 'SHORT'}</span></td>
            <td>${p.lots}</td><td>${p.entry.toFixed(dg)}</td>
            <td>${p.sl ? p.sl.toFixed(dg) : '—'}</td><td>${p.tp ? p.tp.toFixed(dg) : '—'}</td>
            <td class="${cls(pnl)}">${fmt$(pnl)}</td></tr>`;
        }).join('')}</tbody></table></div>`
      : emptyBlock('fa-layer-group', 'No open positions', '');

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
    'Press <b>S</b> to search instruments, <b>I</b> for indicators, <b>B</b> for backtest settings.',
    'Scroll to zoom, drag to pan. Double-click the price scale to reset the view.',
    '<b>Bar Replay</b> hides the future so you can trade forward by hand — the honest way to test discretion.',
    'Run the same backtest twice, once with zero spread. The difference is what costs do to your edge.',
    'Every strategy in the library states its exact rules — open the <b>Strategy Editor</b> tab to read them.',
  ];
  let hintIdx = 0;
  function showHint() {
    if (localStorage.getItem('bt_hints_off') === '1') return;
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
    if (getSymbol(pending.symbol)) App.currentSymbol = pending.symbol;
    selectTF(pending.tf || '1h');
    App.loadStrategyById(pending.strategy);
    $('#bt-start').value = pending.start;
    $('#bt-end').value = pending.end;
    $('#bt-balance').value = pending.balance;
    $('#bt-leverage').value = String(pending.leverage);
    $('#bt-spread').value = pending.spread;
    $('#bt-commission').value = pending.commission;
    $('#bt-prop').value = pending.prop;
  } else if (urlSym && getSymbol(urlSym)) {
    App.currentSymbol = urlSym;
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
