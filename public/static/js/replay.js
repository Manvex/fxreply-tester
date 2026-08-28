// ===========================================================================
// Bar Replay (fxreplay-style): pick a start date, step/play through bars,
// trade manually with the trade panel; broker + prop rules apply live.
// ===========================================================================
const Replay = (() => {
  let active = false;
  let all = [];          // full candle array
  let idx = 0;           // index of last visible bar
  let timer = null;
  let broker = null;
  let markers = [];

  const $ = (s) => document.querySelector(s);

  function isActive() { return active; }

  function start(fromTime) {
    all = ChartMgr.candles.slice();
    if (all.length < 10) return false;
    idx = 0;
    if (fromTime) {
      idx = all.findIndex(c => c.time >= fromTime);
      if (idx < 0) idx = 0;
    } else {
      idx = Math.max(0, Math.floor(all.length * 0.3));
    }
    active = true;
    markers = [];
    resetBroker();
    render();
    $('#replay-bar').classList.remove('hidden');
    $('#trade-panel').classList.remove('hidden');
    updateTimeLabel();
    return true;
  }

  function resetBroker() {
    const s = window.App.manualSettings;
    const prop = propFromMode(s.propMode);
    broker = new Broker({
      balance: s.balance, leverage: s.leverage, spread: s.spread,
      commission: s.commission, symInfo: window.App.currentSymbolInfo, prop,
    });
    // seed equity up to current idx
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

  function render() {
    const visible = all.slice(0, idx + 1);
    ChartMgr.setData(visible, window.App.currentSymbolInfo);
    ChartMgr.setMarkers(markers);
    drawPositionLines();
  }

  function stepForward() {
    if (!active || idx >= all.length - 1) { pause(); return; }
    idx++;
    const bar = all[idx];
    // broker processes the new bar
    const closedBefore = broker.closed.length;
    broker.onBar(bar);
    if (broker.closed.length > closedBefore) {
      for (let i = closedBefore; i < broker.closed.length; i++) addCloseMarker(broker.closed[i]);
    }
    ChartMgr.updateBar(bar);
    ChartMgr.setMarkers(markers);
    drawPositionLines();
    updateTimeLabel();
    window.App.updateAccountUI(broker, bar);
    window.App.renderPositions(broker, bar);
    // prop fail check
    if (broker.propState && broker.propState.status !== 'active') {
      pause();
      if (broker.propState.status.startsWith('failed')) {
        broker.closeAll(bar, 'prop_fail');
        window.App.renderPositions(broker, bar);
      }
    }
    // indicators need full recompute occasionally — cheap approach: every 20 bars
    if (idx % 20 === 0) refreshIndicatorsVisible();
  }

  function refreshIndicatorsVisible() {
    // recompute indicators on visible slice
    const visible = all.slice(0, idx + 1);
    // ChartMgr indicators are computed from ChartMgr.candles — update quietly
    ChartMgr.setData(visible, window.App.currentSymbolInfo);
    ChartMgr.setMarkers(markers);
    drawPositionLines();
  }

  function stepBack() {
    if (!active || idx <= 1) return;
    pause();
    idx--;
    // NOTE: broker state can't rewind — stepping back is visual only
    render();
    updateTimeLabel();
  }

  function play() {
    if (timer) { pause(); return; }
    const speed = parseInt($('#rp-speed').value);
    $('#rp-play i').className = 'fa-solid fa-pause';
    timer = setInterval(stepForward, speed);
  }

  function pause() {
    if (timer) { clearInterval(timer); timer = null; }
    const el = $('#rp-play i'); if (el) el.className = 'fa-solid fa-play';
  }

  function exit() {
    pause();
    active = false;
    $('#replay-bar').classList.add('hidden');
    $('#trade-panel').classList.add('hidden');
    ChartMgr.clearPriceLines();
    ChartMgr.setData(all, window.App.currentSymbolInfo);
    ChartMgr.setMarkers([]);
    window.App.resetAccountUI();
  }

  function updateTimeLabel() {
    const t = all[idx]?.time;
    if (!t) return;
    const d = new Date(t * 1000);
    $('#rp-time').textContent = d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    // update bid/ask in trade panel
    const bid = all[idx].close;
    const ask = bid + broker.spreadPrice;
    const dg = window.App.currentSymbolInfo.digits;
    $('#tp-bid').textContent = bid.toFixed(dg);
    $('#tp-ask').textContent = ask.toFixed(dg);
  }

  // ---------------- manual trading ----------------
  function manualOrder(dir) {
    if (!active) return;
    const lots = parseFloat($('#tp-size').value) || 1;
    const sl = parseFloat($('#tp-sl').value) || null;
    const tp = parseFloat($('#tp-tp').value) || null;
    const bar = all[idx];
    const pos = broker.open(dir, lots, bar, sl, tp, 'manual');
    if (!pos) { window.App.toast('Order rejected: not enough free margin'); return; }
    markers.push({
      time: bar.time, position: dir > 0 ? 'belowBar' : 'aboveBar',
      color: dir > 0 ? '#26a69a' : '#ef5350',
      shape: dir > 0 ? 'arrowUp' : 'arrowDown',
      text: (dir > 0 ? 'BUY ' : 'SELL ') + lots,
    });
    ChartMgr.setMarkers(markers);
    drawPositionLines();
    window.App.updateAccountUI(broker, bar);
    window.App.renderPositions(broker, bar);
  }

  function addCloseMarker(tr) {
    markers.push({
      time: tr.closeTime, position: tr.dir > 0 ? 'aboveBar' : 'belowBar',
      color: tr.pnl >= 0 ? '#26a69a' : '#ef5350',
      shape: 'circle',
      text: (tr.reason === 'sl' ? 'SL' : tr.reason === 'tp' ? 'TP' : 'X') + ' ' + (tr.pnl >= 0 ? '+' : '') + tr.pnl.toFixed(0),
    });
  }

  function closeAllManual() {
    if (!active) return;
    const bar = all[idx];
    const before = broker.closed.length;
    broker.closeAll(bar, 'manual');
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
      ChartMgr.addPriceLine(p.entry, p.dir > 0 ? '#26a69a' : '#ef5350', (p.dir > 0 ? 'LONG ' : 'SHORT ') + p.lots, 0);
      if (p.sl) ChartMgr.addPriceLine(p.sl, '#ef5350', 'SL', 2);
      if (p.tp) ChartMgr.addPriceLine(p.tp, '#26a69a', 'TP', 2);
    }
  }

  function gotoDate(dateStr) {
    const t = Date.UTC(...dateStr.split('-').map((x, i) => i === 1 ? +x - 1 : +x)) / 1000;
    if (active) { pause(); idx = Math.max(1, all.findIndex(c => c.time >= t)); resetBroker(); markers = []; render(); updateTimeLabel(); }
    else start(t);
  }

  return {
    start, exit, stepForward, stepBack, play, pause, isActive,
    manualOrder, closeAllManual, gotoDate,
    get broker() { return broker; },
    get currentBar() { return all[idx]; },
  };
})();

window.Replay = Replay;
