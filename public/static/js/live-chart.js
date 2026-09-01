// ===========================================================================
// Live crypto chart.
//
// Binance publishes a kline stream per symbol and interval that pushes the
// forming candle on every trade. We feed it straight into ChartMgr.appendBar,
// which already knows how to update the newest bar and its indicators in place.
//
// Only crypto has a live feed here: Dukascopy's archive is published after the
// fact, so forex, indices and share CFDs stay historical and the badge says so.
//
// Streaming is suspended during a replay session. Replay owns the candle array
// and walks it deliberately; pushing live bars into it would corrupt the very
// thing the session exists to control.
// ===========================================================================

const LiveChart = (() => {
  const $ = (s) => document.querySelector(s);

  let ws = null;
  let want = true;              // user preference, persisted
  let sym = null, tf = null;
  let retries = 0;
  let timer = null;
  let lastTick = 0;
  let statusEl = null;

  const LS_KEY = 'bt_live_chart';

  try { want = localStorage.getItem(LS_KEY) !== 'off'; } catch (_e) {}

  // Where the symbol and timeframe come from. The terminal reads them off App;
  // the dashboard's Live Crypto page owns its own pair and interval, so it
  // supplies its own accessors instead of the module reaching for globals.
  let src = {
    symbol: () => (window.App ? App.currentSymbol : null),
    tf: () => (window.App ? App.currentTF : null),
    blocked: () => !!(window.Replay && Replay.isActive()),
  };

  function configure(next) { src = { ...src, ...next }; refresh(); }

  function eligible() {
    if (!window.ChartMgr) return false;
    if (src.blocked()) return false;
    const s = src.symbol();
    const info = s && window.findSymbol ? findSymbol(s) : null;
    return !!info && info.source === 'binance';
  }

  function setBadge(state, text) {
    if (!statusEl) return;
    statusEl.className = 'live-badge ' + state;
    statusEl.innerHTML = state === 'off'
      ? `<span class="live-dot"></span>${text}`
      : `<span class="live-dot"></span>${text}`;
    statusEl.classList.toggle('hidden', state === 'na');
  }

  function stop(quiet) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (ws) { ws.onclose = null; try { ws.close(); } catch (_e) {} ws = null; }
    if (!quiet) setBadge('off', 'Live off');
  }

  function connect() {
    stop(true);
    if (!want || !eligible()) {
      setBadge(eligible() ? 'off' : 'na', 'Live off');
      return;
    }
    sym = src.symbol();
    tf = src.tf();
    const stream = `${sym.toLowerCase()}@kline_${tf}`;
    setBadge('wait', 'Connecting');

    try {
      ws = new WebSocket('wss://stream.binance.com:9443/ws/' + stream);
    } catch (e) {
      setBadge('err', 'Live failed');
      return retry();
    }

    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (_e) { return; }
      const k = m.k;
      if (!k) return;

      // A late frame for a symbol or timeframe the user has already left must
      // not be painted onto the chart they are now looking at.
      if (sym !== src.symbol() || tf !== src.tf()) return;
      if (src.blocked()) return;

      retries = 0;
      lastTick = Date.now();
      ChartMgr.appendBar({
        time: k.t / 1000,
        open: +k.o, high: +k.h, low: +k.l, close: +k.c,
        volume: +k.v,
      }, { indicators: true, follow: true });
      setBadge('on', 'Live');
    };

    ws.onerror = () => { /* onclose drives recovery */ };
    ws.onclose = () => { ws = null; setBadge('err', 'Reconnecting'); retry(); };
  }

  function retry() {
    if (!want) return;
    if (retries > 6) { setBadge('err', 'Live lost'); return; }
    timer = setTimeout(connect, Math.min(10000, 700 * 2 ** retries++));
  }

  function toggle() {
    want = !want;
    try { localStorage.setItem(LS_KEY, want ? 'on' : 'off'); } catch (_e) {}
    retries = 0;
    if (want) connect(); else stop();
  }

  /** Re-evaluate after a symbol, timeframe or session change. */
  function refresh() {
    retries = 0;
    if (want && eligible()) connect();
    else { stop(true); setBadge(eligible() ? 'off' : 'na', 'Live off'); }
  }

  function init(hostSel) {
    const host = $(hostSel || '#chart-wrap');
    if (!host || $('#live-badge')) return;
    statusEl = document.createElement('button');
    statusEl.id = 'live-badge';
    statusEl.className = 'live-badge na';
    statusEl.setAttribute('data-tip', 'Stream the forming candle from Binance');
    statusEl.addEventListener('click', toggle);
    host.appendChild(statusEl);
    refresh();

    // Deliberately not suspended on tab-hide. Dropping the socket saves almost
    // nothing — one kline frame a second — and costs correctness: any candle
    // that completed while we were away would be missing from the series, and
    // the stream alone cannot backfill it. Keeping it open keeps the chart true.
    window.addEventListener('beforeunload', () => stop(true));
  }

  return { init, configure, refresh, toggle, stop, get streaming() { return !!ws; } };
})();

window.LiveChart = LiveChart;
