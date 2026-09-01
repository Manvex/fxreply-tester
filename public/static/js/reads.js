// ===========================================================================
// Market reads — the things worth knowing that a price series cannot tell you.
//
// The signal engine started with moving averages and a delta figure. Everything
// here is derived from data that only exists because twelve venues, a deep
// book history and a backfilled footprint are now being recorded. Each read is
// something a discretionary trader would actually look at, and each one is
// computed rather than asserted, so it can be wrong out loud.
//
//   Basis        the perpetual against spot. A perp trading under spot means
//                shorts are paying to stay short; the direction that basis is
//                travelling matters more than its level.
//   Absorption   size going through a price without the price leaving it.
//                Someone is taking the other side in scale; when they stop,
//                the move usually comes from there.
//   Stacked      several consecutive footprint rows imbalanced the same way.
//                One lopsided row is noise, four in a row is intent.
//   Bar delta    a bar that closes up on negative delta was not bought, it was
//                let up. That disagreement is a warning, not a confirmation.
//   Walls        how long a resting level has actually been resting. A wall
//                that appeared a second ago is a quote, not a commitment.
//   Voids        thin stretches in the book, where price travels fastest and
//                where a target should sit on the far side rather than inside.
//   Regime       how alive the tape is against its own recent history. Signals
//                taken in dead volatility are noise trades.
// ===========================================================================

const Reads = (() => {

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---- spot vs perpetual -------------------------------------------------
  /**
   * Basis in basis points, and where it is heading.
   *
   * Needs both markets live at once, so it reads the venue books directly
   * rather than the consolidated view, which only ever holds one of them.
   */
  const basisHistory = [];
  function basis(feed) {
    if (!feed) return null;
    let spot = 0, spotN = 0, perp = 0, perpN = 0;
    for (const b of feed.liveBooks()) {
      const bb = b.bestBid, ba = b.bestAsk;
      if (bb == null || ba == null) continue;
      if (b.venue.quote !== 'USDT') continue;       // USD venues carry their own basis
      const mid = (bb + ba) / 2;
      if (b.venue.kind === 'perp') { perp += mid; perpN++; }
      else { spot += mid; spotN++; }
    }
    if (!spotN || !perpN) return null;
    const s = spot / spotN, p = perp / perpN;
    const bps = ((p - s) / s) * 10000;

    const now = Date.now();
    const last = basisHistory[basisHistory.length - 1];
    if (!last || now - last.t > 2000) {
      basisHistory.push({ t: now, bps });
      if (basisHistory.length > 300) basisHistory.shift();
    }
    // Change over roughly the last two minutes. Drift is only meaningful once
    // there is genuinely that much history behind it — a sample count says
    // nothing about whether the comparison window exists.
    const WANT = 100000;
    const oldest = basisHistory[0];
    const span = oldest ? now - oldest.t : 0;
    let ref = null;
    for (const h of basisHistory) { if (h.t >= now - 120000) { ref = h; break; } }
    const drift = ref ? bps - ref.bps : 0;

    return { bps, drift, spot: s, perp: p, samples: basisHistory.length,
             spanMs: span, driftReady: span >= WANT };
  }

  function resetBasis() { basisHistory.length = 0; }

  // ---- footprint reads ---------------------------------------------------
  /** The finished bars, newest last, re-bucketed to a sane row size. */
  function recentBars(n = 6) {
    const src = window.MicroPanels && MicroPanels.bars;
    if (!src || !src.size) return [];
    const keys = [...src.keys()].sort((a, b) => a - b).slice(-n);
    const tick = MicroPanels.fpTick || MicroPanels.bucket || 1;
    return keys.map(k => {
      const m = new Map();
      let buy = 0, sell = 0;
      for (const [p, c] of src.get(k)) {
        const key = Math.floor(p / tick) * tick;
        let cell = m.get(key);
        if (!cell) { cell = { buy: 0, sell: 0 }; m.set(key, cell); }
        cell.buy += c.buy; cell.sell += c.sell;
        buy += c.buy; sell += c.sell;
      }
      return { t: k, m, buy, sell, vol: buy + sell, delta: buy - sell, tick };
    });
  }

  /**
   * The last bar that is actually finished.
   *
   * The forming bar is a few seconds old and carries almost nothing, so reading
   * absorption or stacked imbalance off it produces a confident verdict about
   * noise. Only completed bars are judged, and only when they traded enough to
   * be worth judging against the ones around them.
   */
  function lastClosed(bars) {
    if (bars.length < 2) return null;
    const b = bars[bars.length - 2];
    if (!b || !b.vol) return null;
    const others = bars.slice(0, -1);
    if (others.length < 2) return null;
    const avg = others.reduce((s, x) => s + x.vol, 0) / others.length;
    if (!(avg > 0) || b.vol < avg * 0.35) return null;   // too thin to read
    return b;
  }

  /**
   * Absorption: the price that took the most volume in the bar, and whether the
   * bar actually left it. Heavy trade with no travel is someone soaking it up.
   */
  function absorption(bars, candles) {
    const b = lastClosed(bars);
    if (!b) return null;

    let poc = null, pocV = 0;
    for (const [p, c] of b.m) { const t = c.buy + c.sell; if (t > pocV) { pocV = t; poc = p; } }
    if (poc == null) return null;

    const cs = candles || (window.ChartMgr && ChartMgr.candles);
    const bar = cs && cs.find(c => c.time === b.t);
    if (!bar) return null;

    const range = bar.high - bar.low;
    if (!(range > 0)) return null;

    // How much of the bar's volume sat on one row, and how far the bar closed
    // from that row measured in rows.
    const concentration = pocV / b.vol;
    const away = Math.abs(bar.close - poc) / b.tick;
    const cell = b.m.get(poc);
    const side = cell ? Math.sign(cell.buy - cell.sell) : 0;

    // Absorbed when a lot of volume piled onto one price and price stayed on it.
    const absorbed = concentration > 0.28 && away <= 1.5;
    return { poc, pocV, concentration, away, side, absorbed, close: bar.close, at: b.t };
  }

  /**
   * Stacked imbalance: consecutive rows where one side paid through the other,
   * compared diagonally the way a footprint is read.
   */
  function stacked(bars) {
    const b = lastClosed(bars);
    if (!b) return null;
    const prices = [...b.m.keys()].sort((x, y) => x - y);
    if (prices.length < 3) return null;

    let bestUp = 0, bestDown = 0, runUp = 0, runDown = 0;
    const IMB = 3;
    for (let i = 1; i < prices.length; i++) {
      const here = b.m.get(prices[i]);
      const below = b.m.get(prices[i - 1]);
      if (!here || !below) { runUp = 0; runDown = 0; continue; }
      if (here.buy >= below.sell * IMB && here.buy > 0) { runUp++; bestUp = Math.max(bestUp, runUp); }
      else runUp = 0;
      if (below.sell >= here.buy * IMB && below.sell > 0) { runDown++; bestDown = Math.max(bestDown, runDown); }
      else runDown = 0;
    }
    return { up: bestUp, down: bestDown };
  }

  /** A bar that went one way while the aggressors went the other. */
  function deltaDivergence(bars, candles) {
    const cs = candles || (window.ChartMgr && ChartMgr.candles);
    if (!bars.length || !cs) return null;
    let disagree = 0, checked = 0;
    for (const b of bars.slice(0, -1).slice(-4)) {
      const bar = cs.find(c => c.time === b.t);
      if (!bar || !b.vol) continue;
      const moved = Math.sign(bar.close - bar.open);
      const flow = Math.sign(b.delta);
      if (moved !== 0 && flow !== 0) { checked++; if (moved !== flow) disagree++; }
    }
    if (!checked) return null;
    return { disagree, checked, ratio: disagree / checked };
  }

  // ---- liquidity map reads ------------------------------------------------
  /**
   * Walls that have actually been sitting there.
   *
   * The book history gives something a single snapshot cannot: how long a level
   * has held its size. A wall present across most of the recorded window is a
   * real commitment; one that appeared moments ago is a quote that can vanish
   * the instant price approaches it.
   */
  function persistentWalls(mid, lookback = 90) {
    const cols = window.MicroPanels && MicroPanels.cols;
    if (!cols || cols.length < 5) return [];
    const from = Math.max(0, cols.length - lookback);
    const window_ = cols.slice(from);
    const bucket = MicroPanels.bucket || 1;

    // Sum size per price across the window, and count how often it was there.
    const seen = new Map();   // priceBucket -> {sum, hits, last}
    for (const col of window_) {
      const v = col.v;
      for (let k = 0; k < v.length; k += 2) {
        const key = Math.round(v[k] / bucket);
        let e = seen.get(key);
        if (!e) { e = { sum: 0, hits: 0 }; seen.set(key, e); }
        e.sum += v[k + 1];
        e.hits++;
      }
    }
    if (!seen.size) return [];

    const avg = [...seen.values()].reduce((s, e) => s + e.sum / e.hits, 0) / seen.size;
    const out = [];
    for (const [key, e] of seen) {
      const price = key * bucket;
      const mean = e.sum / e.hits;
      const persistence = e.hits / window_.length;
      if (mean > avg * 3.5 && persistence > 0.55) {
        out.push({ price, size: mean, persistence, side: price < mid ? 'bid' : 'ask' });
      }
    }
    return out.sort((a, b) => b.size * b.persistence - a.size * a.persistence).slice(0, 8);
  }

  /**
   * Thin stretches in the current book — where price has least to chew through.
   * A target placed just past a void is far more likely to be reached than one
   * placed inside it.
   */
  function voids(mid) {
    const cols = window.MicroPanels && MicroPanels.cols;
    if (!cols || !cols.length) return { up: null, down: null };
    const v = cols[cols.length - 1].v;
    const bucket = MicroPanels.bucket || 1;

    const levels = [];
    for (let k = 0; k < v.length; k += 2) levels.push({ p: v[k], q: v[k + 1] });
    if (levels.length < 10) return { up: null, down: null };
    levels.sort((a, b) => a.p - b.p);

    const qs = levels.map(l => l.q).sort((a, b) => a - b);
    const median = qs[Math.floor(qs.length / 2)] || 0;
    if (!median) return { up: null, down: null };

    // Walk outward from mid; the first run of thin levels is the nearest void.
    const scan = (dir) => {
      const side = dir > 0 ? levels.filter(l => l.p > mid) : levels.filter(l => l.p < mid).reverse();
      let run = 0, start = null;
      for (const l of side) {
        if (l.q < median * 0.35) {
          if (run === 0) start = l.p;
          run++;
          if (run >= 3) return { from: start, to: l.p, rows: run };
        } else run = 0;
      }
      return null;
    };
    return { up: scan(1), down: scan(-1) };
  }

  // ---- regime -------------------------------------------------------------
  /**
   * Is the tape alive? ATR against its own recent distribution, as a percentile.
   * Dead tape produces signals that cannot pay for their own spread.
   */
  function regime(candles) {
    if (!candles || candles.length < 60) return null;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const p = candles[i - 1].close;
      trs.push(Math.max(candles[i].high - candles[i].low,
        Math.abs(candles[i].high - p), Math.abs(candles[i].low - p)));
    }
    const recent = trs.slice(-14).reduce((a, b) => a + b, 0) / 14;
    const hist = trs.slice(-200).sort((a, b) => a - b);
    let below = 0;
    for (const t of hist) if (t < recent) below++;
    const pct = below / hist.length;
    return {
      atr: recent, pct,
      label: pct < 0.2 ? 'dead' : pct < 0.45 ? 'quiet' : pct < 0.8 ? 'normal' : 'hot',
    };
  }

  // ---- venue agreement ----------------------------------------------------
  /**
   * Do the venues agree on price? A spread between them that is wide relative
   * to its own norm means someone is moving one venue and the rest have not
   * followed — the least reliable moment to act on a book reading.
   */
  function dispersion(feed) {
    if (!feed) return null;
    const mids = [];
    for (const b of feed.liveBooks()) {
      if (b.venue.quote !== 'USDT') continue;
      const bb = b.bestBid, ba = b.bestAsk;
      if (bb == null || ba == null) continue;
      mids.push({ mid: (bb + ba) / 2, kind: b.venue.kind });
    }
    const same = mids.filter(m => m.kind === ((window.CryptoHub && CryptoHub.market) || 'spot'));
    const use = same.length >= 2 ? same : mids;
    if (use.length < 2) return null;
    const vals = use.map(m => m.mid);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const mid = (lo + hi) / 2;
    return { bps: ((hi - lo) / mid) * 10000, venues: use.length };
  }

  return {
    basis, resetBasis, recentBars, lastClosed, absorption, stacked, deltaDivergence,
    persistentWalls, voids, regime, dispersion, clamp,
  };
})();

window.Reads = Reads;
