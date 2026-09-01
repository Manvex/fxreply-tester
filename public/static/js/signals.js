// ===========================================================================
// Signal engine for crypto CFD / perpetuals.
//
// What this is: a confluence model. It reads several independent things about
// the market, scores each one, and only speaks when enough of them agree. Every
// signal carries the reasons that produced it and the levels it would trade to.
//
// What this is not: a profitable system. Nothing that reads public data and
// runs in a browser tab has an edge on its own. Treat a signal as a structured
// second opinion — the reasons matter more than the verdict, and the levels are
// only as good as the liquidity they were drawn from.
//
// Inputs, in the order they matter:
//
//   Trend        six timeframes, each scored on where price sits against its
//                own EMAs and which way they are sloping. Higher timeframes
//                carry more weight, because they are harder to reverse.
//   Delta        who is crossing the spread. Price rising on negative delta is
//                being sold into; that disagreement is worth more than either
//                fact alone.
//   Whales       net sweep flow over the last quarter hour.
//   Book         resting size either side, and where the walls are.
//   News         a high-impact release relevant to the pair suspends signalling
//                entirely — spreads gap, stops get run, and none of the above
//                means anything across the print.
//   Volatility   ATR, to floor the stop so it is not sitting inside the noise.
//
// Stops go beyond the opposing wall, targets stop short of the next one in
// front, and a setup that cannot reach 1.5R is discarded rather than shipped
// with a bad number attached.
// ===========================================================================

const Signals = (() => {

  const TFS = [
    { tf: '1m',  weight: 0.5,  bars: 120 },
    { tf: '5m',  weight: 1.0,  bars: 120 },
    { tf: '15m', weight: 1.5,  bars: 120 },
    { tf: '1h',  weight: 2.0,  bars: 150 },
    { tf: '4h',  weight: 2.5,  bars: 150 },
    { tf: '1d',  weight: 3.0,  bars: 150 },
  ];

  const MIN_RR = 1.5;
  const COOLDOWN_MS = 12 * 60 * 1000;   // no free flip-flops

  // ---- why the engine used to keep changing its mind --------------------
  //
  // It rebuilt an opinion from scratch every five seconds and published
  // whatever it found. With conviction hovering near a single threshold, that
  // produced a card that flipped between long, short and nothing while the
  // market did nothing in particular. Three changes stop it:
  //
  //   Smoothing    conviction is an exponential average, not the instantaneous
  //                reading, so one noisy five-second window cannot swing it.
  //   Hysteresis   it takes more to enter than it does to stay. Crossing 0.34
  //                once is not an entry; the level to fire is 0.46 and the
  //                level to abandon is 0.26, and the gap between them is where
  //                the flapping used to live.
  //   Commitment   once fired, a signal is a position with a lifecycle. It is
  //                held until its stop, its target, a genuine reversal or old
  //                age — not re-derived into a different opinion each tick.
  const ENTER = 0.46;
  const EXIT = 0.26;
  const CONFIRM_TICKS = 3;              // ~15s of agreement before firing
  const SMOOTH = 0.35;                  // EMA weight on each new reading
  const MAX_AGE_MS = 90 * 60 * 1000;
  const REVERSE = 0.40;                 // conviction the other way that kills it
  const NEWS_BLACKOUT_BEFORE = 30 * 60;   // seconds
  const NEWS_BLACKOUT_AFTER = 15 * 60;

  let trends = new Map();      // tf -> {score, label, ema20, ema50, atr, close}
  let lastTrendAt = 0;
  let trendSymbol = null;
  let news = [];
  let lastNewsAt = 0;
  let current = null;          // what the UI shows
  let history = [];            // signals already issued, newest first
  let loading = false;

  // The state machine that makes a call stick.
  let smooth = 0;              // smoothed conviction
  let forming = 0;             // consecutive ticks above ENTER, signed
  let live = null;             // the committed signal, or null
  let lastClosedAt = 0;
  const listeners = new Set(); // fired once when a signal commits

  // ---- trend ------------------------------------------------------------
  function ema(vals, len) {
    const k = 2 / (len + 1);
    let prev = vals[0];
    for (let i = 1; i < vals.length; i++) prev = vals[i] * k + prev * (1 - k);
    return prev;
  }
  function emaSeries(vals, len) {
    const k = 2 / (len + 1);
    const out = new Array(vals.length);
    let prev = vals[0];
    out[0] = prev;
    for (let i = 1; i < vals.length; i++) { prev = vals[i] * k + prev * (1 - k); out[i] = prev; }
    return out;
  }
  function atr(cs, len = 14) {
    let sum = 0, n = 0;
    for (let i = Math.max(1, cs.length - len); i < cs.length; i++) {
      const p = cs[i - 1].close;
      sum += Math.max(cs[i].high - cs[i].low, Math.abs(cs[i].high - p), Math.abs(cs[i].low - p));
      n++;
    }
    return n ? sum / n : 0;
  }

  /**
   * Score one timeframe from -1 (down) to +1 (up).
   *
   * Three things, equally weighted: which side of the slow EMA price is on,
   * whether the fast EMA is above the slow one, and which way the slow EMA is
   * actually pointing. A timeframe only reads as strong when all three agree.
   */
  function scoreTrend(cs) {
    if (!cs || cs.length < 60) return null;
    const closes = cs.map(c => c.close);
    const e20 = emaSeries(closes, 20);
    const e50 = emaSeries(closes, 50);
    const last = closes[closes.length - 1];
    const a = atr(cs);

    const slopeWindow = Math.min(10, e50.length - 1);
    const slope = (e50[e50.length - 1] - e50[e50.length - 1 - slopeWindow]) / slopeWindow;

    // Normalised by ATR so the same score means the same thing on any pair.
    const unit = a || (last * 0.001);
    const vsSlow = clamp((last - e50[e50.length - 1]) / unit, -1.5, 1.5) / 1.5;
    const stack = clamp((e20[e20.length - 1] - e50[e50.length - 1]) / unit, -1.5, 1.5) / 1.5;
    const dir = clamp(slope / (unit * 0.15), -1.5, 1.5) / 1.5;

    const score = (vsSlow + stack + dir) / 3;
    return {
      score,
      label: score > 0.45 ? 'up' : score < -0.45 ? 'down' : score > 0.15 ? 'up-weak'
        : score < -0.15 ? 'down-weak' : 'flat',
      close: last, atr: a,
      ema20: e20[e20.length - 1], ema50: e50[e50.length - 1],
    };
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  async function refreshTrends(symbol) {
    if (loading) return;
    loading = true;
    try {
      const to = Math.floor(Date.now() / 1000);
      const next = new Map();
      for (const spec of TFS) {
        const tfSec = DataStore.TF_SEC[spec.tf];
        const from = to - tfSec * spec.bars;
        try {
          const cs = await DataStore.load(symbol, spec.tf, from, to);
          const t = scoreTrend(cs);
          if (t) next.set(spec.tf, t);
        } catch (_e) { /* one timeframe missing is not fatal */ }
      }
      if (next.size) { trends = next; trendSymbol = symbol; lastTrendAt = Date.now(); }
    } finally { loading = false; }
  }

  /** Weighted agreement across timeframes, -1..+1, plus how unanimous it is. */
  function trendConsensus() {
    let sum = 0, wsum = 0, up = 0, down = 0;
    for (const spec of TFS) {
      const t = trends.get(spec.tf);
      if (!t) continue;
      sum += t.score * spec.weight;
      wsum += spec.weight;
      if (t.score > 0.15) up++; else if (t.score < -0.15) down++;
    }
    if (!wsum) return null;
    const score = sum / wsum;
    const n = up + down;
    return { score, up, down, agreement: n ? Math.max(up, down) / n : 0, counted: trends.size };
  }

  // ---- news -------------------------------------------------------------
  /**
   * How much an event matters to this pair.
   *
   * Crypto has no calendar of its own worth reading, but it trades as a dollar
   * risk asset: US macro moves it, and everything else mostly does not. So the
   * currency is scored for relevance and multiplied by the release's impact.
   */
  function relevance(ev, symbol) {
    const base = Exchanges.baseOf(symbol);
    const cur = (ev.cur || '').toUpperCase();
    let rel;
    if (cur === 'USD') rel = 1;
    else if (cur === '' ) rel = 0.5;          // "All" — G20, summits
    else if (cur === 'EUR' || cur === 'CNY') rel = 0.35;
    else rel = 0.15;
    const imp = ev.impact === 'high' ? 1 : ev.impact === 'medium' ? 0.55 : ev.impact === 'holiday' ? 0.2 : 0.25;
    return { score: rel * imp, rel, imp, base };
  }

  async function refreshNews() {
    if (Date.now() - lastNewsAt < 10 * 60 * 1000 && news.length) return;
    try {
      const r = await fetch('/api/news');
      const j = await r.json();
      if (j.events) { news = j.events; lastNewsAt = Date.now(); }
    } catch (_e) { /* keep whatever we have */ }
  }

  /** Events near now, scored and sorted — what the chart and the panel show. */
  function upcoming(symbol, windowSec = 36 * 3600) {
    const now = Math.floor(Date.now() / 1000);
    return news
      .filter(e => e.t > now - 6 * 3600 && e.t < now + windowSec)
      .map(e => ({ ...e, ...relevance(e, symbol) }))
      .sort((a, b) => a.t - b.t);
  }

  /** The release that suspends signalling, if there is one. */
  function blackout(symbol) {
    const now = Math.floor(Date.now() / 1000);
    for (const e of news) {
      const r = relevance(e, symbol);
      if (r.score < 0.5) continue;                     // not big enough to matter
      if (e.t - now < NEWS_BLACKOUT_BEFORE && now - e.t < NEWS_BLACKOUT_AFTER) {
        return { ev: e, ...r, inSec: e.t - now };
      }
    }
    return null;
  }

  // ---- liquidity ---------------------------------------------------------
  /**
   * The nearest wall either side, from the deep consolidated book.
   *
   * These are what the stop hides behind and what the target stops short of:
   * a level with real size resting on it is where a move is most likely to
   * stall, and where a stop placed just inside it is most likely to be taken.
   */
  function walls(feed, price) {
    if (!feed) return { above: null, below: null, bidNotional: 0, askNotional: 0 };
    const tick = Exchanges.autoTick(price);
    const c = feed.consolidate({ tick, depth: 200, deep: true, ...CryptoHub.view() });
    if (!c) return { above: null, below: null, bidNotional: 0, askNotional: 0 };

    const notional = (l) => l.qty * l.price;
    const bidTotal = c.bids.reduce((s, l) => s + notional(l), 0);
    const askTotal = c.asks.reduce((s, l) => s + notional(l), 0);
    const avgBid = bidTotal / Math.max(1, c.bids.length);
    const avgAsk = askTotal / Math.max(1, c.asks.length);

    // A wall is a level carrying several times the average level's size.
    const below = c.bids.find(l => notional(l) > avgBid * 4) || null;
    const above = c.asks.find(l => notional(l) > avgAsk * 4) || null;
    return {
      above: above ? { price: above.price, notional: notional(above) } : null,
      below: below ? { price: below.price, notional: notional(below) } : null,
      bidNotional: bidTotal, askNotional: askTotal,
      imbalance: (bidTotal + askTotal) > 0 ? (bidTotal - askTotal) / (bidTotal + askTotal) : 0,
    };
  }

  // ---- the signal --------------------------------------------------------
  function build(symbol) {
    const feed = CryptoHub.feed, tape = CryptoHub.tape;
    if (!feed || !tape) return { state: 'waiting', reason: 'Not connected to the exchanges yet.' };

    const cons = trendConsensus();
    if (!cons || cons.counted < 4) {
      return { state: 'waiting', reason: 'Reading the higher timeframes…' };
    }

    const live = feed.liveBooks()[0];
    const price = live ? (live.bestBid + live.bestAsk) / 2 : null;
    if (!price) return { state: 'waiting', reason: 'No live book yet.' };

    const bo = blackout(symbol);
    if (bo) {
      const mins = Math.round(Math.abs(bo.inSec) / 60);
      return {
        state: 'blocked', price,
        reason: bo.inSec > 0
          ? `${bo.ev.title} (${bo.ev.cur || 'global'}) in ${mins} min — standing aside until it has printed and the spread settles.`
          : `${bo.ev.title} printed ${mins} min ago — waiting for the reaction to finish.`,
        news: bo,
      };
    }

    const w5 = tape.window(300), w15 = tape.window(900);
    const wf = tape.whaleFlow(900);
    const lq = walls(feed, price);

    const cs = window.ChartMgr && ChartMgr.candles;
    const reg = Reads.regime(cs);
    const disp = Reads.dispersion(feed);
    const bas = Reads.basis(feed);
    const fbars = Reads.recentBars(8);
    const abs = Reads.absorption(fbars, cs);
    const stk = Reads.stacked(fbars);
    const div = Reads.deltaDivergence(fbars, cs);
    const pw = Reads.persistentWalls(price);
    const vd = Reads.voids(price);
    // Declared here rather than beside their votes: the gates below report the
    // conditions they refused on, and those include these two.
    const oi = window.Derivs && Derivs.oiRead(cs);
    const fnd = window.Derivs && Derivs.funding();

    const dTf = trends.get('5m') || trends.get('15m');
    const a = dTf ? dTf.atr : price * 0.002;

    // ---- gates ----------------------------------------------------------
    // Conditions under which no reading is worth acting on, whatever the
    // votes say. Refusing to trade is a position.
    if (reg && reg.label === 'dead') {
      return {
        state: 'flat', price, conviction: 0, votes: [],
        reason: 'The tape is dead — volatility is in the bottom fifth of its own recent range. Any level here is inside the noise.',
        reads: { reg, disp, bas, oi, fnd }, trends: snapshotTrends(),
        news: upcoming(symbol, 12 * 3600).slice(0, 4),
      };
    }
    if (disp && disp.bps > 12) {
      return {
        state: 'flat', price, conviction: 0, votes: [],
        reason: `The venues disagree by ${disp.bps.toFixed(1)} bps. One book is being moved and the rest have not followed — the worst moment to read depth.`,
        reads: { reg, disp, bas, oi, fnd }, trends: snapshotTrends(),
        news: upcoming(symbol, 12 * 3600).slice(0, 4),
      };
    }

    // ---- the votes ------------------------------------------------------
    const votes = [];
    const add = (name, score, detail) => votes.push({ name, score, detail });

    add('Trend', cons.score * 2.2,
      `${cons.up} timeframe${cons.up === 1 ? '' : 's'} up, ${cons.down} down` +
      (cons.agreement >= 0.8 ? ' — near unanimous' : cons.agreement < 0.6 ? ' — split' : ''));

    add('Delta 5m', clamp(w5.ratio * 1.4, -1, 1),
      `${w5.ratio >= 0 ? 'buyers' : 'sellers'} crossing the spread, ${(Math.abs(w5.ratio) * 100).toFixed(0)}% skew`);

    add('Delta 15m', clamp(w15.ratio, -1, 1) * 0.8,
      `${(w15.delta >= 0 ? '+' : '') + fmtUsd(w15.delta)} net over 15m`);

    add('Whales', clamp(wf.ratio * 1.2, -1, 1) * 1.1,
      wf.total > 0 ? `${fmtUsd(wf.buy)} bought vs ${fmtUsd(wf.sell)} sold` : 'no size through yet');

    add('Book', clamp(lq.imbalance * 1.5, -1, 1) * 0.9,
      `${fmtUsd(lq.bidNotional)} resting bid vs ${fmtUsd(lq.askNotional)} ask`);

    // Open interest against price. This is the one read that separates a move
    // being funded by new positions from one that is only the losing side
    // leaving, and the two behave completely differently afterwards.
    if (oi && oi.label !== 'flat') {
      add('Open interest', oi.bias * 1.15,
        `${oi.label} — ${oi.meaning} (OI ${oi.oiChgPct >= 0 ? '+' : ''}${oi.oiChgPct.toFixed(2)}% over ${oi.windowMin}m)`);
    }

    // Funding at an extreme is crowding: everyone paying to hold one side is
    // everyone already holding it, and that is who gets squeezed.
    if (fnd && fnd.heat !== 'normal') {
      add('Funding', -Math.sign(fnd.rate) * (fnd.heat === 'extreme' ? 0.9 : 0.5),
        `${fnd.payer} ${Math.abs(fnd.pct8h).toFixed(3)}% per 8h (${fnd.apr.toFixed(0)}% a year) — ${fnd.heat} crowding`);
    }

    // Perp against spot. The direction basis is travelling carries more than
    // its level: a discount getting deeper is shorts pressing, and a discount
    // closing while price holds is that pressure being unwound.
    if (bas && bas.driftReady) {
      const lean = clamp(bas.drift / 4, -1, 1);
      add('Basis', lean * 0.9,
        `perp ${bas.bps >= 0 ? 'over' : 'under'} spot by ${Math.abs(bas.bps).toFixed(1)} bps, ` +
        `${bas.drift >= 0 ? 'widening' : 'narrowing'} ${Math.abs(bas.drift).toFixed(1)}`);
    }

    // Stacked footprint imbalances — several rows in a row paid through.
    if (stk && (stk.up >= 3 || stk.down >= 3)) {
      const net = clamp((stk.up - stk.down) / 4, -1, 1);
      add('Stacked imbalance', net * 1.2,
        stk.up >= 3 ? `${stk.up} rows bought through the offer` : `${stk.down} rows sold into the bid`);
    }

    // Absorption cuts against the direction that was doing the hitting: size
    // went in and price did not follow, so the other side held.
    if (abs && abs.absorbed && abs.side !== 0) {
      add('Absorption', -abs.side * 1.0,
        `${(abs.concentration * 100).toFixed(0)}% of the ` +
        `${new Date(abs.at * 1000).toTimeString().slice(0, 5)} bar traded at one price and it held`);
    }

    // A bar that closed against its own flow was not bought, it was let up.
    if (div && div.checked >= 3 && div.ratio >= 0.5) {
      add('Flow divergence', -Math.sign(cons.score) * 0.8,
        `${div.disagree} of the last ${div.checked} bars closed against their own delta`);
    }

    const total = votes.reduce((s, v) => s + v.score, 0);
    const maxTotal = 2.2 + 1 + 0.8 + 1.1 + 0.9 + 0.9 + 1.2 + 1.0 + 1.15 + 0.9;
    const conviction = clamp(total / maxTotal, -1, 1);

    // ---- direction and levels -------------------------------------------
    const dir = conviction > 0 ? 1 : -1;
    let strength = Math.abs(conviction);

    // A quiet tape can still produce a setup, but it should have to be better.
    const bar = reg && reg.label === 'quiet' ? 0.42 : 0.34;
    if (strength < bar) {
      return {
        state: 'flat', price, conviction, votes,
        reason: reg && reg.label === 'quiet'
          ? 'Nothing lines up strongly enough for a quiet tape.'
          : 'Nothing lines up well enough — the readings cancel out.',
        reads: { reg, disp, bas, oi, fnd, stk, abs, walls: pw, voids: vd },
        trends: snapshotTrends(), news: upcoming(symbol, 12 * 3600).slice(0, 4),
      };
    }

    // Don't flip on a coin toss: an opposite call inside the cooldown has to be
    // materially stronger than the one it is replacing.
    const prev = history[0];
    if (prev && prev.side && (Date.now() - prev.at) < COOLDOWN_MS) {
      const opposite = (prev.dir !== dir);
      if (opposite && strength < prev.strength + 0.12) {
        return {
          state: 'flat', price, conviction, votes,
          reason: `Held: this points the other way to the ${prev.side} from ${Math.round((Date.now() - prev.at) / 60000)} min ago, and not by enough to justify the flip.`,
          reads: { reg, disp, bas, oi, fnd }, trends: snapshotTrends(),
          news: upcoming(symbol, 12 * 3600).slice(0, 4),
        };
      }
    }

    // Stop: behind a wall that has actually been resting, otherwise a
    // volatility multiple; never closer than 0.9 ATR or price noise takes it.
    const behind = pw.filter(x => (dir > 0 ? x.price < price : x.price > price))
      .sort((x, y) => Math.abs(x.price - price) - Math.abs(y.price - price))[0]
      || (dir > 0 ? lq.below : lq.above);
    const atrStop = a * 1.6;
    let stopDist = atrStop;
    if (behind) {
      const beyond = Math.abs(price - behind.price) + a * 0.35;
      stopDist = Math.max(atrStop * 0.75, Math.min(beyond, atrStop * 2.2));
    }
    stopDist = Math.max(stopDist, a * 0.9);

    // Target: past the near side of a void if there is one, otherwise short of
    // the wall in front, otherwise a multiple of the risk.
    const ahead = pw.filter(x => (dir > 0 ? x.price > price : x.price < price))
      .sort((x, y) => Math.abs(x.price - price) - Math.abs(y.price - price))[0]
      || (dir > 0 ? lq.above : lq.below);
    let tpDist = stopDist * (1.6 + strength * 1.4);
    let tpWhy = 'risk multiple';
    const voidSide = dir > 0 ? vd.up : vd.down;
    if (voidSide) {
      const past = Math.abs(voidSide.to - price) + a * 0.2;
      if (past > stopDist * 1.4) { tpDist = Math.min(tpDist * 1.35, past); tpWhy = 'past the thin stretch'; }
    }
    if (ahead) {
      const toWall = Math.abs(ahead.price - price) - a * 0.25;
      if (toWall > stopDist * 1.2 && toWall < tpDist) { tpDist = toWall; tpWhy = 'short of the wall in front'; }
    }

    const rr = tpDist / stopDist;
    if (rr < MIN_RR) {
      return {
        state: 'flat', price, conviction, votes,
        reason: `Direction is there but the levels are not — the structure only gives ${rr.toFixed(2)}R.`,
        reads: { reg, disp, bas, oi, fnd, walls: pw, voids: vd },
        trends: snapshotTrends(), news: upcoming(symbol, 12 * 3600).slice(0, 4),
      };
    }

    const sl = price - dir * stopDist;
    const tp1 = price + dir * tpDist * 0.6;
    const tp2 = price + dir * tpDist;

    // Price the trade before shipping it. Fees and funding are not a rounding
    // error on a perpetual, and a target that only clears the costs is not a
    // target — it is a way to be busy.
    const draft = { state: 'signal', entry: price, sl, tp1, tp2, dir };
    const plan = window.Risk ? Risk.plan(draft) : null;
    if (plan && plan.netR2 < 1.15) {
      return {
        state: 'flat', price, conviction, votes,
        reason: `Gross ${rr.toFixed(2)}R, but only ${plan.netR2.toFixed(2)}R after fees and funding — against a ${Math.abs(plan.netLossR).toFixed(2)}R loss. It does not pay for itself.`,
        reads: { reg, disp, bas, oi, fnd, walls: pw, voids: vd },
        plan,
        trends: snapshotTrends(), news: upcoming(symbol, 12 * 3600).slice(0, 4),
      };
    }

    return {
      state: 'signal',
      plan,
      side: dir > 0 ? 'LONG' : 'SHORT',
      dir, price, entry: price, sl, tp1, tp2, rr, tpWhy,
      stopPct: (stopDist / price) * 100,
      conviction, strength,
      grade: strength > 0.62 ? 'A' : strength > 0.46 ? 'B' : 'C',
      votes: votes.sort((x, y) => Math.abs(y.score) - Math.abs(x.score)),
      walls: lq, atr: a,
      reads: { reg, disp, bas, oi, fnd, stk, abs, div, walls: pw, voids: vd },
      trends: snapshotTrends(),
      news: upcoming(symbol, 12 * 3600).slice(0, 4),
      at: Date.now(),
    };
  }

  function snapshotTrends() {
    return TFS.map(s => ({ tf: s.tf, ...(trends.get(s.tf) || { score: null, label: 'n/a' }) }));
  }

  function fmtUsd(n) {
    const a = Math.abs(n), sg = n < 0 ? '-' : '';
    if (a >= 1e9) return sg + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sg + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return sg + '$' + (a / 1e3).toFixed(0) + 'k';
    return sg + '$' + a.toFixed(0);
  }

  // ---- holding a decision ------------------------------------------------
  /**
   * Turn a fresh reading into a decision that survives the next five seconds.
   *
   * `raw` is what build() found this instant. This decides whether that is
   * worth acting on, and — once it has committed — mostly ignores it.
   */
  function commit(raw, symbol) {
    const now = Date.now();

    // A blocked or waiting engine says so regardless of what is committed.
    if (!raw || raw.state === 'waiting') { return raw; }

    const inst = raw.conviction != null ? raw.conviction : 0;
    smooth = smooth === 0 ? inst : smooth + SMOOTH * (inst - smooth);

    // ---- already committed: manage it, do not second-guess it -----------
    if (live) {
      const price = raw.price || live.entry;
      const dir = live.dir;
      const hitSl = dir > 0 ? price <= live.sl : price >= live.sl;
      const hitTp2 = dir > 0 ? price >= live.tp2 : price <= live.tp2;
      const hitTp1 = dir > 0 ? price >= live.tp1 : price <= live.tp1;
      if (hitTp1) live.tp1Hit = true;

      const reversed = Math.sign(smooth) === -dir && Math.abs(smooth) > REVERSE;
      const stale = now - live.at > MAX_AGE_MS;
      const blocked = raw.state === 'blocked';

      let closed = null;
      if (hitSl) closed = live.tp1Hit ? 'stopped at break-even' : 'stopped out';
      else if (hitTp2) closed = 'target reached';
      else if (reversed) closed = 'conditions reversed';
      else if (stale) closed = 'timed out';

      if (closed) {
        const done = { ...live, state: 'closed', closedWhy: closed, closedAt: now, price };
        live = null;
        forming = 0;
        lastClosedAt = now;
        return done;
      }

      // Still running. Report it with live progress, not a new opinion.
      const risk = Math.abs(live.entry - live.sl) || 1;
      return {
        ...live,
        state: 'signal',
        held: true,
        price,
        ageMin: Math.round((now - live.at) / 60000),
        unrealisedR: ((price - live.entry) * dir) / risk,
        tp1Hit: !!live.tp1Hit,
        // Kept for the panel, so the reasoning stays visible while it runs.
        votes: live.votes, reads: raw.reads, trends: raw.trends, news: raw.news,
        note: blocked
          ? 'A release is landing while this is open — manage it, but the engine is not adding to it.'
          : null,
      };
    }

    // ---- nothing committed: decide whether to ---------------------------
    if (raw.state !== 'signal' || Math.abs(smooth) < ENTER) {
      forming = 0;
      return { ...raw, state: raw.state === 'signal' ? 'forming' : raw.state,
               smooth, formingTicks: 0,
               reason: raw.state === 'signal'
                 ? `Reading ${(Math.abs(smooth) * 100).toFixed(0)}% ${smooth > 0 ? 'long' : 'short'}, below the ${(ENTER * 100).toFixed(0)}% it takes to commit.`
                 : raw.reason };
    }

    const dir = smooth > 0 ? 1 : -1;
    forming = Math.sign(forming) === dir ? forming + dir : dir;   // signed count

    if (Math.abs(forming) < CONFIRM_TICKS) {
      return { ...raw, state: 'forming', smooth, formingTicks: Math.abs(forming),
               reason: `Holding ${(Math.abs(smooth) * 100).toFixed(0)}% ${dir > 0 ? 'long' : 'short'} — ${CONFIRM_TICKS - Math.abs(forming)} more confirmation${CONFIRM_TICKS - Math.abs(forming) === 1 ? '' : 's'} before it commits.` };
    }

    if (now - lastClosedAt < COOLDOWN_MS) {
      return { ...raw, state: 'forming', smooth, formingTicks: Math.abs(forming),
               reason: `Conditions qualify, but the last call closed ${Math.round((now - lastClosedAt) / 60000)} min ago — waiting out the cooldown rather than re-entering on the same reading.` };
    }

    // Commit. From here the levels are fixed and the engine stops arguing.
    live = { ...raw, at: now, tp1Hit: false, committedAt: now };
    forming = 0;
    history.unshift(live);
    if (history.length > 25) history.pop();
    open.push({ side: live.side, dir: live.dir, entry: live.entry, sl: live.sl,
                tp1: live.tp1, tp2: live.tp2, rr: live.rr, at: live.at, tp1Hit: false });
    for (const fn of listeners) { try { fn(live, symbol); } catch (e) { console.warn('[signals]', e); } }
    return { ...live, state: 'signal', held: true, justFired: true, ageMin: 0, unrealisedR: 0 };
  }

  function onSignal(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  // ---- did it work? ------------------------------------------------------
  // Every issued call is tracked against the tape afterwards. This is not a
  // backtest and the sample is tiny, but a signal engine that never checks its
  // own work is asking to be believed on nothing.
  const open = [];       // signals still running
  const settled = [];    // {side, result:'tp1'|'tp2'|'sl'|'expired', r}

  const TRACK_MS = 90 * 60 * 1000;

  function track(price) {
    const now = Date.now();
    for (let i = open.length - 1; i >= 0; i--) {
      const t = open[i];
      const hitSl = t.dir > 0 ? price <= t.sl : price >= t.sl;
      const hitT2 = t.dir > 0 ? price >= t.tp2 : price <= t.tp2;
      const hitT1 = t.dir > 0 ? price >= t.tp1 : price <= t.tp1;
      if (hitT1) t.tp1Hit = true;
      let done = null;
      if (hitSl) done = t.tp1Hit ? 'be' : 'sl';       // stop moves to entry at TP1
      else if (hitT2) done = 'tp2';
      else if (now - t.at > TRACK_MS) done = t.tp1Hit ? 'tp1' : 'expired';
      if (done) {
        const risk = Math.abs(t.entry - t.sl) || 1;
        const r = done === 'tp2' ? t.rr : done === 'tp1' ? t.rr * 0.6
          : done === 'be' ? 0 : done === 'sl' ? -1
          : (price - t.entry) * t.dir / risk;
        settled.unshift({ side: t.side, result: done, r, at: t.at });
        if (settled.length > 60) settled.pop();
        open.splice(i, 1);
      }
    }
  }

  function record() {
    if (!settled.length) return null;
    const wins = settled.filter(s => s.r > 0).length;
    const totalR = settled.reduce((a, b) => a + b.r, 0);
    return {
      n: settled.length, open: open.length,
      wins, winRate: wins / settled.length * 100,
      totalR, avgR: totalR / settled.length,
      recent: settled.slice(0, 8),
    };
  }

  // ---- lifecycle ---------------------------------------------------------
  let evalTimer = null;

  async function tick(symbol) {
    if (!symbol) return;
    await refreshNews();
    if (symbol !== trendSymbol || Date.now() - lastTrendAt > 60000) await refreshTrends(symbol);
    const raw = build(symbol);
    const next = commit(raw, symbol);
    if (next && next.price) track(next.price);
    current = next;
    return next;
  }

  function start(symbolFn, ms = 5000) {
    stop();
    // Absorption, stacked imbalance and wall persistence all read the recorded
    // book and footprint, so the recorder has to be running for the engine to
    // see anything — whether or not those panels are on screen.
    window.MicroPanels && MicroPanels.startRecording('signals');
    window.Derivs && Derivs.start(symbolFn, 30000);
    const run = () => tick(symbolFn()).catch(e => console.warn('[signals]', e));
    run();
    evalTimer = setInterval(run, ms);
  }

  function stop() {
    if (evalTimer) { clearInterval(evalTimer); evalTimer = null; }
    window.MicroPanels && MicroPanels.stopRecording('signals');
    window.Derivs && Derivs.stop();
  }

  function reset() {
    trends = new Map(); trendSymbol = null; current = null; history = [];
    open.length = 0; settled.length = 0;
    smooth = 0; forming = 0; live = null; lastClosedAt = 0;
    Reads.resetBasis();
  }

  return {
    start, stop, tick, reset, upcoming, relevance, blackout, record, onSignal,
    get live() { return live; },
    get smooth() { return smooth; },
    thresholds: { ENTER, EXIT, CONFIRM_TICKS },
    get current() { return current; },
    get history() { return history; },
    get trends() { return snapshotTrends(); },
    TFS,
  };
})();

window.Signals = Signals;
