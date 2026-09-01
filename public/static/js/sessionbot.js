// ===========================================================================
// Session-open forecast.
//
// At every session open — and the New York open above all — liquidity arrives
// and the tape changes character. This measures that rather than assuming it,
// then says what usually followed the setups that looked like this one.
//
// Three rules govern everything below, because they are what separate a useful
// number from a confident-sounding one:
//
//   1. Every probability carries its sample size and a confidence interval.
//      A 70% built on seven sessions has an interval running from roughly 36%
//      to 90% — which is to say it is not 70%, it is "no idea". The interval is
//      always shown so that is obvious at a glance.
//
//   2. Conditions are dropped, not faked. The forecast starts by matching on
//      gap, overnight range, prior close strength and weekday together. When
//      that leaves too few sessions it drops the weakest condition and tries
//      again, and it reports which conditions actually survived.
//
//   3. News is a widener, not a predictor. There is nowhere near enough history
//      to condition on "CPI at 13:30" — the sample would be two. So a release
//      in the open window is flagged as a reason to trust the numbers less,
//      never folded in as though it had been measured.
// ===========================================================================

const SessionBot = (() => {

  // Session opens in UTC minutes. The 13:30 cash open is the one that matters.
  const OPENS = [
    { id: 'asia',   label: 'Asia',      min: 0 },
    { id: 'london', label: 'London',    min: 7 * 60 },
    { id: 'ny',     label: 'New York',  min: 13 * 60 + 30 },
  ];

  const minOf = (sec) => {
    const d = new Date(sec * 1000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  };
  const dayOf = (sec) => Math.floor(sec / 86400) * 86400;

  // ---- how violent is each open, really? --------------------------------
  /**
   * Measure the range in the window after each session open against the day's
   * own typical range, so the answer is in multiples rather than points and
   * comparable across instruments and price levels.
   */
  function volatilityProfile(candles, windowMin = 30) {
    if (!candles || candles.length < 500) return null;

    const perDay = new Map();
    for (const c of candles) {
      const d = dayOf(c.time);
      let arr = perDay.get(d);
      if (!arr) { arr = []; perDay.set(d, arr); }
      arr.push(c);
    }

    // Baseline: the typical range of any equal-length window in the same day.
    const results = OPENS.map(o => ({ ...o, ratios: [] }));
    let baselineSamples = [];

    for (const [, bars] of perDay) {
      if (bars.length < 100) continue;
      const step = Math.max(1, Math.round(windowMin / ((bars[1].time - bars[0].time) / 60)));

      // All windows in the day, for the baseline.
      const dayWindows = [];
      for (let i = 0; i + step <= bars.length; i += step) {
        let hi = -Infinity, lo = Infinity;
        for (let k = i; k < i + step; k++) { hi = Math.max(hi, bars[k].high); lo = Math.min(lo, bars[k].low); }
        if (isFinite(hi) && isFinite(lo) && bars[i].close) {
          dayWindows.push({ at: minOf(bars[i].time), range: (hi - lo) / bars[i].close });
        }
      }
      if (dayWindows.length < 8) continue;
      const median = [...dayWindows.map(w => w.range)].sort((a, b) => a - b)[Math.floor(dayWindows.length / 2)];
      if (!(median > 0)) continue;
      baselineSamples.push(median);

      for (const r of results) {
        // The window that starts at, or just after, the open.
        const w = dayWindows.find(x => x.at >= r.min && x.at < r.min + windowMin);
        if (w) r.ratios.push(w.range / median);
      }
    }

    const summarise = (arr) => {
      if (!arr.length) return null;
      const s = [...arr].sort((a, b) => a - b);
      return {
        n: arr.length,
        median: s[Math.floor(s.length / 2)],
        mean: arr.reduce((a, b) => a + b, 0) / arr.length,
        p90: s[Math.floor(s.length * 0.9)],
      };
    };

    return {
      windowMin,
      opens: results.map(r => ({ id: r.id, label: r.label, min: r.min, stats: summarise(r.ratios) })),
      days: baselineSamples.length,
    };
  }

  // ---- probability with its uncertainty ---------------------------------
  /**
   * Wilson score interval.
   *
   * The naive k/n says 100% when three out of three worked, which is exactly
   * the kind of number that gets someone hurt. Wilson pulls small samples
   * toward the middle and gives an honest width.
   */
  function wilson(k, n, z = 1.96) {
    if (!n) return null;
    const p = k / n;
    const d = 1 + (z * z) / n;
    const centre = (p + (z * z) / (2 * n)) / d;
    const half = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    return {
      p: p * 100,
      lo: Math.max(0, (centre - half)) * 100,
      hi: Math.min(1, (centre + half)) * 100,
      n, k,
      // The width is the honest headline when the sample is small.
      width: (Math.min(1, centre + half) - Math.max(0, centre - half)) * 100,
    };
  }

  // ---- conditioning ------------------------------------------------------
  /**
   * Filters in order of how much they are worth keeping. The first is the one
   * we least want to lose, so it is dropped last.
   */
  function conditions(t) {
    const dir = Math.sign(t.gapPct);
    const mag = Math.abs(t.gapPct);
    const dow = new Date().getUTCDay();

    return [
      { id: 'dir', label: 'same gap direction',
        test: s => Math.sign(s.gapPct) === dir },
      { id: 'size', label: 'similar gap size',
        test: s => Math.abs(Math.abs(s.gapPct) - mag) <= Math.max(0.1, mag * 0.7) },
      { id: 'range', label: 'similar overnight range',
        test: s => t.onRangePct != null && s.onRangePct != null &&
          Math.abs(s.onRangePct - t.onRangePct) <= Math.max(0.15, t.onRangePct * 0.6) },
      { id: 'dow', label: 'same weekday',
        test: s => new Date(s.day * 1000).getUTCDay() === dow },
    ];
  }

  const MIN_N = 6;

  function match(sessions, t) {
    const conds = conditions(t);
    // Start with everything and shed the least valuable until enough remain.
    for (let drop = 0; drop <= conds.length - 1; drop++) {
      const use = conds.slice(0, conds.length - drop);
      const set = sessions.filter(s => use.every(c => c.test(s)));
      if (set.length >= MIN_N || drop === conds.length - 1) {
        return { set, used: use.map(c => c.label), dropped: conds.slice(conds.length - drop).map(c => c.label) };
      }
    }
    return { set: [], used: [], dropped: [] };
  }

  // ---- the forecast ------------------------------------------------------
  /**
   * What usually followed sessions that looked like this one, with the news
   * that is about to land noted alongside.
   */
  function forecast(sessions, t, symbol) {
    if (!sessions || !sessions.length || !t) return null;

    const m = match(sessions, t);
    if (m.set.length < 3) {
      return { enough: false, n: m.set.length, used: m.used, dropped: m.dropped };
    }

    const dir = Math.sign(t.gapPct) || 1;
    const n = m.set.length;

    const outcomes = {
      fill: wilson(m.set.filter(s => s.filled).length, n),
      hold: wilson(m.set.filter(s => s.dirHeld).length, n),
      close: wilson(m.set.filter(s => Math.sign(s.sessionClosePct) === dir).length, n),
      // Did the first hour reach a meaningful distance either way?
      expand: wilson(m.set.filter(s => Math.max(s.hourUpPct, -s.hourDownPct) > 0.35).length, n),
    };

    // Distribution of the first hour, which is what a stop has to survive.
    const ups = m.set.map(s => s.hourUpPct).sort((a, b) => a - b);
    const downs = m.set.map(s => s.hourDownPct).sort((a, b) => a - b);
    const moves = m.set.map(s => s.hourMovePct).sort((a, b) => a - b);
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];

    const news = newsInWindow(symbol);

    return {
      enough: true, n, used: m.used, dropped: m.dropped,
      dir,
      outcomes,
      hour: {
        medianMove: q(moves, 0.5),
        medianUp: q(ups, 0.5), medianDown: q(downs, 0.5),
        p80Up: q(ups, 0.8), p80Down: q(downs, 0.2),
      },
      news,
      // The single number the user asked for, with the honesty attached.
      headline: headlineOf(outcomes, dir, news),
    };
  }

  /**
   * The clearest thing the sample supports, or nothing.
   *
   * A claim is only made when the interval sits meaningfully away from a coin
   * toss. Otherwise the honest output is that there is no read.
   */
  function headlineOf(o, dir, news) {
    const cands = [
      { key: 'close', w: o.close, up: `close the session ${dir > 0 ? 'higher' : 'lower'} than it opened`,
        down: `close the session ${dir > 0 ? 'lower' : 'higher'} than it opened` },
      { key: 'fill', w: o.fill, up: 'trade back through yesterday’s close', down: 'leave the gap unfilled' },
      { key: 'hold', w: o.hold, up: `hold the ${dir > 0 ? 'upward' : 'downward'} gap through the first hour`,
        down: `give the ${dir > 0 ? 'upward' : 'downward'} gap back inside the first hour` },
      // Magnitude, not direction. Often the only thing a small sample can say
      // with any confidence — and the one a stop distance actually needs.
      { key: 'expand', w: o.expand, up: 'range more than 0.35% inside the first hour',
        down: 'stay inside 0.35% for the first hour' },
    ];

    let best = null;
    for (const c of cands) {
      if (!c.w) continue;
      // Only when the whole interval is on one side of even.
      if (c.w.lo > 55) {
        const edge = c.w.lo - 50;
        if (!best || edge > best.edge) best = { edge, text: c.up, w: c.w, key: c.key };
      } else if (c.w.hi < 45) {
        const edge = 50 - c.w.hi;
        if (!best || edge > best.edge) best = { edge, text: c.down, w: { ...c.w, p: 100 - c.w.p, lo: 100 - c.w.hi, hi: 100 - c.w.lo }, key: c.key };
      }
    }

    if (!best) {
      return { has: false,
        text: 'Nothing in the sample separates from a coin toss once the interval is taken into account.' };
    }
    const directional = best.key !== 'expand';
    return {
      has: true, key: best.key, w: best.w, directional,
      text: `Sessions like this one tended to ${best.text}.` +
        (directional ? '' : ' That is a statement about size, not direction — it says how much room a stop needs, not which way to face.'),
      caveat: news.high
        ? 'A high-impact release lands inside the open window, which is exactly the condition this sample cannot speak to.'
        : null,
    };
  }

  /** Scheduled releases within the open window. */
  function newsInWindow(symbol, beforeMin = 20, afterMin = 45) {
    if (!window.Signals || !Signals.upcoming) return { items: [], high: false };
    const now = Math.floor(Date.now() / 1000);
    const openMin = 13 * 60 + 30;
    const d = new Date();
    const todayOpen = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 13, 30) / 1000;
    const from = todayOpen - beforeMin * 60;
    const to = todayOpen + afterMin * 60;

    const items = Signals.upcoming(symbol, 36 * 3600)
      .filter(e => e.t >= from && e.t <= to)
      // For an index it is US macro that matters, and it matters a great deal
      // more than it does for a crypto pair.
      .map(e => ({ ...e, weight: (e.cur === 'USD' ? 1 : e.cur === '' ? 0.5 : 0.2) * (e.impact === 'high' ? 1 : e.impact === 'medium' ? 0.5 : 0.2) }))
      .sort((a, b) => b.weight - a.weight);

    return { items, high: items.some(x => x.weight >= 0.8), openAt: todayOpen };
  }

  return { volatilityProfile, wilson, forecast, newsInWindow, OPENS, MIN_N };
})();

window.SessionBot = SessionBot;
