// ===========================================================================
// Bar Replay — pick a start date, step or play through bars one at a time and
// trade manually against the same broker model the backtester uses.
// Step-back is a real rewind: the broker state is snapshotted every bar.
// ===========================================================================
const Replay = (() => {
  let active = false;
  let all = [];          // full candle array
  let idx = 0;           // index of last visible bar
  let startIdx = 0;      // where the session began
  let timer = null;
  let broker = null;
  let markers = [];
  let snaps = [];        // [{idx, state, markerCount}] — for true step-back
  const MAX_SNAPS = 4000;

  const $ = (s) => document.querySelector(s);

  function isActive() { return active; }
  function isPlaying() { return timer !== null; }

  // ---- lifecycle --------------------------------------------------------
  function start(fromTime) {
    all = ChartMgr.candles.slice();
    if (all.length < 10) {
      window.App.toast('Load a chart with more history before starting replay', 'err');
      return false;
    }
    if (fromTime) {
      idx = all.findIndex(c => c.time >= fromTime);
      if (idx < 0) idx = Math.max(0, Math.floor(all.length * 0.3));
    } else {
      idx = Math.max(0, Math.floor(all.length * 0.3));
    }
    if (idx < 5) idx = 5;
    startIdx = idx;
    active = true;
    markers = [];
    snaps = [];
    resetBroker();
    render();
    $('#replay-bar').classList.remove('hidden');
    $('#ticket').classList.remove('hidden');
    updateTimeLabel();
    updateProgress();
    window.App.renderPositions(broker, all[idx]);
    return true;
  }

  function resetBroker() {
    const s = window.App.manualSettings;
    broker = new Broker({
      balance: s.balance, leverage: s.leverage, spread: s.spread,
      commission: s.commission, symInfo: window.App.currentSymbolInfo,
      prop: propFromMode(s.propMode),
    });
    window.App.updateAccountUI(broker, all[idx]);
  }

  function propFromMode(mode) {
    switch (mode) {
      case 'ftmo1': return { targetPct: 10, dailyPct: 5, maxPct: 10, ddType: 'static' };
      case 'ftmo2': return { targetPct: 5, dailyPct: 5, maxPct: 10, ddType: 'static' };
      case 'funded': return { targetPct: 0, dailyPct: 5, maxPct: 10, ddType: 'static' };
      default: return null;
    }
  }

  function exit() {
    pause();
    active = false;
    snaps = [];
    $('#replay-bar').classList.add('hidden');
    $('#ticket').classList.add('hidden');
    ChartMgr.clearPriceLines();
    ChartMgr.setData(all, window.App.currentSymbolInfo);
    ChartMgr.setMarkers([]);
    window.App.resetAccountUI();
  }

  // ---- rendering --------------------------------------------------------
  function render() {
    const visible = all.slice(0, idx + 1);
    ChartMgr.setData(visible, window.App.currentSymbolInfo);
    ChartMgr.setMarkers(markers);
    drawPositionLines();
  }

  function refreshIndicatorsVisible() { render(); }

  function updateProgress() {
    const fill = $('#rp-progress-fill');
    if (!fill || !all.length) return;
    fill.style.width = ((idx + 1) / all.length * 100).toFixed(2) + '%';
  }

  function updateTimeLabel() {
    const bar = all[idx];
    if (!bar) return;
    const d = new Date(bar.time * 1000);
    const lbl = $('#rp-time');
    if (lbl) lbl.textContent = d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

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
    if (!active) return;
    if (idx >= all.length - 1) {
      pause();
      window.App.toast('End of the loaded history reached', 'warn');
      return;
    }

    // snapshot BEFORE advancing so step-back lands on the current state
    snaps.push({ idx, state: broker.snapshot(), markerCount: markers.length });
    if (snaps.length > MAX_SNAPS) snaps.shift();

    idx++;
    const bar = all[idx];
    const closedBefore = broker.closed.length;
    broker.onBar(bar);
    if (broker.closed.length > closedBefore) {
      for (let i = closedBefore; i < broker.closed.length; i++) addCloseMarker(broker.closed[i]);
    }
    ChartMgr.updateBar(bar);
    ChartMgr.setMarkers(markers);
    drawPositionLines();
    updateTimeLabel();
    updateProgress();
    window.App.updateAccountUI(broker, bar);
    window.App.renderPositions(broker, bar);

    if (broker.propState && broker.propState.status !== 'active') {
      pause();
      const st = broker.propState.status;
      if (st.startsWith('failed')) {
        broker.closeAll(bar, 'prop_fail');
        window.App.renderPositions(broker, bar);
        window.App.updateAccountUI(broker, bar);
        window.App.toast(st === 'failed_daily'
          ? 'Rule breach — daily loss limit hit. All positions closed.'
          : 'Rule breach — max drawdown hit. All positions closed.', 'err');
      } else if (st === 'passed') {
        window.App.toast('Profit target reached — challenge passed', 'ok');
      }
    }

    if (idx % 25 === 0) refreshIndicatorsVisible();
  }

  function stepBack() {
    if (!active) return;
    pause();
    const s = snaps.pop();
    if (!s) { window.App.toast('Already at the start of this replay session', 'warn'); return; }
    idx = s.idx;
    broker.restore(s.state);
    markers.length = s.markerCount;
    render();
    updateTimeLabel();
    updateProgress();
    window.App.updateAccountUI(broker, all[idx]);
    window.App.renderPositions(broker, all[idx]);
  }

  function play() {
    if (!active) return;
    if (timer) { pause(); return; }
    const speed = parseInt($('#rp-speed').value) || 1000;
    const ico = $('#rp-play i');
    if (ico) ico.className = 'fa-solid fa-pause';
    $('#rp-play').classList.add('playing');
    timer = setInterval(stepForward, speed);
  }

  function pause() {
    if (timer) { clearInterval(timer); timer = null; }
    const ico = $('#rp-play i');
    if (ico) ico.className = 'fa-solid fa-play';
    const btn = $('#rp-play');
    if (btn) btn.classList.remove('playing');
  }

  function gotoDate(dateStr) {
    if (!dateStr) return;
    const parts = dateStr.split('-').map(Number);
    const t = Date.UTC(parts[0], (parts[1] || 1) - 1, parts[2] || 1) / 1000;
    if (active) {
      pause();
      const found = all.findIndex(c => c.time >= t);
      if (found < 0) { window.App.toast('That date is outside the loaded range', 'err'); return; }
      idx = Math.max(5, found);
      startIdx = idx;
      markers = [];
      snaps = [];
      resetBroker();
      render();
      updateTimeLabel();
      updateProgress();
      window.App.renderPositions(broker, all[idx]);
    } else {
      start(t);
    }
  }

  // ---- manual trading ---------------------------------------------------
  function manualOrder(dir) {
    if (!active) { window.App.toast('Start replay first — manual orders need a moving clock', 'warn'); return; }
    const lots = parseFloat($('#tk-size').value) || 1;
    const sl = parseFloat($('#tk-sl').value) || null;
    const tp = parseFloat($('#tk-tp').value) || null;
    const bar = all[idx];

    // sanity-check stop placement so the user gets a reason, not a silent no-op
    const px = dir > 0 ? bar.close + broker.spreadPrice : bar.close;
    if (sl !== null && ((dir > 0 && sl >= px) || (dir < 0 && sl <= px))) {
      window.App.toast(`Stop loss must be ${dir > 0 ? 'below' : 'above'} the entry price`, 'err'); return;
    }
    if (tp !== null && ((dir > 0 && tp <= px) || (dir < 0 && tp >= px))) {
      window.App.toast(`Take profit must be ${dir > 0 ? 'above' : 'below'} the entry price`, 'err'); return;
    }

    const pos = broker.open(dir, lots, bar, sl, tp, 'manual');
    if (!pos) { window.App.toast('Order rejected — not enough free margin for that size', 'err'); return; }

    markers.push({
      time: bar.time, position: dir > 0 ? 'belowBar' : 'aboveBar',
      color: dir > 0 ? '#26d0a5' : '#f2615c',
      shape: dir > 0 ? 'arrowUp' : 'arrowDown',
      text: (dir > 0 ? 'BUY ' : 'SELL ') + lots,
    });
    ChartMgr.setMarkers(markers);
    drawPositionLines();
    window.App.updateAccountUI(broker, bar);
    window.App.renderPositions(broker, bar);
    window.App.toast(`${dir > 0 ? 'Bought' : 'Sold'} ${lots} lot${lots === 1 ? '' : 's'} at ${px.toFixed(window.App.currentSymbolInfo.digits)}`, 'ok');
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
    drawPositionLines();
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
    drawPositionLines();
    window.App.updateAccountUI(broker, bar);
    window.App.renderPositions(broker, bar);
  }

  function drawPositionLines() {
    ChartMgr.clearPriceLines();
    if (!broker) return;
    for (const p of broker.positions) {
      ChartMgr.addPriceLine(p.entry, p.dir > 0 ? '#26d0a5' : '#f2615c',
        (p.dir > 0 ? 'LONG ' : 'SHORT ') + p.lots, 0);
      if (p.sl) ChartMgr.addPriceLine(p.sl, '#f2615c', 'SL', 2);
      if (p.tp) ChartMgr.addPriceLine(p.tp, '#26d0a5', 'TP', 2);
    }
  }

  return {
    start, exit, stepForward, stepBack, play, pause,
    isActive, isPlaying,
    manualOrder, closeAllManual, closeOne, gotoDate,
    broker: () => broker,
    currentBar: () => all[idx],
    progress: () => (all.length ? (idx + 1) / all.length : 0),
  };
})();

window.Replay = Replay;
