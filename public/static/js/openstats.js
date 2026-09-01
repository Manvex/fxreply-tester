// ===========================================================================
// What has happened at the open, measured rather than guessed.
//
// This does not predict anything. It answers a narrower and far more useful
// question: on the days that looked like today looks now, what did the market
// actually go on to do?
//
// For each past session it records the gap from the previous cash close to the
// open, how far the overnight session ranged, and then what the first hour did
// — whether the gap filled, whether the open direction held, and how far price
// travelled either way. Today's setup is matched against the days that
// resembled it and the outcomes are reported as base rates.
//
// The honest limits, stated because they decide how much weight this deserves:
//   * the sample is one instrument over a few months, so a rate built on ten
//     matches is a curiosity, not a statistic. The count is always shown.
//   * a base rate is not an edge. It tells you what usually happened, not what
//     is about to.
//   * gaps cluster around events. A run of similar gaps may all be the same
//     news repeated, which makes them far less independent than they look.
// ===========================================================================

const OpenStats = (() => {

  // US cash hours in UTC. The index CFD trades around them, but these are the
  // minutes that set the day.
  const OPEN_MIN = 13 * 60 + 30;
  const CLOSE_MIN = 20 * 60;

  let cache = { sym: null, at: 0, sessions: [], candles: null, error: null };
  let loading = false;

  const minOf = (sec) => {
    const d = new Date(sec * 1000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  };
  const dayOf = (sec) => Math.floor(sec / 86400) * 86400;

  /**
   * Did this day actually hold a cash session?
   *
   * The index CFD trades around the clock on weekdays and reopens on Sunday
   * evening, so "the last bar before 20:00 UTC" finds a price on a Sunday and
   * calls it a close. It is not one — there was no cash session that day, and
   * measuring a gap against it compares Monday's open to Sunday's thin
   * overnight tape. A day only counts when it traded through the cash hours.
   */
  function hadCashSession(bars) {
    if (!bars || !bars.length) return false;
    const dow = new Date(bars[0].time * 1000).getUTCDay();
    if (dow === 0 || dow === 6) return false;
    let inCash = 0;
    for (const c of bars) {
      const m = minOf(c.time);
      if (m >= OPEN_MIN && m <= CLOSE_MIN) inCash++;
    }
    // A real session leaves hours of bars, not a handful.
    return inCash >= 12;
  }

  /**
   * Split a candle series into sessions and measure each one.
   *
   * A session is the previous cash close through to this day's close, so the
   * overnight move and the gap belong to the same record as the outcome they
   * preceded.
   */
  function build(candles) {
    const byDay = new Map();
    for (const c of candles) {
      const d = dayOf(c.time);
      let arr = byDay.get(d);
      if (!arr) { arr = []; byDay.set(d, arr); }
      arr.push(c);
    }

    const days = [...byDay.keys()].sort((a, b) => a - b);
    const out = [];

    for (let i = 1; i < days.length; i++) {
      const today = byDay.get(days[i]);
      if (!today || !hadCashSession(today)) continue;

      // Walk back to the most recent day that genuinely traded the cash
      // session — over a weekend that is Friday, not Sunday.
      let pi = i - 1;
      while (pi >= 0 && !hadCashSession(byDay.get(days[pi]))) pi--;
      if (pi < 0) continue;
      const prev = byDay.get(days[pi]);

      let prevClose = null;
      for (const c of prev) if (minOf(c.time) <= CLOSE_MIN) prevClose = c;
      if (!prevClose) continue;

      // Overnight is everything between that close and this open, including
      // any weekend reopen in between.
      const overnight = [];
      for (let k = pi; k <= i; k++) {
        for (const c of byDay.get(days[k])) {
          if (c.time <= prevClose.time) continue;
          if (dayOf(c.time) === days[i] && minOf(c.time) >= OPEN_MIN) continue;
          overnight.push(c);
        }
      }

      const openBar = today.find(c => minOf(c.time) >= OPEN_MIN);
      if (!openBar) continue;

      const gapPct = ((openBar.open - prevClose.close) / prevClose.close) * 100;

      let onHigh = -Infinity, onLow = Infinity;
      for (const c of overnight) { onHigh = Math.max(onHigh, c.high); onLow = Math.min(onLow, c.low); }
      const onRangePct = (isFinite(onHigh) && isFinite(onLow) && prevClose.close)
        ? ((onHigh - onLow) / prevClose.close) * 100 : null;

      // The first hour after the open, and the rest of the cash session.
      const openT = openBar.time;
      const hour = today.filter(c => c.time >= openT && c.time < openT + 3600);
      const session = today.filter(c => c.time >= openT && minOf(c.time) <= CLOSE_MIN);
      if (!hour.length || !session.length) continue;

      let hHigh = -Infinity, hLow = Infinity;
      for (const c of hour) { hHigh = Math.max(hHigh, c.high); hLow = Math.min(hLow, c.low); }
      const hourClose = hour[hour.length - 1].close;

      // Did price trade back to the previous close at any point in the session?
      let filled = false;
      const up = gapPct > 0;
      for (const c of session) {
        if (up ? c.low <= prevClose.close : c.high >= prevClose.close) { filled = true; break; }
      }

      const dirHeld = Math.sign(hourClose - openBar.open) === Math.sign(gapPct) && gapPct !== 0;

      out.push({
        day: days[i],
        prevClose: prevClose.close,
        open: openBar.open,
        gapPct,
        onRangePct,
        hourMovePct: ((hourClose - openBar.open) / openBar.open) * 100,
        hourUpPct: ((hHigh - openBar.open) / openBar.open) * 100,
        hourDownPct: ((hLow - openBar.open) / openBar.open) * 100,
        sessionClosePct: ((session[session.length - 1].close - openBar.open) / openBar.open) * 100,
        filled, dirHeld,
      });
    }
    return out;
  }

  /**
   * Pull enough history to have something to compare against.
   *
   * Five-minute bars are the coarsest granularity that still resolves a 13:30
   * open, and below an hour the archive is published one file per day — so a
   * month of history is a month of requests. Thirty days is the smallest window
   * that still yields a usable number of comparable sessions, and progress is
   * reported because on a slow feed this takes a while and a frozen panel is
   * indistinguishable from a broken one.
   */
  let loadingSym = null;
  let progress = 0;

  async function load(sym, days = 30) {
    if (loading && loadingSym === sym) return cache;
    if (cache.sym === sym && !cache.error && Date.now() - cache.at < 15 * 60 * 1000) return cache;

    loading = true;
    loadingSym = sym;
    progress = 0;
    try {
      const to = Math.floor(Date.now() / 1000);
      const from = to - days * 86400;
      const candles = await DataStore.load(sym, '5m', from, to, (f) => {
        // A later request for a different instrument supersedes this one.
        if (loadingSym === sym) progress = f;
      });
      if (loadingSym !== sym) return cache;          // superseded while in flight
      if (!candles || candles.length < 200) {
        cache = { sym, at: Date.now(), sessions: [], candles: null,
                  error: 'the archive returned too little history' };
      } else {
        const sessions = build(candles);
        cache = {
          sym, at: Date.now(), sessions, candles,
          error: sessions.length ? null : 'no complete sessions in the history that came back',
        };
      }
    } catch (e) {
      cache = { sym, at: Date.now(), sessions: [], candles: null, error: e.message || 'history unavailable' };
    } finally {
      if (loadingSym === sym) { loading = false; progress = 1; }
    }
    return cache;
  }

  /**
   * Where today stands right now: the gap so far, and the overnight range.
   * Before the open this is the setup; after it, it is what happened.
   */
  function today(candles) {
    if (!candles || candles.length < 10) return null;
    const now = Math.floor(Date.now() / 1000);
    const d = dayOf(now);

    const byDay = new Map();
    for (const c of candles) {
      const k = dayOf(c.time);
      let arr = byDay.get(k);
      if (!arr) { arr = []; byDay.set(k, arr); }
      arr.push(c);
    }
    const days = [...byDay.keys()].sort((a, b) => a - b);

    // The most recent day before today that actually traded the cash session.
    let prevClose = null;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i] >= d) continue;
      if (!hadCashSession(byDay.get(days[i]))) continue;
      for (const c of byDay.get(days[i])) if (minOf(c.time) <= CLOSE_MIN) prevClose = c;
      break;
    }
    if (!prevClose) return null;

    const overnight = candles.filter(c =>
      c.time > prevClose.time && !(dayOf(c.time) === d && minOf(c.time) >= OPEN_MIN));
    let onHigh = -Infinity, onLow = Infinity;
    for (const c of overnight) { onHigh = Math.max(onHigh, c.high); onLow = Math.min(onLow, c.low); }

    const last = candles[candles.length - 1];
    const openBar = candles.find(c => c.time >= d && minOf(c.time) >= OPEN_MIN);
    // The archive publishes after the fact, so today's bars may simply not be
    // there yet. Saying so beats quoting a gap against a stale last price.
    const staleMin = Math.round((now - last.time) / 60);

    return {
      prevClose: prevClose.close,
      last: last.close,
      opened: !!openBar,
      open: openBar ? openBar.open : null,
      // Before the open this is where the gap currently sits, not where it will land.
      gapPct: ((openBar ? openBar.open : last.close) - prevClose.close) / prevClose.close * 100,
      onRangePct: (isFinite(onHigh) && isFinite(onLow))
        ? ((onHigh - onLow) / prevClose.close) * 100 : null,
      onHigh: isFinite(onHigh) ? onHigh : null,
      onLow: isFinite(onLow) ? onLow : null,
      minsToOpen: Sessions.toUsOpen(),
      staleMin,
      stale: staleMin > 45,
      lastAt: last.time,
    };
  }

  /**
   * Base rates from the sessions that resembled this one.
   *
   * Matching is on gap direction and size band, and on overnight range when
   * there is enough history to afford the extra filter. The band widens until
   * there are enough matches to be worth reporting at all.
   */
  function compare(sessions, t) {
    if (!sessions.length || !t) return null;
    const dir = Math.sign(t.gapPct);
    const mag = Math.abs(t.gapPct);

    let band = Math.max(0.08, mag * 0.5), matches = [];
    for (let i = 0; i < 5; i++) {
      matches = sessions.filter(s =>
        Math.sign(s.gapPct) === dir && Math.abs(Math.abs(s.gapPct) - mag) <= band);
      if (matches.length >= 8) break;
      band *= 1.6;
    }
    if (matches.length < 4) {
      return { n: matches.length, tooFew: true, band };
    }

    const filled = matches.filter(m => m.filled).length;
    const held = matches.filter(m => m.dirHeld).length;
    const hourMoves = matches.map(m => m.hourMovePct).sort((a, b) => a - b);
    const median = hourMoves[Math.floor(hourMoves.length / 2)];
    const avgUp = matches.reduce((a, m) => a + m.hourUpPct, 0) / matches.length;
    const avgDown = matches.reduce((a, m) => a + m.hourDownPct, 0) / matches.length;
    const closedWith = matches.filter(m => Math.sign(m.sessionClosePct) === dir).length;

    return {
      n: matches.length, band, tooFew: false,
      filledPct: filled / matches.length * 100,
      heldPct: held / matches.length * 100,
      closedWithPct: closedWith / matches.length * 100,
      medianHourPct: median,
      avgUpPct: avgUp, avgDownPct: avgDown,
      sample: matches.slice(-6).reverse(),
    };
  }

  function summary(sym, candles) {
    // The chart is shared, and a failed load leaves the previous instrument's
    // candles in place. Reading those would put one market's prices under
    // another market's name, which is worse than showing nothing at all.
    const onChart = window.ChartMgr && ChartMgr.symInfo && ChartMgr.symInfo.sym;
    if (onChart && onChart !== sym) {
      return { today: null, sessions: 0, stats: null, loading,
               error: null, mismatch: onChart };
    }
    const t = today(candles);
    const c = cache.sym === sym ? cache : null;
    return {
      today: t,
      sessions: c ? c.sessions.length : 0,
      error: c ? c.error : null,
      stats: (c && t) ? compare(c.sessions, t) : null,
      loading, progress,
    };
  }

  return { load, today, compare, summary, build, OPEN_MIN, CLOSE_MIN,
    get cache() { return cache; }, get progress() { return progress; },
    get loading() { return loading; } };
})();

window.OpenStats = OpenStats;
