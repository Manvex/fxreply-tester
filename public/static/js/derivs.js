// ===========================================================================
// Derivatives context: funding, open interest, positioning.
//
// Price tells you where the market has been. These tell you how it is
// positioned to get there — which is the part a chart cannot show and the part
// that decides whether a move has fuel behind it or is running on fumes.
//
//   Funding      what a perpetual costs to hold. It is a real drain on a
//                position held for hours, and at extremes it is also a crowding
//                signal: everybody paying to be long is everybody already long.
//   Open interest  how many contracts are actually open. Read against price it
//                separates a move being bought from a move where the losing
//                side is simply closing:
//                   price up,  OI up    new longs — the move is being funded
//                   price up,  OI down  shorts covering — weaker, often fades
//                   price down, OI up   new shorts pressing
//                   price down, OI down longs capitulating into the exit
//   Ratio        share of accounts long. Retail positioning, useful mostly when
//                it is lopsided.
//
// Binance is the reference venue for all three: it carries the deepest perp and
// is the only one publishing this history free.
// ===========================================================================

const Derivs = (() => {
  let symbol = null;
  let data = { funding: null, oi: null, oiHist: [], ratio: null, at: 0 };
  let timer = null;
  let inflight = false;

  async function grab(what, extra = '') {
    const r = await fetch(`/api/binance/derivs?what=${what}&symbol=${symbol}${extra}`);
    if (!r.ok) throw new Error(what + ' ' + r.status);
    return r.json();
  }

  async function refresh() {
    if (!symbol || inflight) return;
    inflight = true;
    try {
      const [f, oi, hist, ratio] = await Promise.all([
        grab('funding').catch(() => null),
        grab('oi').catch(() => null),
        grab('oihist', '&period=5m&limit=48').catch(() => null),
        grab('ratio', '&period=5m&limit=2').catch(() => null),
      ]);

      if (f) {
        data.funding = {
          rate: +f.lastFundingRate,
          nextAt: +f.nextFundingTime,
          mark: +f.markPrice,
          index: +f.indexPrice,
        };
      }
      if (oi) data.oi = { contracts: +oi.openInterest, at: +oi.time };
      if (Array.isArray(hist) && hist.length) {
        data.oiHist = hist.map(h => ({
          t: +h.timestamp,
          oi: +h.sumOpenInterest,
          notional: +h.sumOpenInterestValue,
        }));
      }
      if (Array.isArray(ratio) && ratio.length) {
        const last = ratio[ratio.length - 1];
        data.ratio = { long: +last.longAccount, short: +last.shortAccount, at: +last.timestamp };
      }
      data.at = Date.now();
    } finally {
      inflight = false;
    }
  }

  /** Funding expressed the way it is actually felt: per 8h, per day, annualised. */
  function funding() {
    const f = data.funding;
    if (!f) return null;
    const per8h = f.rate * 100;
    return {
      rate: f.rate,
      pct8h: per8h,
      pctDay: per8h * 3,
      apr: per8h * 3 * 365,
      nextAt: f.nextAt,
      minsToNext: Math.max(0, Math.round((f.nextAt - Date.now()) / 60000)),
      // Positive means longs pay shorts.
      payer: f.rate > 0 ? 'longs pay' : f.rate < 0 ? 'shorts pay' : 'flat',
      // Crowding gets interesting well before it gets extreme.
      heat: Math.abs(per8h) > 0.05 ? 'extreme' : Math.abs(per8h) > 0.02 ? 'elevated' : 'normal',
    };
  }

  /**
   * Open interest against price over the same window.
   *
   * The pairing is what carries the information; either number alone says
   * almost nothing.
   */
  function oiRead(candles) {
    const h = data.oiHist;
    if (!h || h.length < 6) return null;
    const lookback = Math.min(12, h.length - 1);      // 12 x 5m = one hour
    const from = h[h.length - 1 - lookback];
    const to = h[h.length - 1];
    if (!from || !to || !from.oi) return null;

    const oiChg = (to.oi - from.oi) / from.oi;

    let priceChg = 0;
    if (candles && candles.length > 2) {
      const cutoff = from.t / 1000;
      let ref = null;
      for (let i = candles.length - 1; i >= 0; i--) {
        if (candles[i].time <= cutoff) { ref = candles[i]; break; }
      }
      const last = candles[candles.length - 1];
      if (ref && ref.close) priceChg = (last.close - ref.close) / ref.close;
    }

    const up = priceChg > 0.0005, down = priceChg < -0.0005;
    const oiUp = oiChg > 0.002, oiDown = oiChg < -0.002;

    let label = 'flat', meaning = 'no clear positioning shift', bias = 0;
    if (up && oiUp) { label = 'new longs'; meaning = 'the move is being funded by fresh positions'; bias = 1; }
    else if (up && oiDown) { label = 'short covering'; meaning = 'the move is shorts leaving, not buyers arriving'; bias = -0.5; }
    else if (down && oiUp) { label = 'new shorts'; meaning = 'fresh sellers are pressing'; bias = -1; }
    else if (down && oiDown) { label = 'long capitulation'; meaning = 'longs are being flushed out'; bias = 0.5; }

    return {
      label, meaning, bias,
      oiChgPct: oiChg * 100,
      priceChgPct: priceChg * 100,
      notional: to.notional,
      contracts: to.oi,
      windowMin: lookback * 5,
    };
  }

  function ratio() {
    const r = data.ratio;
    if (!r) return null;
    const skew = r.long - r.short;
    return {
      long: r.long * 100, short: r.short * 100, skew: skew * 100,
      // Retail crowding is only worth noting when it is genuinely lopsided.
      crowded: Math.abs(skew) > 0.24 ? (skew > 0 ? 'long' : 'short') : null,
    };
  }

  function start(symbolFn, ms = 30000) {
    stop();
    const run = () => {
      const s = symbolFn();
      if (s !== symbol) { symbol = s; data = { funding: null, oi: null, oiHist: [], ratio: null, at: 0 }; }
      refresh().catch(e => console.warn('[derivs]', e));
    };
    run();
    timer = setInterval(run, ms);
  }

  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  return { start, stop, refresh, funding, oiRead, ratio,
    get raw() { return data; }, get symbol() { return symbol; },
    get fresh() { return Date.now() - data.at < 120000; } };
})();

window.Derivs = Derivs;
