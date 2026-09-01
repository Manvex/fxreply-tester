// ===========================================================================
// Microstructure layer: real bid/ask from tick data + depth-based slippage.
//
// What this module can and cannot do, stated plainly because it matters:
//
//   * Dukascopy publishes hourly TICK files (bid, ask, bidVolume, askVolume)
//     for every FX / CFD instrument. That is a real top-of-book quote at
//     millisecond resolution — L1 only. There is no per-level ladder.
//   * Binance archives `bookDepth`: cumulative resting notional at +/-1..5%
//     from mid, once a minute, for USD-M futures. That is enough to size
//     slippage against real liquidity, and not enough to place an order in a
//     queue.
//   * Full L2 book state (every price level, every update) is not published
//     free by either venue. Queue-position simulation for limit orders is
//     therefore out of reach here, and this module does not pretend otherwise.
//
// So: entries and exits get priced at the quote that actually existed, and
// order size pays for the liquidity it actually consumed. That is the honest
// ceiling on free data, and it is a long way above a constant spread.
// ===========================================================================

const BookStore = (() => {

  // ---------------------------------------------------------------------
  // Dukascopy hourly tick files
  // Wire format, 20 bytes per tick, big-endian:
  //   uint32  ms offset from the hour base
  //   uint32  ask * factor
  //   uint32  bid * factor
  //   float32 ask volume (millions of base units)
  //   float32 bid volume
  // ---------------------------------------------------------------------
  const tickCache = new Map();   // 'SYM/hourEpoch'   -> Promise<tick[]>
  const depthCache = new Map();  // 'SYM/YYYY-MM-DD'  -> Promise<payload|null>

  let filesFetched = 0;
  const FILE_BUDGET = 500;       // hard ceiling per refinement run

  function lzmaDecompress(u8) {
    return new Promise((resolve, reject) => {
      const signed = new Int8Array(u8.buffer, u8.byteOffset, u8.byteLength);
      LZMA.decompress(signed, (res, err) => {
        if (err || res === null) return reject(err || new Error('lzma failed'));
        const out = new Uint8Array(res.length);
        for (let i = 0; i < res.length; i++) out[i] = res[i] & 0xff;
        resolve(out);
      });
    });
  }

  function parseTicks(bytes, hourEpochSec, factor) {
    const n = Math.floor(bytes.length / 20);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 20);
    const out = new Array(n);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const off = i * 20;
      const ms = dv.getUint32(off);
      const ask = dv.getUint32(off + 4) / factor;
      const bid = dv.getUint32(off + 8) / factor;
      if (ask === 0 || bid === 0) continue;
      out[k++] = {
        t: hourEpochSec + ms / 1000,
        bid, ask,
        askVol: dv.getFloat32(off + 12),
        bidVol: dv.getFloat32(off + 16),
      };
    }
    out.length = k;
    return out;
  }

  const pad = (x) => String(x).padStart(2, '0');

  // One hour of ticks for a Dukascopy symbol. hourEpochSec must be hour-aligned.
  // NOTE: Dukascopy months are 0-based in its path scheme, same as the candle
  // endpoints already used by DataStore.
  function loadTickHour(symInfo, hourEpochSec) {
    const dukaSym = symInfo.duka || symInfo.sym;
    const key = dukaSym + '/' + hourEpochSec;
    if (tickCache.has(key)) return tickCache.get(key);
    if (filesFetched >= FILE_BUDGET) return Promise.resolve([]);
    filesFetched++;

    const d = new Date(hourEpochSec * 1000);
    const path = `${dukaSym}/${d.getUTCFullYear()}/${pad(d.getUTCMonth())}/${pad(d.getUTCDate())}/${pad(d.getUTCHours())}h_ticks.bi5`;

    const p = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch('/api/duka/' + path);
          if (r.status === 204) return [];                 // market closed
          if (!r.ok) throw new Error('http ' + r.status);
          const buf = new Uint8Array(await r.arrayBuffer());
          if (buf.length === 0) return [];
          return parseTicks(await lzmaDecompress(buf), hourEpochSec, symInfo.factor);
        } catch (e) {
          if (attempt === 2) { console.warn('[book] tick fail', path, e); return []; }
          await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
        }
      }
      return [];
    })();
    tickCache.set(key, p);
    return p;
  }

  // ---------------------------------------------------------------------
  // Binance bookDepth (one archive per UTC day)
  // ---------------------------------------------------------------------
  function loadDepthDay(symInfo, dayStartSec) {
    const d = new Date(dayStartSec * 1000);
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const key = symInfo.sym + '/' + date;
    if (depthCache.has(key)) return depthCache.get(key);
    if (filesFetched >= FILE_BUDGET) return Promise.resolve(null);
    filesFetched++;

    const p = (async () => {
      try {
        const r = await fetch(`/api/binance/bookdepth?symbol=${symInfo.sym}&date=${date}`);
        if (!r.ok) return null;
        const j = await r.json();
        if (!j.snaps || !j.snaps.length) return null;
        return j;
      } catch (e) {
        console.warn('[book] depth fail', key, e);
        return null;
      }
    })();
    depthCache.set(key, p);
    return p;
  }

  // Binary search: index of the last entry with t <= target, or -1.
  function findLE(arr, target, tOf) {
    let lo = 0, hi = arr.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tOf(arr[mid]) <= target) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  }

  // ---------------------------------------------------------------------
  // Slippage from archived depth.
  //
  // bookDepth gives cumulative notional resting within 1..5% of mid. We treat
  // the cumulative curve as piecewise linear in (notional -> distance) and read
  // off how far an order of a given notional has to walk. It is calibrated
  // exactly at the five archived band edges and interpolated between them.
  // Orders larger than the deepest archived band are extrapolated at the
  // outermost slope and flagged, because past 5% the archive no longer
  // constrains the answer.
  // ---------------------------------------------------------------------
  function slipPctFromDepth(snapRow, levels, notional, dir) {
    // dir > 0 (buying) consumes the ask side: the positive percentage bands.
    const wanted = dir > 0 ? [1, 2, 3, 4, 5] : [-1, -2, -3, -4, -5];
    const cum = wanted.map(p => snapRow[1 + levels.indexOf(p)] || 0);
    if (!cum[0]) return { pct: 0, beyondBook: false };

    let prevC = 0, prevD = 0;
    for (let i = 0; i < cum.length; i++) {
      const c = cum[i], dist = i + 1;
      if (notional <= c) {
        const span = c - prevC;
        const f = span > 0 ? (notional - prevC) / span : 0;
        return { pct: prevD + f * (dist - prevD), beyondBook: false };
      }
      prevC = c; prevD = dist;
    }
    const lastSpan = cum[4] - cum[3];
    const extra = lastSpan > 0 ? (notional - cum[4]) / lastSpan : 0;
    return { pct: 5 + extra, beyondBook: true };
  }

  // ---------------------------------------------------------------------
  // A book bound to one symbol, preloaded over the moments you actually need.
  // ---------------------------------------------------------------------
  class Book {
    constructor(symInfo) {
      this.info = symInfo;
      this.kind = symInfo.source === 'binance' ? 'depth' : 'tick';
      this.hours = new Map();   // hourEpoch -> tick[]
      this.days = new Map();    // dayEpoch  -> depth payload
      this.misses = 0;
      this.hits = 0;
      this.truncated = false;   // hit the file budget, results are partial
    }

    // Load every hour (tick) or day (depth) covering the given [from,to] spans.
    async preload(spans, onProgress) {
      const need = new Set();
      const unit = this.kind === 'tick' ? 3600 : 86400;
      for (const [from, to] of spans) {
        const a = Math.floor(from / unit) * unit;
        // Spans end on a bar boundary and are read just *inside* it, so a span
        // ending exactly on the hour must not drag in the next hour's file.
        const b = Math.max(a, Math.floor((to - 0.001) / unit) * unit);
        for (let t = a; t <= b; t += unit) need.add(t);
      }
      const list = [...need].sort((a, b) => a - b);
      if (list.length > FILE_BUDGET) { this.truncated = true; list.length = FILE_BUDGET; }

      let done = 0, idx = 0;
      const CONCURRENCY = 4;
      const worker = async () => {
        while (idx < list.length) {
          const t = list[idx++];
          if (this.kind === 'tick') {
            const ticks = await loadTickHour(this.info, t);
            if (ticks.length) this.hours.set(t, ticks);
          } else {
            const dep = await loadDepthDay(this.info, t);
            if (dep) this.days.set(t, dep);
          }
          done++;
          if (onProgress) onProgress(done / list.length);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
      return this;
    }

    // The real quote at an instant. null when no tick data covers it.
    quoteAt(timeSec) {
      if (this.kind !== 'tick') return null;
      const ticks = this.hours.get(Math.floor(timeSec / 3600) * 3600);
      if (!ticks || !ticks.length) { this.misses++; return null; }
      const i = findLE(ticks, timeSec, t => t.t);
      if (i < 0) { this.misses++; return null; }
      this.hits++;
      return ticks[i];
    }

    // First tick inside [from,to] satisfying `test`. Used to price stops at the
    // tick that actually took them out — gap and all.
    firstTouch(fromSec, toSec, test) {
      if (this.kind !== 'tick') return null;
      for (let h = Math.floor(fromSec / 3600) * 3600; h <= toSec; h += 3600) {
        const ticks = this.hours.get(h);
        if (!ticks) continue;
        let i = findLE(ticks, fromSec, t => t.t);
        if (i < 0) i = 0;
        for (; i < ticks.length; i++) {
          const tk = ticks[i];
          if (tk.t < fromSec) continue;
          if (tk.t > toSec) return null;
          if (test(tk)) return tk;
        }
      }
      return null;
    }

    // Price impact, in price units, for an order of `lots` around `refPrice`.
    slippage(timeSec, lots, dir, refPrice) {
      const none = { price: 0, pct: 0, beyondBook: false, known: false };
      if (this.kind !== 'depth') return none;
      const dep = this.days.get(Math.floor(timeSec / 86400) * 86400);
      if (!dep) { this.misses++; return none; }
      const i = findLE(dep.snaps, timeSec, r => r[0]);
      if (i < 0) { this.misses++; return none; }
      this.hits++;
      const notional = lots * this.info.lotUnits * refPrice;
      const { pct, beyondBook } = slipPctFromDepth(dep.snaps[i], dep.levels, notional, dir);
      return { price: refPrice * pct / 100, pct, beyondBook, known: true };
    }

    get coverage() {
      const n = this.hits + this.misses;
      return n ? this.hits / n : 0;
    }
  }

  function resetBudget() { filesFetched = 0; }

  return {
    Book, resetBudget, FILE_BUDGET,
    get filesFetched() { return filesFetched; },
  };
})();

window.BookStore = BookStore;
