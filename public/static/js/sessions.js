// ===========================================================================
// Trading sessions, drawn on the chart in your own clock.
//
// An index has a real open and a real close, and almost everything that
// matters to it happens inside a few known windows. Crypto has no close, but
// it still trades to the same rhythm because the people trading it are at the
// same desks.
//
// Times are held in UTC — the only clock the data is in — and rendered in the
// viewer's local zone, so the label says the hour you would actually look at
// on your own screen. Daylight saving is handled by the browser rather than by
// arithmetic here, which is the only way to get it right in both hemispheres.
// ===========================================================================

const Sessions = (() => {

  // Windows in UTC minutes from midnight. The US cash open is the one that
  // matters most for an index; the rest frame it.
  const DEFS = [
    { id: 'asia',    label: 'Asia',        from: 0,          to: 8 * 60,          color: '#7d8cf5' },
    { id: 'london',  label: 'London',      from: 7 * 60,     to: 16 * 60,         color: '#4dd4c0' },
    { id: 'overlap', label: 'LDN + NY',    from: 13 * 60 + 30, to: 16 * 60,       color: '#f0b45e' },
    { id: 'us',      label: 'US cash',     from: 13 * 60 + 30, to: 20 * 60,       color: '#26d0a5' },
    { id: 'power',   label: 'Power hour',  from: 19 * 60,    to: 20 * 60,         color: '#f2615c' },
  ];

  let enabled = new Set(['london', 'us', 'power']);
  try {
    const saved = JSON.parse(localStorage.getItem('bt_sessions') || 'null');
    if (Array.isArray(saved)) enabled = new Set(saved);
  } catch (_e) {}

  function save() {
    try { localStorage.setItem('bt_sessions', JSON.stringify([...enabled])); } catch (_e) {}
  }
  function toggle(id) {
    if (enabled.has(id)) enabled.delete(id); else enabled.add(id);
    save();
  }
  const isOn = (id) => enabled.has(id);

  /** The viewer's offset from UTC, in minutes, right now. */
  function localOffsetMin() { return -new Date().getTimezoneOffset(); }

  function fmtLocal(utcMinutes) {
    const m = ((utcMinutes + localOffsetMin()) % 1440 + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  function fmtUtc(utcMinutes) {
    return String(Math.floor(utcMinutes / 60)).padStart(2, '0') + ':' +
           String(utcMinutes % 60).padStart(2, '0');
  }

  function zoneName() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'; }
    catch (_e) { return 'local'; }
  }

  /** Session windows overlapping a given day, as UTC second ranges. */
  function windowsFor(dayStartSec) {
    const out = [];
    for (const d of DEFS) {
      if (!enabled.has(d.id)) continue;
      out.push({
        ...d,
        from: dayStartSec + d.from * 60,
        to: dayStartSec + d.to * 60,
      });
    }
    return out;
  }

  /** Which sessions are open right now. */
  function active() {
    const now = new Date();
    const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
    return DEFS.filter(d => mins >= d.from && mins < d.to);
  }

  /** Minutes until the US cash open, negative once it has opened. */
  function toUsOpen() {
    const now = new Date();
    const mins = now.getUTCHours() * 60 + now.getUTCMinutes() + now.getUTCSeconds() / 60;
    const open = 13 * 60 + 30;
    let diff = open - mins;
    // Weekends roll to Monday; the index does not open on a Saturday.
    const dow = now.getUTCDay();
    if (dow === 6) diff += 2 * 1440;
    else if (dow === 0) diff += 1440;
    else if (diff < -6.5 * 60) diff += 1440;   // past the close, aim at tomorrow
    return diff;
  }

  // ---- chart band --------------------------------------------------------
  let canvas = null, ctx = null, wrap = null, timer = null, mounted = false;

  function ensure(hostSel) {
    wrap = document.querySelector(hostSel || '#lcp-chart-wrap') || document.querySelector('#chart-wrap');
    if (!wrap) return false;
    canvas = wrap.querySelector('#session-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'session-canvas';
      // Under the price, above the heatmap slot: sessions are background.
      canvas.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none';
      wrap.insertBefore(canvas, wrap.firstChild);
    }
    ctx = canvas.getContext('2d');
    return true;
  }

  function paint() {
    if (!mounted || !ctx || !window.ChartMgr || !ChartMgr.chart) return;
    const r = wrap.getBoundingClientRect();
    const W = Math.round(r.width), H = Math.round(r.height);
    if (canvas.width !== W * devicePixelRatio || canvas.height !== H * devicePixelRatio) {
      canvas.width = W * devicePixelRatio; canvas.height = H * devicePixelRatio;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
    ctx.clearRect(0, 0, W, H);

    const cs = ChartMgr.candles;
    if (!cs || cs.length < 2) return;

    // Only worth drawing when a day is a meaningful fraction of the view; on a
    // daily or weekly chart the bands would cover everything and say nothing.
    const first = cs[0].time, last = cs[cs.length - 1].time;
    const spanDays = (last - first) / 86400;
    if (spanDays > 30 || spanDays < 0.05) return;

    const xLast = ChartMgr.timeToX(last);
    const xPrev = ChartMgr.timeToX(cs[cs.length - 2].time);
    if (xLast == null || xPrev == null) return;
    const perSec = (xLast - xPrev) / (last - cs[cs.length - 2].time);
    if (!perSec) return;
    const xAt = (t) => xLast + (t - last) * perSec;

    const dayFrom = Math.floor(first / 86400) * 86400;
    const dayTo = Math.floor(last / 86400) * 86400;

    ctx.save();
    for (let day = dayFrom; day <= dayTo + 86400; day += 86400) {
      for (const w of windowsFor(day)) {
        const x0 = xAt(w.from), x1 = xAt(w.to);
        if (x1 < 0 || x0 > W) continue;
        const a = Math.max(0, x0), b = Math.min(W, x1);
        ctx.fillStyle = w.color;
        ctx.globalAlpha = 0.055;
        ctx.fillRect(a, 0, b - a, H);
        // A firm edge on the open is the line people actually watch.
        ctx.globalAlpha = 0.4;
        ctx.fillRect(a, 0, 1, H);
        ctx.globalAlpha = 1;

        if (b - a > 54) {
          ctx.font = '9px Inter, sans-serif';
          ctx.fillStyle = w.color;
          ctx.globalAlpha = 0.75;
          ctx.textBaseline = 'top';
          ctx.fillText(w.label, a + 4, 4);
          ctx.globalAlpha = 1;
        }
      }
    }
    ctx.restore();
  }

  function mount(hostSel) {
    if (!ensure(hostSel)) return;
    mounted = true;
    if (!timer) timer = setInterval(paint, 400);
    paint();
  }

  function unmount() {
    mounted = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  }

  return {
    DEFS, toggle, isOn, mount, unmount, paint,
    fmtLocal, fmtUtc, zoneName, localOffsetMin, active, toUsOpen, windowsFor,
    get enabled() { return [...enabled]; },
  };
})();

window.Sessions = Sessions;
