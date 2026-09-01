// ===========================================================================
// Liquidity map and footprint, as standalone panels.
//
// These used to be drawn over the candles, where they fought the price action
// for the same pixels and were squeezed into whatever slice of the price axis
// the chart happened to be showing. On their own they get to choose their own
// scale, which is the whole point: the map fits itself to the book, so the
// liquidity fills the panel instead of hiding in a two-pixel band.
//
//   Liquidity map   time left to right, price up the side, brightness is
//                   resting size. The right-hand column is the book as it
//                   stands now; the traced line is where price actually went.
//                   Walls carrying real size are labelled with their price.
//   Footprint       the last handful of candles as columns of traded volume at
//                   each price, sell on the left of each column and buy on the
//                   right, with the point of control and the bar's delta
//                   called out underneath.
//
// Both are live only and start empty — no venue publishes historical per-level
// book state, and footprints would have to be rebuilt by replaying the trade
// archive. They fill in from the moment you switch them on.
// ===========================================================================

const MicroPanels = (() => {
  const MAX_COLS = 900;
  const COL_MS = 1000;              // one liquidity column per second
  const MAX_BARS = 60;

  const cols = [];                  // {t, mid, v:Float32Array[price,qty,...]}
  const bars = new Map();           // barTime -> Map<priceBucket,{buy,sell}>
  let tradeCursor = 0, tapeRef = null, lastCapture = 0;
  let bucket = 1;
  let running = false;
  let capTimer = null, paintTimer = null;
  let hosts = {};
  let bandPct = 0.4;                // half-height of the map, % of price
  let fpBars = 12;
  let fpMult = 0;                   // row size multiplier; 0 = pick one that fits
  let fpTick = 1;                   // resolved row size, in price
  let backfilling = false;
  let backfilledFor = null;         // `${symbol}:${tfSec}` already pulled
  let backfillNote = '';

  // ---- capture ----------------------------------------------------------
  function pairTick() {
    const live = CryptoHub.feed && CryptoHub.feed.liveBooks()[0];
    if (live && live.bestBid) return Exchanges.autoTick(live.bestBid);
    const i = window.findSymbol ? findSymbol(CryptoHub.symbol || '') : null;
    return (i && i.pip) || 0.01;
  }
  const bucketOf = (p) => Math.floor(p / bucket) * bucket;

  function capture() {
    const feed = CryptoHub.feed, tape = CryptoHub.tape;
    if (!feed || !tape) return;
    if (tapeRef !== tape) { reset(); tapeRef = tape; }

    bucket = pairTick();
    const now = Date.now();
    const live = feed.liveBooks()[0];
    if (!live || !live.bestBid) return;
    const mid = (live.bestBid + live.bestAsk) / 2;

    if (now - lastCapture >= COL_MS) {
      lastCapture = now;
      const c = feed.consolidate({ tick: bucket, depth: 400, deep: true, ...CryptoHub.view() });
      if (c && (c.bids.length || c.asks.length)) {
        const n = c.bids.length + c.asks.length;
        const flat = new Float32Array(n * 2);
        let k = 0;
        for (const l of c.bids) { flat[k++] = l.price; flat[k++] = l.qty; }
        for (const l of c.asks) { flat[k++] = l.price; flat[k++] = l.qty; }
        cols.push({ t: now / 1000, mid, v: flat });
        if (cols.length > MAX_COLS) cols.splice(0, cols.length - MAX_COLS);
      }
    }
    foldTrades(tape);
  }

  function foldTrades(tape) {
    const cs = window.ChartMgr && ChartMgr.candles;
    if (!cs || !cs.length) return;
    if (tradeCursor > tape.trades.length) tradeCursor = 0;
    for (let i = tradeCursor; i < tape.trades.length; i++) {
      const tr = tape.trades[i];
      if (!tape.inView(tr)) continue;
      const bt = barTimeFor(cs, tr.t / 1000);
      if (bt == null) continue;
      let m = bars.get(bt);
      if (!m) { m = new Map(); bars.set(bt, m); }
      const key = bucketOf(tr.price);
      let cell = m.get(key);
      if (!cell) { cell = { buy: 0, sell: 0 }; m.set(key, cell); }
      cell[tr.side] += tr.qty;
    }
    tradeCursor = tape.trades.length;
    if (bars.size > MAX_BARS) {
      const keys = [...bars.keys()].sort((a, b) => a - b);
      for (let i = 0; i < keys.length - MAX_BARS; i++) bars.delete(keys[i]);
    }
  }

  function barTimeFor(cs, tSec) {
    let lo = 0, hi = cs.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cs[mid].time <= tSec) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best < 0 ? null : cs[best].time;
  }

  function reset() {
    cols.length = 0; bars.clear(); tradeCursor = 0; lastCapture = 0;
    hb = null; backfilledFor = null; backfillNote = '';
  }

  // ---- historical backfill ----------------------------------------------
  /**
   * Pull recent prints so the footprint opens with real bars.
   *
   * Without this the panel only knows what has traded since you connected,
   * which on a quiet minute is one column of almost nothing — the reason it
   * read as meaningless. Binance serves aggregated trades a thousand at a
   * time; BTC prints roughly two thousand a minute, so the work is bounded by
   * a request budget rather than a bar count, and whatever fits is what you
   * get. The panel says how far back it actually reached.
   */
  async function backfill() {
    const cs = window.ChartMgr && ChartMgr.candles;
    const sym = CryptoHub.symbol;
    if (!cs || cs.length < 2 || !sym || backfilling) return;
    const tfSec = cs[cs.length - 1].time - cs[cs.length - 2].time;
    const key = sym + ':' + tfSec + ':' + ((window.CryptoHub && CryptoHub.market) || 'spot');
    if (backfilledFor === key) return;

    backfilling = true;
    backfilledFor = key;
    const MAX_CALLS = 26;
    const wantBars = Math.min(fpBars + 4, MAX_BARS);
    const from = (cs[cs.length - 1].time - (wantBars - 1) * tfSec) * 1000;

    try {
      let calls = 0, cursor = from, oldest = null, count = 0;
      const nowMs = Date.now();
      while (calls < MAX_CALLS && cursor < nowMs) {
        const mkt = (window.CryptoHub && CryptoHub.market) === 'perp' ? '&market=perp' : '';
        const url = `/api/binance/aggtrades?symbol=${sym}${mkt}&startTime=${Math.floor(cursor)}` +
                    `&endTime=${Math.floor(Math.min(cursor + 3600000, nowMs))}&limit=1000`;
        const r = await fetch(url);
        calls++;
        if (!r.ok) break;
        const rows = await r.json();
        if (!Array.isArray(rows) || !rows.length) break;

        for (const t of rows) {
          const bt = barTimeFor(cs, t.T / 1000);
          if (bt == null) continue;
          if (oldest === null || bt < oldest) oldest = bt;
          let m = bars.get(bt);
          if (!m) { m = new Map(); bars.set(bt, m); }
          const price = +t.p;
          const kk = Math.floor(price / bucket) * bucket;
          let cell = m.get(kk);
          if (!cell) { cell = { buy: 0, sell: 0 }; m.set(kk, cell); }
          // m=true means the buyer was the maker, so a seller crossed.
          cell[t.m ? 'sell' : 'buy'] += +t.q;
          count++;
        }
        cursor = rows[rows.length - 1].T + 1;
        if (rows.length < 1000 && cursor >= nowMs) break;
      }
      const covered = oldest != null
        ? Math.round((cs[cs.length - 1].time - oldest) / tfSec) + 1 : 0;
      backfillNote = count
        ? `${covered} bars backfilled` + (calls >= MAX_CALLS ? ' (request budget reached)' : '')
        : 'no history available';
    } catch (e) {
      backfillNote = 'backfill failed';
      console.warn('[footprint] backfill', e);
    } finally {
      backfilling = false;
    }
  }

  // ---- canvas helpers ---------------------------------------------------
  function fit(canvas) {
    const r = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(80, Math.round(r.width)), h = Math.max(80, Math.round(r.height));
    if (canvas.width !== w * devicePixelRatio || canvas.height !== h * devicePixelRatio) {
      canvas.width = w * devicePixelRatio;
      canvas.height = h * devicePixelRatio;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      canvas.getContext('2d').setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
    return { w, h, ctx: canvas.getContext('2d') };
  }

  const fmtQ = (q) => q >= 1000 ? (q / 1000).toFixed(1) + 'k' : q >= 1 ? q.toFixed(2) : q.toFixed(3);
  const fmtUsd = (n) => {
    const a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(0) + 'k';
    return s + '$' + a.toFixed(0);
  };
  function digits() {
    const i = window.findSymbol ? findSymbol(CryptoHub.symbol || '') : null;
    return (i && i.digits) ?? 2;
  }
  const pxs = (v, d) => Number(v).toLocaleString(undefined,
    { minimumFractionDigits: d, maximumFractionDigits: d });

  function heatColor(a) {
    const t = Math.pow(Math.min(1, a), 0.45);
    let r, g, b;
    if (t < 0.5) { const u = t / 0.5; r = 16 + u * 16; g = 44 + u * 152; b = 92 + u * 80; }
    else { const u = (t - 0.5) / 0.5; r = 32 + u * 223; g = 196 - u * 16; b = 172 - u * 132; }
    return `rgba(${r | 0},${g | 0},${b | 0},${(0.18 + t * 0.72).toFixed(3)})`;
  }

  // ---- liquidity map ----------------------------------------------------
  /**
   * Width reserved for the price axis.
   *
   * A fixed 58px is a fifth of a phone-width panel, which is a lot of the plot
   * given away to labels. Scale it with the panel and shorten the numbers when
   * the room is tight.
   */
  function axisW(canvasW, ctx, sample) {
    // Measure the label that will actually be drawn rather than guessing: a
    // five-figure index and a fraction-of-a-cent altcoin need very different
    // room, and a fixed width either clips one or wastes space on the other.
    let text = 10;
    if (ctx && sample != null) {
      const prev = ctx.font;
      ctx.font = (canvasW < 360 ? '8px' : '9px') + ' ui-monospace, monospace';
      text = ctx.measureText(sample).width;
      ctx.font = prev;
    }
    const want = Math.ceil(text) + 12;
    return Math.max(34, Math.min(Math.round(canvasW * 0.26), want));
  }

  // The map is drawn once into an offscreen buffer and then scrolled: each new
  // column is painted at the right edge and the existing image shifts left.
  // Repainting a hundred and thirty columns of cells on every frame cost about
  // 27ms, which is a quarter of a second of blocking every second.
  //
  // That only works if the vertical mapping holds still, so the price axis is
  // anchored rather than recentred on every tick, and only re-anchors — with a
  // full redraw — when price drifts far enough to threaten the edge.
  let hb = null;   // {canvas, ctx, w, h, lo, hi, rows, colW, drawn, band, peak}

  function heatBuffer(plotW, h, mid) {
    const half = mid * (bandPct / 100);
    const needsReanchor = !hb || hb.w !== plotW || hb.h !== h || hb.band !== bandPct
      || mid < hb.lo + half * 0.45 || mid > hb.hi - half * 0.45;
    if (!needsReanchor) return hb;

    const cv = (hb && hb.canvas) || document.createElement('canvas');
    cv.width = Math.max(1, plotW); cv.height = Math.max(1, h);
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    hb = {
      canvas: cv, ctx, w: plotW, h, band: bandPct,
      lo: mid - half, hi: mid + half,
      rows: Math.max(20, Math.floor(h / 2.5)),
      colW: 2, drawn: 0, peak: 1,
    };
    return hb;
  }

  /** Colour scale from a high percentile of the recent book. */
  function heatPeak() {
    const sample = [];
    const from = Math.max(0, cols.length - 120);
    for (let i = from; i < cols.length; i += 3) {
      const v = cols[i].v;
      for (let k = 1; k < v.length; k += 2) sample.push(v[k]);
    }
    if (!sample.length) return 1;
    sample.sort((x, y) => x - y);
    return sample[Math.floor(sample.length * 0.97)] || 1;
  }

  function paintColumn(buf, col, x) {
    const { ctx, rows, lo, hi, h, colW, peak } = buf;
    const step = (hi - lo) / rows;
    const rowH = h / rows;
    const acc = new Float32Array(rows);
    const v = col.v;
    for (let k = 0; k < v.length; k += 2) {
      const p = v[k];
      if (p < lo || p > hi) continue;
      acc[Math.min(rows - 1, Math.floor((p - lo) / step))] += v[k + 1];
    }
    ctx.clearRect(x, 0, colW, h);
    for (let r = 0; r < rows; r++) {
      const q = acc[r];
      if (q <= 0) continue;
      const alpha = q / peak;
      if (alpha < 0.02) continue;
      ctx.fillStyle = heatColor(alpha);
      ctx.fillRect(x, h - (r + 1) * rowH, colW + 0.5, rowH + 0.5);
    }
  }

  function drawHeat(canvas) {
    const { w, h, ctx } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!cols.length) { empty(ctx, w, h, 'Recording the book…'); return; }

    const last = cols[cols.length - 1];
    const plotW = w - axisW(w, ctx, pxs(last.mid, digits()));
    const buf = heatBuffer(plotW, h, last.mid);
    const capacity = Math.floor(plotW / buf.colW);

    // Re-anchored, or first paint: lay the whole visible history down at once.
    if (buf.drawn === 0) {
      buf.peak = heatPeak();
      // Right-aligned, same as the scrolling path: newest column at the edge,
      // history trailing off to the left. Left-aligning here and appending on
      // the right afterwards would leave a seam where the two met.
      const start = Math.max(0, cols.length - capacity);
      for (let i = start; i < cols.length; i++) {
        paintColumn(buf, cols[i], plotW - (cols.length - i) * buf.colW);
      }
      buf.drawn = cols.length;
    } else if (cols.length > buf.drawn) {
      // Scroll the image left and paint only what is new.
      const fresh = Math.min(cols.length - buf.drawn, capacity);
      const shift = fresh * buf.colW;
      buf.ctx.globalCompositeOperation = 'copy';
      buf.ctx.drawImage(buf.canvas, -shift, 0);
      buf.ctx.globalCompositeOperation = 'source-over';
      buf.peak = heatPeak();
      for (let n = 0; n < fresh; n++) {
        const col = cols[cols.length - fresh + n];
        paintColumn(buf, col, plotW - shift + n * buf.colW);
      }
      buf.drawn = cols.length;
    }

    ctx.drawImage(buf.canvas, 0, 0);

    const { lo, hi } = buf;
    const yOf = (p) => h - ((p - lo) / (hi - lo)) * h;

    // Where price actually went, over the liquidity it went through.
    const shown = Math.min(cols.length, capacity);
    const start = cols.length - shown;
    ctx.save();
    ctx.beginPath();
    for (let i = start; i < cols.length; i++) {
      const x = plotW - (cols.length - i) * buf.colW + buf.colW / 2;
      const y = yOf(cols[i].mid);
      i === start ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();

    drawWalls(ctx, w, h, plotW, last, lo, hi, yOf);
    drawAxis(ctx, w, h, plotW, lo, hi, last.mid);
  }

  /** The current book as a profile on the right, with the big levels named. */
  function drawWalls(ctx, w, h, plotW, last, lo, hi, yOf) {
    const v = last.v;
    let peak = 0;
    for (let k = 1; k < v.length; k += 2) if (v[k] > peak) peak = v[k];
    if (!peak) return;

    const d = digits();
    const walls = [];
    for (let k = 0; k < v.length; k += 2) {
      const p = v[k], q = v[k + 1];
      if (p < lo || p > hi) continue;
      const y = yOf(p);
      const bar = (q / peak) * 46;
      ctx.fillStyle = p < last.mid ? 'rgba(38,208,165,.5)' : 'rgba(242,97,92,.5)';
      ctx.fillRect(plotW - bar, y - 1, bar, 2);
      if (q > peak * 0.55) walls.push({ p, q, y });
    }

    walls.sort((a, b) => b.q - a.q);
    ctx.font = '9px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    const used = [];
    for (const wl of walls.slice(0, 6)) {
      if (used.some(y => Math.abs(y - wl.y) < 11)) continue;
      used.push(wl.y);
      const label = `${pxs(wl.p, d)}  ${fmtQ(wl.q)}`;
      const tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = 'rgba(11,13,16,.82)';
      ctx.fillRect(plotW - tw - 4, wl.y - 7, tw, 14);
      ctx.fillStyle = wl.p < last.mid ? '#26d0a5' : '#f2615c';
      ctx.fillText(label, plotW - 8, wl.y);
    }
  }

  function drawAxis(ctx, w, h, plotW, lo, hi, mid) {
    const d = digits();
    ctx.save();
    ctx.fillStyle = 'rgba(11,13,16,.9)';
    ctx.fillRect(plotW, 0, w - plotW, h);
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.beginPath(); ctx.moveTo(plotW, 0); ctx.lineTo(plotW, h); ctx.stroke();

    ctx.font = (w - plotW < 46 ? '8px' : '9px') + ' ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const steps = w < 340 ? 4 : 6;
    for (let i = 0; i <= steps; i++) {
      const p = lo + (hi - lo) * (i / steps);
      const y = h - (i / steps) * h;
      ctx.fillStyle = 'rgba(164,173,186,.6)';
      ctx.fillText(pxs(p, d), plotW + 5, Math.max(6, Math.min(h - 6, y)));
    }
    // Current price, marked the way a chart marks it.
    const ym = h - ((mid - lo) / (hi - lo)) * h;
    ctx.fillStyle = '#4dd4c0';
    ctx.fillRect(plotW, ym - 8, w - plotW, 16);
    ctx.fillStyle = '#06221d';
    ctx.fillText(pxs(mid, d), plotW + 5, ym);
    ctx.restore();
  }

  function empty(ctx, w, h, msg) {
    ctx.fillStyle = 'rgba(164,173,186,.5)';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, w / 2, h / 2);
    ctx.textAlign = 'left';
  }

  // ---- footprint --------------------------------------------------------
  /**
   * Row size for the footprint.
   *
   * One row per exchange tick is unreadable on anything but the fastest chart,
   * and a fixed size is wrong for every other pair. Unless the size is pinned,
   * pick the smallest multiple of the pair's tick that keeps the bar's whole
   * range inside a sensible number of rows.
   */
  function resolveFpTick(range, gridH) {
    if (fpMult > 0) return bucket * fpMult;
    const maxRows = Math.max(8, Math.min(48, Math.floor(gridH / 11)));
    let mult = 1;
    while (range / (bucket * mult) > maxRows && mult < 100000) {
      mult = mult === 1 ? 2 : mult === 2 ? 5 : mult * 2;
    }
    return bucket * mult;
  }

  function drawFoot(canvas) {
    const { w, h, ctx } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    const keys = [...bars.keys()].sort((a, b) => a - b).slice(-fpBars);
    if (!keys.length) {
      empty(ctx, w, h, backfilling ? 'Loading recent prints...' : 'Waiting for prints...');
      return;
    }

    const cs = window.ChartMgr && ChartMgr.candles;
    const candleAt = new Map();
    if (cs) for (let i = cs.length - 1, n = 0; i >= 0 && n < 400; i--, n++) candleAt.set(cs[i].time, cs[i]);

    const footH = 34;                       // summary strip along the bottom
    const gridH = h - footH;

    // Price window: the range these bars actually traded, padded a little.
    let lo = Infinity, hi = -Infinity;
    for (const k of keys) for (const p of bars.get(k).keys()) {
      if (p < lo) lo = p; if (p > hi) hi = p;
    }
    if (!isFinite(lo)) { empty(ctx, w, h, 'Waiting for prints...'); return; }
    const plotW = w - axisW(w, ctx, pxs(hi, digits()));

    const tick = resolveFpTick(hi - lo + bucket, gridH);
    fpTick = tick;
    lo = Math.floor(lo / tick) * tick - tick;
    hi = Math.ceil(hi / tick) * tick + tick;
    const rows = Math.max(1, Math.round((hi - lo) / tick));
    const rowH = gridH / rows;

    const colW = Math.min(plotW / keys.length, 190);
    const originX = plotW - colW * keys.length;
    const d = digits();
    const numbers = colW >= 76 && rowH >= 10;

    // Re-bucket each bar to the display tick.
    const shown = keys.map(k => {
      const src = bars.get(k);
      const m = new Map();
      let vol = 0, buy = 0, sell = 0;
      for (const [p, c] of src) {
        const key = Math.floor(p / tick) * tick;
        let cell = m.get(key);
        if (!cell) { cell = { buy: 0, sell: 0 }; m.set(key, cell); }
        cell.buy += c.buy; cell.sell += c.sell;
        vol += c.buy + c.sell; buy += c.buy; sell += c.sell;
      }
      let poc = null, pocV = 0;
      for (const [p, c] of m) { const t = c.buy + c.sell; if (t > pocV) { pocV = t; poc = p; } }
      return { t: k, m, vol, buy, sell, poc, candle: candleAt.get(k) };
    });

    let peak = 0;
    for (const b of shown) for (const c of b.m.values()) peak = Math.max(peak, c.buy, c.sell);
    if (!peak) peak = 1;

    ctx.font = '9px ui-monospace, monospace';
    ctx.textBaseline = 'middle';

    const yOf = (p) => gridH - ((p - lo) / tick) * rowH - rowH;

    shown.forEach((b, ci) => {
      const x0 = originX + ci * colW;
      const cellW = colW - 2;

      // The candle, so the volume is read against the price action that made
      // it rather than floating free.
      if (b.candle) {
        const cw = Math.max(3, Math.min(11, colW * 0.13));
        const cx = x0 + cw / 2 + 2;
        const yH = yOf(b.candle.high) + rowH / 2, yL = yOf(b.candle.low) + rowH / 2;
        const yO = yOf(b.candle.open) + rowH / 2, yC = yOf(b.candle.close) + rowH / 2;
        const up = b.candle.close >= b.candle.open;
        ctx.strokeStyle = up ? 'rgba(38,208,165,.55)' : 'rgba(242,97,92,.55)';
        ctx.fillStyle = up ? 'rgba(38,208,165,.28)' : 'rgba(242,97,92,.28)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, yH); ctx.lineTo(cx, yL); ctx.stroke();
        ctx.fillRect(cx - cw / 2, Math.min(yO, yC), cw, Math.max(1, Math.abs(yC - yO)));
        ctx.strokeRect(cx - cw / 2, Math.min(yO, yC), cw, Math.max(1, Math.abs(yC - yO)));
      }

      const gx0 = x0 + Math.max(14, colW * 0.16);       // grid starts right of the candle
      const gw = x0 + cellW - gx0;
      const midX = gx0 + gw / 2;

      for (const [price, c] of b.m) {
        const y = yOf(price);
        if (y < -rowH || y > gridH) continue;
        const cellH = Math.max(1, rowH - 1);
        const tot = c.buy + c.sell;

        // Shade the two halves by how much traded there.
        ctx.fillStyle = 'rgba(242,97,92,' + (0.06 + 0.34 * (c.sell / peak)).toFixed(3) + ')';
        ctx.fillRect(gx0, y, gw / 2, cellH);
        ctx.fillStyle = 'rgba(38,208,165,' + (0.06 + 0.34 * (c.buy / peak)).toFixed(3) + ')';
        ctx.fillRect(midX, y, gw / 2, cellH);

        if (price === b.poc) {
          ctx.strokeStyle = 'rgba(240,180,94,.8)';
          ctx.lineWidth = 1;
          ctx.strokeRect(gx0 + 0.5, y + 0.5, gw - 1, cellH - 1);
        }

        // Diagonal imbalance, the way a footprint is actually read: buying at
        // this price against selling one row below it. A lopsided pair means
        // one side was willing to pay through and the other was not.
        const below = b.m.get(+(price - tick).toFixed(10));
        const above = b.m.get(+(price + tick).toFixed(10));
        const IMB = 3;
        if (below && c.buy >= Math.max(below.sell * IMB, peak * 0.05)) {
          ctx.fillStyle = 'rgba(38,208,165,.95)';
          ctx.fillRect(gx0 + gw - 3, y + 1, 3, cellH - 2);
        }
        if (above && c.sell >= Math.max(above.buy * IMB, peak * 0.05)) {
          ctx.fillStyle = 'rgba(242,97,92,.95)';
          ctx.fillRect(gx0, y + 1, 3, cellH - 2);
        }

        if (numbers) {
          ctx.fillStyle = 'rgba(238,241,246,.82)';
          ctx.textAlign = 'right'; ctx.fillText(fmtQ(c.sell), midX - 4, y + cellH / 2);
          ctx.textAlign = 'left';  ctx.fillText(fmtQ(c.buy), midX + 4, y + cellH / 2);
        } else if (tot > peak * 0.35) {
          ctx.fillStyle = 'rgba(238,241,246,.5)';
          ctx.textAlign = 'center'; ctx.fillText(fmtQ(tot), midX, y + cellH / 2);
        }
      }

      // Summary: delta, then total volume, then the clock.
      const delta = b.buy - b.sell;
      ctx.fillStyle = delta >= 0 ? 'rgba(38,208,165,.16)' : 'rgba(242,97,92,.16)';
      ctx.fillRect(x0 + 1, gridH + 2, cellW, footH - 4);
      ctx.textAlign = 'center';
      ctx.fillStyle = delta >= 0 ? '#26d0a5' : '#f2615c';
      ctx.fillText((delta >= 0 ? '+' : '-') + fmtQ(Math.abs(delta)), x0 + cellW / 2, gridH + 11);
      ctx.fillStyle = 'rgba(164,173,186,.75)';
      ctx.fillText('v ' + fmtQ(b.vol), x0 + cellW / 2, gridH + 22);
      ctx.fillStyle = 'rgba(164,173,186,.45)';
      ctx.fillText(new Date(b.t * 1000).toTimeString().slice(0, 5), x0 + cellW / 2, gridH + 31);
    });

    // Price axis
    ctx.save();
    ctx.fillStyle = 'rgba(11,13,16,.9)';
    ctx.fillRect(plotW, 0, w - plotW, h);
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.beginPath(); ctx.moveTo(plotW, 0); ctx.lineTo(plotW, h); ctx.stroke();
    ctx.textAlign = 'left';
    const stepRow = Math.max(1, Math.ceil(11 / rowH));
    for (let r = 0; r < rows; r += stepRow) {
      const p = lo + r * tick;
      const y = gridH - r * rowH - rowH / 2;
      if (y < 6 || y > gridH - 2) continue;
      ctx.fillStyle = 'rgba(164,173,186,.6)';
      ctx.fillText(pxs(p, d), plotW + 5, y);
    }
    ctx.restore();
  }

  // ---- lifecycle --------------------------------------------------------
  function paint() {
    if (hosts.heat) drawHeat(hosts.heat);
    if (hosts.foot) { backfill(); drawFoot(hosts.foot); }
  }

  // Recording is deliberately separate from being on screen. The signal engine
  // reads the same book history and footprint, and it would be wrong for its
  // view of the market to depend on whether a panel happens to be visible.
  const recorders = new Set();

  function startRecording(who) {
    recorders.add(who);
    if (running) return;
    running = true;
    CryptoHub.acquire('micropanels');
    capTimer = setInterval(capture, 200);
  }

  function stopRecording(who) {
    recorders.delete(who);
    if (recorders.size) return;
    running = false;
    if (capTimer) { clearInterval(capTimer); capTimer = null; }
    CryptoHub.release('micropanels');
  }

  function mount(map) {
    hosts = map || {};
    startRecording('panels');
    if (!paintTimer) paintTimer = setInterval(paint, 250);
    paint();
  }

  function unmount() {
    if (paintTimer) { clearInterval(paintTimer); paintTimer = null; }
    stopRecording('panels');
    hosts = {};
  }

  function setBand(pct) { bandPct = pct; hb = null; paint(); }
  function setBars(n) { fpBars = n; backfilledFor = null; paint(); }
  function setFpMult(m) { fpMult = m; paint(); }
  function onSymbolChange() { reset(); tapeRef = CryptoHub.tape; paint(); }
  /** Switching spot/perp changes which prints count, so start the bars over. */
  function onMarketChange() { bars.clear(); tradeCursor = 0; backfilledFor = null; paint(); }
  function status() {
    return {
      cols: cols.length,
      seconds: cols.length ? Math.round(cols[cols.length - 1].t - cols[0].t) : 0,
      bars: bars.size,
      backfill: backfillNote,
      tick: fpTick,
    };
  }

  return {
    mount, unmount, paint, setBand, setBars, setFpMult,
    onSymbolChange, onMarketChange, status,
    startRecording, stopRecording, backfill,
    get bandPct() { return bandPct; }, get fpBars() { return fpBars; },
    get fpTick() { return fpTick; }, get backfillNote() { return backfillNote; },
    // Read-only views for the signal engine.
    get bars() { return bars; },
    get cols() { return cols; },
    get bucket() { return bucket; },
  };
})();

window.MicroPanels = MicroPanels;
