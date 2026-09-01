// ===========================================================================
// Backtesting session / bar replay.
//
// Fixes over the previous version:
//   * play() uses a self-scheduling timeout instead of setInterval, so a slow
//     frame can never stack up callbacks (that was the "candles jump / skip"
//     and "play button does nothing after a while" bug).
//   * the replay owns its own `visible` array; the chart appends one bar at a
//     time instead of being handed a fresh slice on every step, so the zoom no
//     longer resets and drawings stay anchored.
//   * settings (balance / leverage / spread / commission / prop) are captured
//     once at session start into `cfg` and are the only source of truth for the
//     broker, so nothing can silently reset your starting balance mid-session.
//   * price lines are diffed, not rebuilt.
//   * step-back restores the visible bar count too, not just the broker.
//   * exit() no longer nukes the account panel to a different balance.
// ===========================================================================
const Replay = (() => {
  let active = false;
  let all = [];          // full candle array (the whole downloaded window)
  let visible = [];      // bars revealed so far — this is what the chart holds
  let idx = 0;           // index of last visible bar in `all`
  let startIdx = 0;      // where the session began
  let timer = null;
  let broker = null;
  let markers = [];
  let snaps = [];        // [{idx, state, markerCount}] — for true step-back
  let cfg = null;        // frozen account config for this session
  let meta = null;       // {sym, tf, startDate}
  let speedMs = 1000;
  let stepping = false;  // re-entrancy guard

  const MAX_SNAPS = 6000;
  const $ = (s) => document.querySelector(s);

  function isActive() { return active; }
  function isPlaying() { return timer !== null; }
  function config() { return cfg; }
  function sessionMeta() { return meta; }

  // ---- lifecycle --------------------------------------------------------
  /**
   * @param {number} fromTime unix sec of the first tradeable bar
   * @param {object} opts { settings, sym, tf, startDate }
   */
  function start(fromTime, opts = {}) {
    all = ChartMgr.candles.slice();
    if (all.length < 10) {
      window.App.toast('Not enough history to start a session — pick an earlier start date or a higher timeframe', 'err');
      return false;
    }

    // Freeze the account config for the whole session. This is the fix for
    // "the balance I set is not the balance I get".
    const s = opts.settings || window.App.manualSettings;
    cfg = {
      balance: Number(s.balance) || 100000,
      leverage: parseInt(s.leverage) || 100,
      spread: Number(s.spread) || 0,
      commission: Number(s.commission) || 0,
      propMode: s.propMode || 'none',
    };
    meta = {
      sym: opts.sym || window.App.currentSymbol,
      tf: opts.tf || window.App.currentTF,
      startDate: opts.startDate || null,
    };

    if (fromTime) {
      idx = all.findIndex(c => c.time >= fromTime);
      if (idx < 0) idx = Math.max(0, Math.floor(all.length * 0.3));
    } else {
      idx = Math.max(0, Math.floor(all.length * 0.3));
    }
    // need a little warm-up history behind the start so indicators have data
    if (idx < 20) idx = Math.min(20, all.length - 1);

    startIdx = idx;
    active = true;
    markers = [];
    snaps = [];
    visible = all.slice(0, idx + 1);

    buildBroker();

    document.body.classList.add('in-session');
    $('#replay-bar').classList.remove('hidden');
    $('#ticket').classList.remove('hidden');
    $('#chart-hint') && $('#chart-hint').classList.add('hidden');

    ChartMgr.setData(visible, window.App.currentSymbolInfo, { lastBars: 180 });
    ChartMgr.setMarkers(markers);
    syncPositionLines();
    TradeOverlay.setEnabled(true);
    window.LiveChart && LiveChart.refresh();   // a session owns the bars; stand down

    refreshUI();
    return true;
  }

  function buildBroker() {
    broker = new Broker({
      balance: cfg.balance, leverage: cfg.leverage, spread: cfg.spread,
      commission: cfg.commission, symInfo: window.App.currentSymbolInfo,
      prop: propFromMode(cfg.propMode),
    });
  }

  function propFromMode(mode) {
    switch (mode) {
      case 'ftmo1': return { targetPct: 10, dailyPct: 5, maxPct: 10, ddType: 'static' };
      case 'ftmo2': return { targetPct: 5, dailyPct: 5, maxPct: 10, ddType: 'static' };
      case 'funded': return { targetPct: 0, dailyPct: 5, maxPct: 10, ddType: 'static' };
      default: return null;
    }
  }

  /** Restart the session at its original start bar, same settings. */
  function restart() {
    if (!active) return;
    pause();
    idx = startIdx;
    visible = all.slice(0, idx + 1);
    markers = [];
    snaps = [];
    buildBroker();
    ChartMgr.setData(visible, window.App.currentSymbolInfo, { lastBars: 180 });
    ChartMgr.setMarkers(markers);
    syncPositionLines();
    refreshUI();
    window.App.toast('Session restarted from ' + fmtBarTime(all[idx]), 'ok');
  }

  function exit() {
    if (!active) return;
    pause();
    active = false;
    snaps = [];
    markers = [];
    TradeOverlay.setEnabled(false);
    window.LiveChart && LiveChart.refresh();   // session over — live may resume
    document.body.classList.remove('in-session');
    $('#replay-bar').classList.add('hidden');
    $('#ticket').classList.add('hidden');
    ChartMgr.clearPriceLines();
    ChartMgr.setData(all, window.App.currentSymbolInfo, { fit: true });
    ChartMgr.setMarkers([]);
    window.App.resetAccountUI(cfg);
    window.App.toast('Session ended — the full chart is back', 'info');
  }

  // ---- UI sync ----------------------------------------------------------
  function refreshUI() {
    const bar = all[idx];
    if (!bar) return;
    if (window.App.renderLegend) window.App.renderLegend();
    updateTimeLabel();
    updateProgress();
    window.App.updateAccountUI(broker, bar);
    window.App.renderPositions(broker, bar);
  }

  function fmtBarTime(bar) {
    if (!bar) return '—';
    return new Date(bar.time * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  }

  function updateProgress() {
    const fill = $('#rp-progress-fill');
    if (fill && all.length) {
      const span = all.length - 1 - startIdx;
      const done = span > 0 ? (idx - startIdx) / span : 1;
      fill.style.width = (Math.max(0, Math.min(1, done)) * 100).toFixed(2) + '%';
    }
    const lbl = $('#rp-count');
    if (lbl) lbl.textContent = `${(idx - startIdx).toLocaleString()} / ${(all.length - 1 - startIdx).toLocaleString()} bars`;
  }

  function updateTimeLabel() {
    const bar = all[idx];
    if (!bar) return;
    const lbl = $('#rp-time');
    if (lbl) lbl.textContent = fmtBarTime(bar);

    const dg = window.App.currentSymbolInfo.digits;
    const bid = bar.close;
    const ask = bid + (broker ? broker.spreadPrice : 0);
    const eb = $('#tk-bid'), ea = $('#tk-ask');
    if (eb) eb.textContent = bid.toFixed(dg);
    if (ea) ea.textContent = ask.toFixed(dg);
    window.App.updateTicketRisk();
  }

  // ---- stepping ---------------------------------------------------------
  function stepForward() {
    if (!active || stepping) return false;
    if (idx >= all.length - 1) {
      pause();
      window.App.toast('End of the loaded history — jump to an earlier date or start a new session', 'warn');
      return false;
    }
    stepping = true;
    try {
      // snapshot BEFORE advancing so step-back lands on the current state
      snaps.push({ idx, state: broker.snapshot(), markerCount: markers.length });
      if (snaps.length > MAX_SNAPS) snaps.shift();

      idx++;
      const bar = all[idx];
      visible.push(bar);

      const closedBefore = broker.closed.length;
      broker.onBar(bar);
      if (broker.closed.length > closedBefore) {
        for (let i = closedBefore; i < broker.closed.length; i++) addCloseMarker(broker.closed[i]);
        ChartMgr.setMarkers(markers);
      }

      // chart: one incremental append, no full reset (this is the candle fix)
      ChartMgr.appendBar(bar);
      syncPositionLines();
      if (window.App.renderLegend) window.App.renderLegend();
      updateTimeLabel();
      updateProgress();
      window.App.updateAccountUI(broker, bar);
      window.App.renderPositions(broker, bar);

      if (broker.propState && broker.propState.status !== 'active') handlePropEvent(bar);
    } finally {
      stepping = false;
    }
    return true;
  }

  function handlePropEvent(bar) {
    pause();
    const st = broker.propState.status;
    if (st.startsWith('failed')) {
      broker.closeAll(bar, 'prop_fail');
      for (let i = 0; i < broker.closed.length; i++) { /* markers added below */ }
      syncPositionLines();
      window.App.renderPositions(broker, bar);
      window.App.updateAccountUI(broker, bar);
      window.App.toast(st === 'failed_daily'
        ? 'Rule breach — daily loss limit hit. All positions closed.'
        : 'Rule breach — max drawdown hit. All positions closed.', 'err');
    } else if (st === 'passed') {
      window.App.toast('Profit target reached — challenge passed', 'ok');
    }
  }

  function stepBack() {
    if (!active) return;
    pause();
    const s = snaps.pop();
    if (!s) { window.App.toast('Already at the first bar of this session', 'warn'); return; }
    idx = s.idx;
    broker.restore(s.state);
    markers.length = s.markerCount;
    visible = all.slice(0, idx + 1);
    ChartMgr.truncate(visible);
    ChartMgr.setMarkers(markers);
    syncPositionLines();
    refreshUI();
  }

  /** Step N bars at once (used by the ×10 / ×50 skip buttons). */
  function skip(n) {
    if (!active) return;
    pause();
    for (let i = 0; i < n; i++) if (!stepForward()) break;
  }

  // ---- playback --------------------------------------------------------
  // A self-rescheduling timeout: each tick only fires after the previous one
  // finished, so slow machines lose frames instead of queueing them up.
  function play() {
    if (!active) return;
    if (timer) { pause(); return; }
    speedMs = readSpeed();
    setPlayIcon(true);
    const tick = () => {
      if (!active || timer === null) return;
      const ok = stepForward();
      if (!ok) { pause(); return; }
      if (timer !== null) timer = setTimeout(tick, speedMs);
    };
    timer = setTimeout(tick, speedMs);
  }

  function readSpeed() {
    const el = $('#rp-speed');
    const v = el ? parseInt(el.value) : 1000;
    return isFinite(v) && v > 0 ? v : 1000;
  }

  function setSpeed() {
    speedMs = readSpeed();
    if (timer !== null) { pause(); play(); }
  }

  function pause() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    setPlayIcon(false);
  }

  function setPlayIcon(playing) {
    const btn = $('#rp-play');
    if (!btn) return;
    const ico = btn.querySelector('i');
    if (ico) ico.className = playing ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    btn.classList.toggle('playing', playing);
    btn.setAttribute('data-tip', playing ? 'Pause  (Space)' : 'Play  (Space)');
  }

  function gotoDate(dateStr) {
    if (!dateStr) return;
    const parts = dateStr.split('-').map(Number);
    const t = Date.UTC(parts[0], (parts[1] || 1) - 1, parts[2] || 1) / 1000;
    if (!active) { window.App.toast('Start a session first', 'warn'); return; }
    pause();
    const found = all.findIndex(c => c.time >= t);
    if (found < 0) {
      window.App.toast('That date is outside the downloaded window — start a new session for it', 'err');
      return;
    }
    idx = Math.max(20, found);
    startIdx = idx;
    markers = [];
    snaps = [];
    visible = all.slice(0, idx + 1);
    buildBroker();
    ChartMgr.setData(visible, window.App.currentSymbolInfo, { lastBars: 180 });
    ChartMgr.setMarkers(markers);
    syncPositionLines();
    refreshUI();
    window.App.toast('Jumped to ' + fmtBarTime(all[idx]) + ' — account reset', 'ok');
  }

  // ---- manual trading ---------------------------------------------------
  function quote() {
    const bar = all[idx];
    if (!bar || !broker) return null;
    const bid = bar.close;
    return { bid, ask: bid + broker.spreadPrice, bar };
  }

  /**
   * @param {number} dir 1 = buy, -1 = sell
   * @param {object} o { lots, sl, tp } — omitted fields come from the ticket
   */
  function manualOrder(dir, o = {}) {
    if (!active) { window.App.toast('Start a session first — manual orders need a moving clock', 'warn'); return false; }
    const q = quote();
    if (!q) return false;
    const lots = Number(o.lots != null ? o.lots : parseFloat($('#tk-size').value)) || 0;
    if (lots <= 0) { window.App.toast('Size must be greater than zero', 'err'); return false; }
    const sl = o.sl !== undefined ? o.sl : numOrNull($('#tk-sl').value);
    const tp = o.tp !== undefined ? o.tp : numOrNull($('#tk-tp').value);

    const px = dir > 0 ? q.ask : q.bid;
    if (sl !== null && ((dir > 0 && sl >= px) || (dir < 0 && sl <= px))) {
      window.App.toast(`Stop loss must be ${dir > 0 ? 'below' : 'above'} the entry price (${px.toFixed(window.App.currentSymbolInfo.digits)})`, 'err');
      return false;
    }
    if (tp !== null && ((dir > 0 && tp <= px) || (dir < 0 && tp >= px))) {
      window.App.toast(`Take profit must be ${dir > 0 ? 'above' : 'below'} the entry price (${px.toFixed(window.App.currentSymbolInfo.digits)})`, 'err');
      return false;
    }

    const pos = broker.open(dir, lots, q.bar, sl, tp, 'manual');
    if (!pos) {
      const free = broker.equity(q.bid) - broker.usedMargin(q.bid);
      window.App.toast(`Order rejected — needs ${window.App.fmt$(broker.marginRequired(px, lots))} margin, only ${window.App.fmt$(free)} free`, 'err');
      return false;
    }

    markers.push({
      time: q.bar.time, position: dir > 0 ? 'belowBar' : 'aboveBar',
      color: dir > 0 ? '#26d0a5' : '#f2615c',
      shape: dir > 0 ? 'arrowUp' : 'arrowDown',
      text: (dir > 0 ? 'BUY ' : 'SELL ') + lots,
    });
    ChartMgr.setMarkers(markers);
    syncPositionLines();
    window.App.updateAccountUI(broker, q.bar);
    window.App.renderPositions(broker, q.bar);
    window.App.toast(`${dir > 0 ? 'Bought' : 'Sold'} ${lots} lot${lots === 1 ? '' : 's'} at ${px.toFixed(window.App.currentSymbolInfo.digits)}`, 'ok');
    return true;
  }

  function numOrNull(v) {
    const n = parseFloat(v);
    return isFinite(n) && n !== 0 ? n : null;
  }

  function addCloseMarker(tr) {
    const tag = tr.reason === 'sl' ? 'SL' : tr.reason === 'tp' ? 'TP'
      : tr.reason === 'margin_call' ? 'MC' : tr.reason === 'prop_fail' ? '!' : 'X';
    markers.push({
      time: tr.closeTime, position: tr.dir > 0 ? 'aboveBar' : 'belowBar',
      color: tr.pnl >= 0 ? '#26d0a5' : '#f2615c',
      shape: 'circle',
      text: tag + ' ' + (tr.pnl >= 0 ? '+' : '') + tr.pnl.toFixed(0),
    });
  }

  function closeAllManual() {
    if (!active || !broker.positions.length) { window.App.toast('No open positions', 'warn'); return; }
    const bar = all[idx];
    const before = broker.closed.length;
    broker.closeAll(bar, 'manual');
    let pnl = 0;
    for (let i = before; i < broker.closed.length; i++) { addCloseMarker(broker.closed[i]); pnl += broker.closed[i].pnl; }
    ChartMgr.setMarkers(markers);
    syncPositionLines();
    window.App.updateAccountUI(broker, bar);
    window.App.renderPositions(broker, bar);
    window.App.toast(`Closed ${broker.closed.length - before} position(s) for ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
      pnl >= 0 ? 'ok' : 'warn');
  }

  function closeOne(id) {
    if (!active) return;
    const bar = all[idx];
    const p = broker.positions.find(x => x.id === id);
    if (!p) return;
    const before = broker.closed.length;
    const bid = bar.close, ask = bid + broker.spreadPrice;
    broker.close(p, p.dir > 0 ? bid : ask, bar.time, 'manual');
    for (let i = before; i < broker.closed.length; i++) addCloseMarker(broker.closed[i]);
    ChartMgr.setMarkers(markers);
    syncPositionLines();
    window.App.updateAccountUI(broker, bar);
    window.App.renderPositions(broker, bar);
    const tr = broker.closed[broker.closed.length - 1];
    if (tr) window.App.toast(`Position #${id} closed for ${tr.pnl >= 0 ? '+' : ''}$${tr.pnl.toFixed(2)}`,
      tr.pnl >= 0 ? 'ok' : 'warn');
  }

  /**
   * Move / set the stop or target of an open position (used by drag + ticket).
   * A stop exactly AT the entry is allowed — that is break-even, which is the
   * single most common stop move there is.
   */
  function modifyPosition(id, { sl, tp }) {
    if (!active || !broker) return false;
    const p = broker.positions.find(x => x.id === id);
    if (!p) return false;
    if (sl !== undefined) {
      if (sl !== null && ((p.dir > 0 && sl > p.entry) || (p.dir < 0 && sl < p.entry))) return false;
      p.sl = sl;
    }
    if (tp !== undefined) {
      if (tp !== null && ((p.dir > 0 && tp <= p.entry) || (p.dir < 0 && tp >= p.entry))) return false;
      p.tp = tp;
    }
    syncPositionLines();
    const bar = all[idx];
    window.App.renderPositions(broker, bar);
    return true;
  }

  /** Move the stop to break-even. */
  function breakEven(id) {
    const p = broker && broker.positions.find(x => x.id === id);
    if (!p) return;
    if (modifyPosition(id, { sl: p.entry })) window.App.toast(`Stop moved to break-even on #${id}`, 'ok');
  }

  // ---- chart price lines (diffed, so no flicker) ------------------------
  function syncPositionLines() {
    if (!broker) { ChartMgr.syncPriceLines([]); return; }
    const specs = [];
    for (const p of broker.positions) {
      specs.push({
        key: `p${p.id}:e`, price: p.entry, color: p.dir > 0 ? '#26d0a5' : '#f2615c',
        title: (p.dir > 0 ? 'LONG ' : 'SHORT ') + p.lots, style: 0, width: 1,
      });
      if (p.sl != null) specs.push({ key: `p${p.id}:sl`, price: p.sl, color: '#f2615c', title: 'SL', style: 2 });
      if (p.tp != null) specs.push({ key: `p${p.id}:tp`, price: p.tp, color: '#26d0a5', title: 'TP', style: 2 });
    }
    ChartMgr.syncPriceLines(specs);
  }

  return {
    start, exit, restart, stepForward, stepBack, skip, play, pause, setSpeed,
    isActive, isPlaying, config, sessionMeta,
    manualOrder, closeAllManual, closeOne, modifyPosition, breakEven, gotoDate,
    quote, syncPositionLines,
    broker: () => broker,
    currentBar: () => all[idx],
    currentIndex: () => idx,
    visibleCandles: () => visible,
    allCandles: () => all,
    progress: () => (all.length ? (idx + 1) / all.length : 0),
  };
})();

window.Replay = Replay;
