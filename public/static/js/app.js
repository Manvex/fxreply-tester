// ===========================================================================
// App bootstrap — wires UI, symbol/timeframe switching, modals, watchlist,
// legend, account panel, manual settings.
// ===========================================================================
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const App = {
    currentSymbol: 'EURUSD',
    currentTF: '1h',
    get currentSymbolInfo() { return getSymbol(this.currentSymbol); },
    manualSettings: { balance: 100000, leverage: 100, spread: 0.5, commission: 3.5, propMode: 'none' },
    chartRange: { from: null, to: null },
  };
  window.App = App;

  // ---------------- toast ----------------
  App.toast = (msg) => {
    let t = $('#toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:10px 18px;border-radius:6px;z-index:99;font-size:13px;border:1px solid #444;box-shadow:0 4px 20px rgba(0,0,0,.7);transition:opacity .3s';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._h);
    t._h = setTimeout(() => t.style.opacity = '0', 3500);
  };

  App.closeModals = () => {
    $$('.modal').forEach(m => m.classList.add('hidden'));
    $('#modal-backdrop').classList.add('hidden');
  };
  function openModal(id) {
    App.closeModals();
    $(id).classList.remove('hidden');
    $('#modal-backdrop').classList.remove('hidden');
  }
  $('#modal-backdrop').addEventListener('click', App.closeModals);
  $$('.modal-close').forEach(x => x.addEventListener('click', App.closeModals));

  // ---------------- chart init ----------------
  ChartMgr.init($('#chart-container'));
  Draw.init($('#draw-canvas'), $('#chart-wrap'));

  // legend updates on crosshair
  ChartMgr.chart.subscribeCrosshairMove(param => {
    const info = App.currentSymbolInfo;
    const legend = $('#chart-legend');
    let bar = null;
    if (param && param.time && param.seriesData) {
      bar = param.seriesData.get(ChartMgr.series);
    }
    if (!bar) {
      const c = ChartMgr.candles;
      bar = c[c.length - 1];
    }
    if (!bar) { legend.innerHTML = ''; return; }
    const dg = info.digits;
    const up = bar.close >= bar.open;
    const chg = bar.close - bar.open;
    legend.innerHTML = `
      <div class="lg-sym">${App.currentSymbol} · ${App.currentTF.toUpperCase()} · ${info.source === 'binance' ? 'Binance' : 'Dukascopy'}</div>
      <div class="lg-ohlc">
        <span>O <b class="${up ? 'up' : 'down'}">${(+bar.open).toFixed(dg)}</b></span>
        <span>H <b class="${up ? 'up' : 'down'}">${(+bar.high).toFixed(dg)}</b></span>
        <span>L <b class="${up ? 'up' : 'down'}">${(+bar.low).toFixed(dg)}</b></span>
        <span>C <b class="${up ? 'up' : 'down'}">${(+bar.close).toFixed(dg)}</b> <b class="${up ? 'up' : 'down'}">${chg >= 0 ? '+' : ''}${chg.toFixed(dg)}</b></span>
      </div>`;
  });

  // ---------------- data loading ----------------
  async function loadChart() {
    const info = App.currentSymbolInfo;
    $('#chart-loading').classList.remove('hidden');
    $('#symbol-label').textContent = App.currentSymbol;
    $('#bt-symbol-label').textContent = App.currentSymbol;
    $('#bt-tf-label').textContent = App.currentTF.toUpperCase();
    if (Replay.isActive()) Replay.exit();

    // default visible range per TF (enough bars, bounded requests)
    const now = Math.floor(Date.now() / 1000);
    const spans = { '1m': 5 * 86400, '5m': 20 * 86400, '15m': 45 * 86400, '30m': 80 * 86400, '1h': 320 * 86400, '4h': 900 * 86400, '1d': 8 * 365 * 86400, '1w': 15 * 365 * 86400 };
    const from = now - (spans[App.currentTF] || 90 * 86400);

    try {
      const candles = await DataStore.load(App.currentSymbol, App.currentTF, from, now, null);
      console.log('[data] ' + App.currentSymbol + ' ' + App.currentTF + ': ' + candles.length + ' bars');
      if (!candles.length) { App.toast('No data returned for ' + App.currentSymbol); }
      ChartMgr.setData(candles, info);
      ChartMgr.setMarkers([]);
      App.chartRange = { from, to: now };
      Draw.setStoreKey(App.currentSymbol + ':' + App.currentTF);
      $('#range-info').textContent = candles.length ? candles.length.toLocaleString() + ' bars' : '';
    } catch (e) {
      console.error(e);
      App.toast('Data load failed: ' + e.message);
    } finally {
      $('#chart-loading').classList.add('hidden');
    }
  }

  // ---------------- timeframe buttons ----------------
  $$('.tf-btn').forEach(b => b.addEventListener('click', () => {
    $$('.tf-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    App.currentTF = b.dataset.tf;
    loadChart();
  }));

  // ---------------- symbol modal ----------------
  function renderSymbolList(filter = '', cat = 'all') {
    const list = $('#symbol-list');
    const f = filter.toUpperCase();
    const items = SYMBOLS.filter(s =>
      (cat === 'all' || s.cat === cat) &&
      (!f || s.sym.includes(f) || s.name.toUpperCase().includes(f)));
    list.innerHTML = items.map(s => `
      <div class="sym-row" data-sym="${s.sym}">
        <span class="s-sym">${s.sym}</span>
        <span class="s-name">${s.name}</span>
        <span class="s-cat">${s.cat}</span>
      </div>`).join('');
    $$('#symbol-list .sym-row').forEach(r => r.addEventListener('click', () => {
      App.currentSymbol = r.dataset.sym;
      App.closeModals();
      loadChart();
      highlightWatchlist();
    }));
  }
  $('#symbol-btn').addEventListener('click', () => { openModal('#symbol-modal'); $('#symbol-search-input').focus(); renderSymbolList($('#symbol-search-input').value, activeCat()); });
  $('#wl-search-ico').addEventListener('click', () => { openModal('#symbol-modal'); $('#symbol-search-input').focus(); });
  $('#symbol-search-input').addEventListener('input', (e) => renderSymbolList(e.target.value, activeCat()));
  function activeCat() { return $('.sc-btn.active')?.dataset.cat || 'all'; }
  $$('.sc-btn').forEach(b => b.addEventListener('click', () => {
    $$('.sc-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    renderSymbolList($('#symbol-search-input').value, b.dataset.cat);
  }));

  // ---------------- watchlist ----------------
  const WL_DEFAULT = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30', 'NAS100', 'SPX500', 'AAPL', 'NVDA', 'TSLA', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  function renderWatchlist() {
    $('#watchlist').innerHTML = WL_DEFAULT.map(sym => {
      const s = getSymbol(sym);
      return `<div class="wl-item" data-sym="${sym}">
        <div><div class="wl-sym">${sym}</div><div class="wl-name">${s.name}</div></div>
        <div class="wl-price" id="wlp-${sym}">—</div>
      </div>`;
    }).join('');
    $$('.wl-item').forEach(r => r.addEventListener('click', () => {
      App.currentSymbol = r.dataset.sym;
      loadChart();
      highlightWatchlist();
    }));
    highlightWatchlist();
  }
  function highlightWatchlist() {
    $$('.wl-item').forEach(r => r.classList.toggle('active', r.dataset.sym === App.currentSymbol));
  }

  // ---------------- indicators modal ----------------
  function renderIndicatorModal() {
    $('#indicators-list').innerHTML = INDICATOR_DEFS.map(d => `
      <div class="ind-row" data-ind="${d.id}">
        <span>${d.name}</span>
        <i class="fa-solid ${ChartMgr.activeIndicators.has(d.id) ? 'fa-check' : 'fa-plus'}"></i>
      </div>`).join('');
    $('#active-indicators').innerHTML = [...ChartMgr.activeIndicators].map(id => {
      const d = INDICATOR_DEFS.find(x => x.id === id);
      return `<div class="act-ind"><span>${d.name}</span><i class="fa-solid fa-trash" data-rm="${id}"></i></div>`;
    }).join('') || '<div style="color:#555;padding:4px 12px;font-size:12px">None</div>';
    $$('#indicators-list .ind-row').forEach(r => r.addEventListener('click', () => {
      ChartMgr.toggleIndicator(r.dataset.ind);
      renderIndicatorModal();
    }));
    $$('#active-indicators [data-rm]').forEach(i => i.addEventListener('click', () => {
      ChartMgr.removeIndicator(i.dataset.rm);
      renderIndicatorModal();
    }));
  }
  $('#indicators-btn').addEventListener('click', () => { openModal('#indicators-modal'); renderIndicatorModal(); });

  // ---------------- drawing toolbar ----------------
  $$('.draw-btn[data-tool]').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tool;
    if (t === 'cursor' || t === 'crosshair') { Draw.setTool('cursor'); return; }
    Draw.setTool(t);
  }));
  $('#magnet-btn').addEventListener('click', function () {
    this.classList.toggle('active', Draw.toggleMagnet());
  });
  $('#del-last-btn').addEventListener('click', () => Draw.deleteSelected());
  $('#del-all-btn').addEventListener('click', () => Draw.deleteAll());

  // ---------------- bottom panel tabs ----------------
  $$('.bp-tab').forEach(b => b.addEventListener('click', () => {
    $$('.bp-tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $$('.bp-page').forEach(p => p.classList.toggle('active', p.dataset.page === b.dataset.tab));
    $('#bottom-panel').classList.remove('collapsed');
  }));
  $('#bp-collapse').addEventListener('click', () => $('#bottom-panel').classList.toggle('collapsed'));
  $$('.tr-subtab').forEach(b => b.addEventListener('click', () => {
    $$('.tr-subtab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $$('.tr-page').forEach(p => p.classList.toggle('active', p.dataset.trpage === b.dataset.sub));
  }));

  // ---------------- strategy editor ----------------
  const langSel = $('#strategy-lang'), exSel = $('#strategy-example'), codeTA = $('#strategy-code');
  function fillExamples() {
    const ex = StrategyRunner.EXAMPLES[langSel.value];
    exSel.innerHTML = Object.keys(ex).map(k => `<option>${k}</option>`).join('');
    codeTA.value = ex[Object.keys(ex)[0]];
  }
  langSel.addEventListener('change', fillExamples);
  exSel.addEventListener('change', () => { codeTA.value = StrategyRunner.EXAMPLES[langSel.value][exSel.value]; });
  fillExamples();

  $('#editor-validate').addEventListener('click', () => {
    const v = StrategyRunner.validate(langSel.value, codeTA.value);
    const msg = $('#editor-msg');
    msg.textContent = v.ok ? '✓ Syntax OK' : '✗ ' + v.error;
    msg.className = v.ok ? 'ok' : 'err';
  });
  $('#editor-run').addEventListener('click', () => openModal('#backtest-modal'));
  $('#tester-run-shortcut').addEventListener('click', () => openModal('#backtest-modal'));
  $('#backtest-btn').addEventListener('click', () => openModal('#backtest-modal'));

  // ---------------- backtest modal ----------------
  $('#bt-propfirm').addEventListener('change', (e) => {
    $('#pf-custom').classList.toggle('hidden', e.target.value !== 'custom');
  });
  $('#bt-run').addEventListener('click', () => BacktestUI.runBacktest());

  // ---------------- account / manual settings modal ----------------
  $('#acct-settings-btn').addEventListener('click', () => openModal('#acct-modal'));
  $('#am-apply').addEventListener('click', () => {
    App.manualSettings = {
      balance: parseFloat($('#am-balance').value) || 100000,
      leverage: parseInt($('#am-leverage').value) || 100,
      spread: parseFloat($('#am-spread').value) || 0,
      commission: parseFloat($('#am-commission').value) || 0,
      propMode: $('#am-propfirm').value,
    };
    $('#ap-leverage').textContent = '1:' + App.manualSettings.leverage;
    App.resetAccountUI();
    App.closeModals();
    App.toast('Account settings applied' + (Replay.isActive() ? ' — replay account reset' : ''));
    if (Replay.isActive()) { Replay.exit(); }
  });

  // ---------------- replay controls ----------------
  $('#replay-btn').addEventListener('click', () => {
    if (Replay.isActive()) { Replay.exit(); return; }
    openModal('#goto-modal');
    // default date = 30% into the chart
    const c = ChartMgr.candles;
    if (c.length) {
      const t = c[Math.floor(c.length * 0.3)].time;
      $('#goto-date').value = new Date(t * 1000).toISOString().slice(0, 10);
    }
  });
  $('#goto-apply').addEventListener('click', () => {
    App.closeModals();
    Replay.gotoDate($('#goto-date').value);
  });
  $('#rp-goto').addEventListener('click', () => openModal('#goto-modal'));
  $('#rp-step').addEventListener('click', () => Replay.stepForward());
  $('#rp-step-back').addEventListener('click', () => Replay.stepBack());
  $('#rp-play').addEventListener('click', () => Replay.play());
  $('#rp-exit').addEventListener('click', () => Replay.exit());
  $('#rp-speed').addEventListener('change', () => { if (Replay.isActive()) { Replay.pause(); Replay.play(); } });
  window.addEventListener('keydown', (e) => {
    if (!Replay.isActive() || ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); Replay.stepForward(); }
    if (e.key === ' ') { e.preventDefault(); Replay.play(); }
  });

  // trade panel
  $('#tp-buy').addEventListener('click', () => Replay.manualOrder(1));
  $('#tp-sell').addEventListener('click', () => Replay.manualOrder(-1));
  $('#tp-closeall').addEventListener('click', () => Replay.closeAllManual());
  $('#tp-close').addEventListener('click', () => $('#trade-panel').classList.add('hidden'));

  // ---------------- account UI ----------------
  const fmt$ = (v) => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  App.updateAccountUI = (broker, bar) => {
    const bid = bar.close;
    const eq = broker.equity(bid);
    const pnl = broker.floatPnl(bid);
    const um = broker.usedMargin(bid);
    $('#chip-balance').textContent = fmt$(broker.balance);
    $('#chip-equity').textContent = fmt$(eq);
    const pnlEl = $('#chip-pnl');
    pnlEl.textContent = fmt$(pnl);
    pnlEl.className = pnl > 0 ? 'up' : pnl < 0 ? 'down' : 'flat';
    $('#ap-balance').textContent = fmt$(broker.balance);
    $('#ap-equity').textContent = fmt$(eq);
    $('#ap-margin').textContent = fmt$(um);
    $('#ap-free').textContent = fmt$(eq - um);
    $('#ap-leverage').textContent = '1:' + broker.leverage;
    $('#ap-pnl').textContent = fmt$(pnl);
    $('#ap-pnl').className = pnl > 0 ? 'up' : pnl < 0 ? 'down' : '';

    // prop firm live panel
    if (broker.propState) {
      $('#ap-propfirm').classList.remove('hidden');
      const ps = broker.propState;
      const dailyUsed = ps.dayStartEquity - Math.min(ps.dayStartEquity, eq);
      const dailyLimit = ps.dayStartEquity * broker.prop.dailyPct / 100;
      $('#pf-daily').textContent = fmt$(dailyUsed) + ' / ' + fmt$(dailyLimit);
      const ddBase = broker.prop.ddType === 'trailing' ? ps.peakEquity : broker.initial;
      $('#pf-maxdd').textContent = fmt$(Math.max(0, ddBase - eq)) + ' / ' + fmt$(ddBase * broker.prop.maxPct / 100);
      $('#pf-target').textContent = broker.prop.targetPct > 0 ? fmt$(broker.initial * (1 + broker.prop.targetPct / 100)) : '—';
      const st = $('#pf-status');
      st.textContent = ps.status === 'active' ? 'ACTIVE' : ps.status === 'passed' ? 'PASSED ✔' : 'FAILED ✘';
      st.className = ps.status === 'active' ? 'ok' : ps.status === 'passed' ? 'passed' : 'fail';
      if (ps.status.startsWith('failed')) App.toast('PROP FIRM RULE BREACHED — ' + (ps.status === 'failed_daily' ? 'daily loss limit' : 'max drawdown'));
    } else {
      $('#ap-propfirm').classList.add('hidden');
    }
  };

  App.resetAccountUI = () => {
    const s = App.manualSettings;
    $('#chip-balance').textContent = fmt$(s.balance);
    $('#chip-equity').textContent = fmt$(s.balance);
    $('#chip-pnl').textContent = '$0.00';
    $('#chip-pnl').className = 'flat';
    $('#ap-balance').textContent = fmt$(s.balance);
    $('#ap-equity').textContent = fmt$(s.balance);
    $('#ap-margin').textContent = '$0.00';
    $('#ap-free').textContent = fmt$(s.balance);
    $('#ap-leverage').textContent = '1:' + s.leverage;
    $('#ap-pnl').textContent = '$0.00';
    $('#ap-propfirm').classList.add('hidden');
    $('#open-positions-table').innerHTML = '';
    $('#closed-trades-table').innerHTML = '';
  };

  App.renderPositions = (broker, bar) => {
    const dg = App.currentSymbolInfo.digits;
    const bid = bar.close;
    $('#open-positions-table').innerHTML = broker.positions.length ? `<table class="bt-table">
      <thead><tr><th>ID</th><th>Side</th><th>Lots</th><th>Entry</th><th>SL</th><th>TP</th><th>PnL</th></tr></thead><tbody>` +
      broker.positions.map(p => {
        const pnl = broker.posPnl(p, bid);
        return `<tr><td>${p.id}</td>
          <td><span class="badge ${p.dir > 0 ? 'long' : 'short'}">${p.dir > 0 ? 'LONG' : 'SHORT'}</span></td>
          <td>${p.lots}</td><td>${p.entry.toFixed(dg)}</td>
          <td>${p.sl ? p.sl.toFixed(dg) : '—'}</td><td>${p.tp ? p.tp.toFixed(dg) : '—'}</td>
          <td class="${pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''}">${fmt$(pnl)}</td></tr>`;
      }).join('') + '</tbody></table>' : '<p style="color:#555;font-size:12px;padding:4px 0">No open positions</p>';

    $('#closed-trades-table').innerHTML = broker.closed.length ? `<table class="bt-table">
      <thead><tr><th>ID</th><th>Side</th><th>Lots</th><th>Entry</th><th>Exit</th><th>Reason</th><th>PnL</th></tr></thead><tbody>` +
      [...broker.closed].reverse().map(t =>
        `<tr><td>${t.id}</td>
          <td><span class="badge ${t.dir > 0 ? 'long' : 'short'}">${t.dir > 0 ? 'LONG' : 'SHORT'}</span></td>
          <td>${t.lots}</td><td>${t.entry.toFixed(dg)}</td><td>${t.exit.toFixed(dg)}</td>
          <td>${t.reason.toUpperCase()}</td>
          <td class="${t.pnl > 0 ? 'up' : 'down'}">${fmt$(t.pnl)}</td></tr>`).join('') + '</tbody></table>'
      : '<p style="color:#555;font-size:12px;padding:4px 0">No closed trades</p>';
  };

  // ---------------- boot ----------------
  renderWatchlist();
  App.resetAccountUI();
  loadChart();
})();
