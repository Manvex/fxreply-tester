// ===========================================================================
// News store — real economic-calendar releases from ForexFactory, via the
// /api/news proxy. Fetched per calendar month and cached in memory.
//
// Everything here is real: past events carry the actual released figure,
// upcoming events carry only the forecast. Nothing is generated.
// ===========================================================================
const NewsStore = (() => {
  const cache = new Map();      // 'may.2024' -> events[]
  const inflight = new Map();
  const MN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // Which currencies matter for a given instrument. Drives the default filter
  // so a EURUSD backtest doesn't get buried under NZD releases.
  function currenciesFor(symInfo) {
    const s = symInfo.sym;
    if (symInfo.cat === 'forex') {
      const a = s.slice(0, 3), b = s.slice(3, 6);
      return [a, b];
    }
    if (symInfo.cat === 'crypto') return ['USD'];
    if (symInfo.cat === 'stocks') return ['USD'];
    if (symInfo.cat === 'commodities') return ['USD'];
    const IDX_CUR = {
      SPX500: ['USD'], NAS100: ['USD'], US30: ['USD'], US2000: ['USD'],
      GER40: ['EUR'], FRA40: ['EUR'], ESP35: ['EUR'], EU50: ['EUR'],
      UK100: ['GBP'], JPN225: ['JPY'], AUS200: ['AUD'], HK50: ['CNY', 'USD'], SWI20: ['CHF'],
    };
    return IDX_CUR[s] || ['USD'];
  }

  function monthKey(sec) {
    const d = new Date(sec * 1000);
    return `${MN[d.getUTCMonth()]}.${d.getUTCFullYear()}`;
  }

  function monthsBetween(fromSec, toSec) {
    const out = [];
    const d = new Date(fromSec * 1000);
    d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
    const end = new Date(toSec * 1000);
    while (d.getTime() / 1000 <= toSec && out.length < 120) {
      out.push(`${MN[d.getUTCMonth()]}.${d.getUTCFullYear()}`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      if (d.getUTCFullYear() > end.getUTCFullYear() + 1) break;
    }
    return out;
  }

  async function fetchMonth(key) {
    if (cache.has(key)) return cache.get(key);
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        const r = await fetch(`/api/news?month=${key}`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const ev = Array.isArray(j.events) ? j.events : [];
        cache.set(key, ev);
        return ev;
      } catch (e) {
        console.warn('[news] month failed', key, e.message);
        cache.set(key, []);            // negative-cache so we don't hammer it
        return [];
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  // Load every event overlapping [fromSec, toSec]. Months load in parallel but
  // capped, so a 5-year backtest doesn't open 60 sockets at once.
  async function load(fromSec, toSec, onProgress) {
    const keys = monthsBetween(fromSec, toSec);
    const all = [];
    const BATCH = 4;
    for (let i = 0; i < keys.length; i += BATCH) {
      const slice = keys.slice(i, i + BATCH);
      const res = await Promise.all(slice.map(fetchMonth));
      res.forEach(ev => all.push(...ev));
      if (onProgress) onProgress(Math.min(1, (i + BATCH) / keys.length));
    }
    const out = all.filter(e => e.t >= fromSec && e.t <= toSec);
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  // Upcoming events from now forward — for the "what's next" panel.
  async function upcoming(limitDays = 14) {
    const now = Math.floor(Date.now() / 1000);
    const ev = await load(now - 86400, now + limitDays * 86400);
    return ev.filter(e => e.t >= now);
  }

  // Most recent already-released events.
  async function recent(limitDays = 7) {
    const now = Math.floor(Date.now() / 1000);
    const ev = await load(now - limitDays * 86400, now);
    return ev.filter(e => e.t < now).reverse();
  }

  function filter(events, opts = {}) {
    const { currencies = null, impacts = ['high', 'medium'] } = opts;
    return events.filter(e => {
      if (impacts && !impacts.includes(e.impact)) return false;
      if (currencies && currencies.length && !currencies.includes(e.cur)) return false;
      return true;
    });
  }

  // Snap events onto candle times so they can be drawn as chart markers.
  // An event lands on the bar whose window contains it.
  function toMarkers(events, candles, tfSec) {
    if (!candles.length) return [];
    const first = candles[0].time, last = candles[candles.length - 1].time + tfSec;
    const byBar = new Map();
    for (const e of events) {
      if (e.t < first || e.t > last) continue;
      const barTime = candles[0].time + Math.floor((e.t - first) / tfSec) * tfSec;
      if (!byBar.has(barTime)) byBar.set(barTime, []);
      byBar.get(barTime).push(e);
    }
    const COLOR = { high: '#f2615c', medium: '#f0a132', low: '#6c7683', holiday: '#8b7cf0' };
    const out = [];
    for (const [barTime, list] of byBar) {
      const top = list.reduce((a, b) =>
        (['low', 'holiday', 'medium', 'high'].indexOf(b.impact) > ['low', 'holiday', 'medium', 'high'].indexOf(a.impact) ? b : a));
      out.push({
        time: barTime,
        position: 'aboveBar',
        color: COLOR[top.impact] || '#6c7683',
        shape: 'circle',
        text: list.length > 1 ? `${top.cur} ${list.length}` : `${top.cur}`,
        _events: list,
      });
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  }

  return {
    load, upcoming, recent, filter, toMarkers,
    currenciesFor, monthKey,
    clear: () => cache.clear(),
    cached: () => cache.size,
  };
})();

window.NewsStore = NewsStore;
