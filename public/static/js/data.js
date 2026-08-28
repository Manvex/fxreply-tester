// ===========================================================================
// Data layer: Dukascopy .bi5 (LZMA) + Binance klines, with caching & aggregation
// Candle format everywhere: { time (unix sec UTC), open, high, low, close, volume }
// ===========================================================================

const DataStore = (() => {
  const cache = new Map(); // key -> Promise<candles[]>

  // ---------- LZMA decompress (patched lzma.js returns raw signed bytes) ----------
  function lzmaDecompress(u8) {
    return new Promise((resolve, reject) => {
      // library wants signed byte array
      const signed = new Int8Array(u8.buffer, u8.byteOffset, u8.byteLength);
      LZMA.decompress(signed, (res, err) => {
        if (err || res === null) return reject(err || new Error('lzma failed'));
        // res: array of signed bytes
        const out = new Uint8Array(res.length);
        for (let i = 0; i < res.length; i++) out[i] = res[i] & 0xff;
        resolve(out);
      });
    });
  }

  function parseBi5(bytes, baseEpochSec, factor) {
    const n = Math.floor(bytes.length / 24);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 24);
    const out = [];
    for (let i = 0; i < n; i++) {
      const off = i * 24;
      const t = dv.getUint32(off);       // seconds offset from base
      const o = dv.getUint32(off + 4) / factor;
      const c = dv.getUint32(off + 8) / factor;
      const l = dv.getUint32(off + 12) / factor;
      const h = dv.getUint32(off + 16) / factor;
      const v = dv.getFloat32(off + 20);
      if (o === 0 && c === 0) continue;
      out.push({ time: baseEpochSec + t, open: o, high: h, low: l, close: c, volume: v });
    }
    return out;
  }

  async function fetchBi5(path, baseEpochSec, factor) {
    const key = 'duka:' + path;
    if (cache.has(key)) return cache.get(key);
    const p = (async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const r = await fetch('/api/duka/' + path);
          if (r.status === 204) return [];               // no data (weekend/holiday)
          if (!r.ok) throw new Error('http ' + r.status);
          const buf = new Uint8Array(await r.arrayBuffer());
          if (buf.length === 0) return [];
          const raw = await lzmaDecompress(buf);
          return parseBi5(raw, baseEpochSec, factor);
        } catch (e) {
          if (attempt === 4) { console.warn('duka fail', path, e); return []; }
          await new Promise(res => setTimeout(res, 700 * (attempt + 1)));
        }
      }
      return [];
    })();
    cache.set(key, p);
    return p;
  }

  const pad = (x) => String(x).padStart(2, '0');

  // Fetch one UTC day of M1 candles for a duka symbol
  function dukaDayM1(dukaSym, factor, y, m, d) {
    const base = Date.UTC(y, m, d) / 1000;
    return fetchBi5(`${dukaSym}/${y}/${pad(m)}/${pad(d)}/BID_candles_min_1.bi5`, base, factor);
  }
  // Fetch one month of H1
  function dukaMonthH1(dukaSym, factor, y, m) {
    const base = Date.UTC(y, m, 1) / 1000;
    return fetchBi5(`${dukaSym}/${y}/${pad(m)}/BID_candles_hour_1.bi5`, base, factor);
  }
  // Fetch one year of D1
  function dukaYearD1(dukaSym, factor, y) {
    const base = Date.UTC(y, 0, 1) / 1000;
    return fetchBi5(`${dukaSym}/${y}/BID_candles_day_1.bi5`, base, factor);
  }

  // ---------- aggregation ----------
  const TF_SEC = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 };

  function aggregate(candles, tfSec) {
    if (!candles.length) return [];
    const out = [];
    let cur = null;
    for (const c of candles) {
      let bucket;
      if (tfSec === 604800) {
        // weeks anchored to Monday 00:00 UTC (epoch Thu -> +4 days shift = Monday-aligned)
        bucket = Math.floor((c.time - 345600) / 604800) * 604800 + 345600;
      } else {
        bucket = Math.floor(c.time / tfSec) * tfSec;
      }
      if (!cur || cur.time !== bucket) {
        if (cur) out.push(cur);
        cur = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
      } else {
        cur.high = Math.max(cur.high, c.high);
        cur.low = Math.min(cur.low, c.low);
        cur.close = c.close;
        cur.volume += c.volume;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  // parallel fetch with limited concurrency
  async function pooled(jobs, limit, onProgress) {
    const results = new Array(jobs.length);
    let idx = 0, done = 0;
    async function worker() {
      while (idx < jobs.length) {
        const my = idx++;
        results[my] = await jobs[my]();
        done++;
        if (onProgress) onProgress(done / jobs.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
    return results;
  }

  // Fetch a whole month as M1 by day files, aggregated to H1
  async function dukaMonthViaM1(dukaSym, factor, y, m, untilSec) {
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const jobs = [];
    for (let dd = 1; dd <= daysInMonth; dd++) {
      const t = Date.UTC(y, m, dd) / 1000;
      if (t > untilSec) break;
      const dow = new Date(t * 1000).getUTCDay();
      if (dow === 6) continue; // Saturday closed
      jobs.push(() => dukaDayM1(dukaSym, factor, y, m, dd));
    }
    const chunks = await pooled(jobs, 3, null);
    const all = [].concat(...chunks).sort((a, b) => a.time - b.time);
    return aggregate(all, 3600);
  }

  // NOTE: Dukascopy only publishes hour-month files for COMPLETED months and
  // day-year files for COMPLETED years. For the current month/year we fall
  // back to finer granularity files and aggregate.
  const NOW = () => Math.floor(Date.now() / 1000);

  // ---------- Dukascopy loader ----------
  // Chooses source granularity based on requested TF to limit request count.
  async function loadDuka(symInfo, tf, fromSec, toSec, onProgress) {
    const dukaSym = symInfo.duka || symInfo.sym;
    const factor = symInfo.factor;
    const tfSec = TF_SEC[tf];
    const jobs = [];
    const now = NOW();
    const curY = new Date(now * 1000).getUTCFullYear();
    const curM = new Date(now * 1000).getUTCMonth();

    if (tfSec < 3600) {
      // need M1 day files
      const start = new Date(fromSec * 1000);
      let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
      while (d.getTime() / 1000 <= toSec) {
        const y = d.getUTCFullYear(), m = d.getUTCMonth(), dd = d.getUTCDate();
        const dow = d.getUTCDay();
        // skip Saturdays entirely for non-crypto (market closed); Sunday has evening open
        if (dow !== 6) jobs.push(() => dukaDayM1(dukaSym, factor, y, m, dd));
        d = new Date(d.getTime() + 86400000);
      }
    } else if (tfSec < 86400) {
      // H1 month files (fallback to M1 aggregation for the current month)
      const start = new Date(fromSec * 1000);
      let y = start.getUTCFullYear(), m = start.getUTCMonth();
      const endD = new Date(toSec * 1000);
      const endY = endD.getUTCFullYear(), endM = endD.getUTCMonth();
      while (y < endY || (y === endY && m <= endM)) {
        const yy = y, mm = m;
        if (yy === curY && mm === curM) jobs.push(() => dukaMonthViaM1(dukaSym, factor, yy, mm, toSec));
        else jobs.push(() => dukaMonthH1(dukaSym, factor, yy, mm));
        m++; if (m > 11) { m = 0; y++; }
      }
    } else {
      // D1 year files (fallback to H1 months for the current year)
      const y0 = new Date(fromSec * 1000).getUTCFullYear();
      const y1 = new Date(toSec * 1000).getUTCFullYear();
      for (let y = y0; y <= y1; y++) {
        const yy = y;
        if (yy === curY) {
          for (let mm = 0; mm <= curM; mm++) {
            const m2 = mm;
            if (m2 === curM) jobs.push(() => dukaMonthViaM1(dukaSym, factor, yy, m2, toSec));
            else jobs.push(() => dukaMonthH1(dukaSym, factor, yy, m2));
          }
        } else {
          jobs.push(() => dukaYearD1(dukaSym, factor, yy));
        }
      }
    }

    const chunks = await pooled(jobs, 3, onProgress);
    let all = [].concat(...chunks);
    all.sort((a, b) => a.time - b.time);
    all = all.filter(c => c.time >= fromSec && c.time <= toSec);
    // dedupe (fallback paths could overlap at boundaries)
    const dedup = [];
    for (const c of all) {
      if (dedup.length && dedup[dedup.length - 1].time === c.time) continue;
      dedup.push(c);
    }
    all = dedup;

    const srcTf = tfSec < 3600 ? 60 : (tfSec < 86400 ? 3600 : 86400);
    if (tfSec === srcTf && tfSec < 86400) return all;
    return aggregate(all, tfSec);
  }

  // ---------- Binance loader ----------
  async function loadBinance(symInfo, tf, fromSec, toSec, onProgress) {
    // Binance supports our TFs natively except we aggregate 1w ourselves for consistency
    const native = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w' }[tf];
    const out = [];
    let start = fromSec * 1000;
    const endMs = toSec * 1000;
    const tfMs = TF_SEC[tf] * 1000;
    const totalSpan = Math.max(1, endMs - start);
    let guard = 0;
    while (start < endMs && guard++ < 600) {
      const p = new URLSearchParams({ symbol: symInfo.sym, interval: native, limit: '1000', startTime: String(start), endTime: String(endMs) });
      const r = await fetch('/api/binance/klines?' + p);
      if (!r.ok) break;
      const rows = await r.json();
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const k of rows) {
        out.push({ time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });
      }
      const last = rows[rows.length - 1][0];
      start = last + tfMs;
      if (onProgress) onProgress(Math.min(1, (start - fromSec * 1000) / totalSpan));
      if (rows.length < 1000) break;
    }
    return out.filter(c => c.time >= fromSec && c.time <= toSec);
  }

  async function load(symName, tf, fromSec, toSec, onProgress) {
    const info = getSymbol(symName);
    if (!info) throw new Error('unknown symbol ' + symName);
    if (info.source === 'binance') return loadBinance(info, tf, fromSec, toSec, onProgress);
    return loadDuka(info, tf, fromSec, toSec, onProgress);
  }

  // Load M1 base data (used by replay & backtest fills for intrabar precision on duka)
  return { load, aggregate, TF_SEC };
})();

window.DataStore = DataStore;
