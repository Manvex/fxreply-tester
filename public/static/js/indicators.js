// ===========================================================================
// Technical indicators — computed over arrays of candles or plain number series
// All return arrays aligned with input (NaN where not enough data)
// ===========================================================================
const TA = (() => {
  const NA = NaN;

  function sma(src, len) {
    const out = new Array(src.length).fill(NA);
    let sum = 0;
    for (let i = 0; i < src.length; i++) {
      sum += src[i];
      if (i >= len) sum -= src[i - len];
      if (i >= len - 1) out[i] = sum / len;
    }
    return out;
  }

  function ema(src, len) {
    const out = new Array(src.length).fill(NA);
    const k = 2 / (len + 1);
    let prev = NA;
    for (let i = 0; i < src.length; i++) {
      if (isNaN(src[i])) continue;
      if (isNaN(prev)) {
        // seed with SMA of first len values
        if (i >= len - 1) {
          let s = 0, ok = true;
          for (let j = i - len + 1; j <= i; j++) { if (isNaN(src[j])) { ok = false; break; } s += src[j]; }
          if (ok) { prev = s / len; out[i] = prev; }
        }
      } else {
        prev = src[i] * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  }

  function rma(src, len) { // Wilder's smoothing
    const out = new Array(src.length).fill(NA);
    const k = 1 / len;
    let prev = NA;
    for (let i = 0; i < src.length; i++) {
      if (isNaN(src[i])) continue;
      if (isNaN(prev)) {
        if (i >= len - 1) {
          let s = 0, ok = true;
          for (let j = i - len + 1; j <= i; j++) { if (isNaN(src[j])) { ok = false; break; } s += src[j]; }
          if (ok) { prev = s / len; out[i] = prev; }
        }
      } else {
        prev = src[i] * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  }

  function rsi(src, len) {
    const gains = new Array(src.length).fill(NA), losses = new Array(src.length).fill(NA);
    for (let i = 1; i < src.length; i++) {
      const ch = src[i] - src[i - 1];
      gains[i] = Math.max(ch, 0);
      losses[i] = Math.max(-ch, 0);
    }
    const ag = rma(gains.slice(1), len), al = rma(losses.slice(1), len);
    const out = new Array(src.length).fill(NA);
    for (let i = 1; i < src.length; i++) {
      const g = ag[i - 1], l = al[i - 1];
      if (isNaN(g) || isNaN(l)) continue;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }

  function tr(candles) {
    const out = new Array(candles.length).fill(NA);
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (i === 0) { out[i] = c.high - c.low; continue; }
      const pc = candles[i - 1].close;
      out[i] = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    }
    return out;
  }

  function atr(candles, len) { return rma(tr(candles), len); }

  function stdev(src, len) {
    const m = sma(src, len);
    const out = new Array(src.length).fill(NA);
    for (let i = len - 1; i < src.length; i++) {
      let s = 0;
      for (let j = i - len + 1; j <= i; j++) s += (src[j] - m[i]) ** 2;
      out[i] = Math.sqrt(s / len);
    }
    return out;
  }

  function bollinger(src, len, mult) {
    const mid = sma(src, len), sd = stdev(src, len);
    return {
      mid,
      upper: mid.map((v, i) => v + mult * sd[i]),
      lower: mid.map((v, i) => v - mult * sd[i]),
    };
  }

  function macd(src, fast = 12, slow = 26, signal = 9) {
    const f = ema(src, fast), s = ema(src, slow);
    const line = f.map((v, i) => v - s[i]);
    const sig = ema(line.map(v => isNaN(v) ? NA : v), signal);
    const hist = line.map((v, i) => v - sig[i]);
    return { line, signal: sig, hist };
  }

  function stochastic(candles, kLen = 14, kSmooth = 3, dLen = 3) {
    const raw = new Array(candles.length).fill(NA);
    for (let i = kLen - 1; i < candles.length; i++) {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - kLen + 1; j <= i; j++) { hh = Math.max(hh, candles[j].high); ll = Math.min(ll, candles[j].low); }
      raw[i] = hh === ll ? 50 : (candles[i].close - ll) / (hh - ll) * 100;
    }
    const k = sma(raw, kSmooth), d = sma(k, dLen);
    return { k, d };
  }

  function highest(src, len) {
    const out = new Array(src.length).fill(NA);
    for (let i = len - 1; i < src.length; i++) {
      let m = -Infinity;
      for (let j = i - len + 1; j <= i; j++) m = Math.max(m, src[j]);
      out[i] = m;
    }
    return out;
  }
  function lowest(src, len) {
    const out = new Array(src.length).fill(NA);
    for (let i = len - 1; i < src.length; i++) {
      let m = Infinity;
      for (let j = i - len + 1; j <= i; j++) m = Math.min(m, src[j]);
      out[i] = m;
    }
    return out;
  }

  function vwap(candles) {
    // session VWAP resetting each UTC day
    const out = new Array(candles.length).fill(NA);
    let cumPV = 0, cumV = 0, day = -1;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const d = Math.floor(c.time / 86400);
      if (d !== day) { day = d; cumPV = 0; cumV = 0; }
      const tp = (c.high + c.low + c.close) / 3;
      const v = c.volume || 1;
      cumPV += tp * v; cumV += v;
      out[i] = cumPV / cumV;
    }
    return out;
  }

  function crossover(a, b, i) {
    if (i < 1) return false;
    const bi = typeof b === 'number' ? b : b[i], bp = typeof b === 'number' ? b : b[i - 1];
    return !isNaN(a[i]) && !isNaN(a[i - 1]) && a[i - 1] <= bp && a[i] > bi;
  }
  function crossunder(a, b, i) {
    if (i < 1) return false;
    const bi = typeof b === 'number' ? b : b[i], bp = typeof b === 'number' ? b : b[i - 1];
    return !isNaN(a[i]) && !isNaN(a[i - 1]) && a[i - 1] >= bp && a[i] < bi;
  }

  return { sma, ema, rma, rsi, atr, tr, stdev, bollinger, macd, stochastic, highest, lowest, vwap, crossover, crossunder };
})();

window.TA = TA;

// ---------------------------------------------------------------------------
// Indicator registry for chart overlay UI
// ---------------------------------------------------------------------------
window.INDICATOR_DEFS = [
  { id: 'sma20', color: '#ffb74d', desc: 'Simple moving average of the last 20 closes. Fast trend reference.', name: 'SMA 20', pane: 'main', calc: (c) => [{ label: 'SMA 20', color: '#ffb74d', data: TA.sma(c.map(x => x.close), 20) }] },
  { id: 'sma50', color: '#4fc3f7', desc: 'Simple moving average of 50 closes. Medium-term trend filter.', name: 'SMA 50', pane: 'main', calc: (c) => [{ label: 'SMA 50', color: '#4fc3f7', data: TA.sma(c.map(x => x.close), 50) }] },
  { id: 'sma200', color: '#ba68c8', desc: 'Simple moving average of 200 closes. The classic long-term bull/bear line.', name: 'SMA 200', pane: 'main', calc: (c) => [{ label: 'SMA 200', color: '#ba68c8', data: TA.sma(c.map(x => x.close), 200) }] },
  { id: 'ema20', color: '#fff176', desc: 'Exponential moving average, 20 periods. Reacts faster than SMA.', name: 'EMA 20', pane: 'main', calc: (c) => [{ label: 'EMA 20', color: '#fff176', data: TA.ema(c.map(x => x.close), 20) }] },
  { id: 'ema50', color: '#f06292', desc: 'Exponential moving average, 50 periods. Common trend filter for pullback entries.', name: 'EMA 50', pane: 'main', calc: (c) => [{ label: 'EMA 50', color: '#f06292', data: TA.ema(c.map(x => x.close), 50) }] },
  {
    id: 'bb', color: '#90caf9', desc: 'Bollinger Bands: 20-period mean ±2 standard deviations. Bands narrow before expansion.', name: 'Bollinger Bands (20, 2)', pane: 'main', calc: (c) => {
      const b = TA.bollinger(c.map(x => x.close), 20, 2);
      return [
        { label: 'BB Upper', color: '#787878', data: b.upper },
        { label: 'BB Mid', color: '#aaaaaa', data: b.mid },
        { label: 'BB Lower', color: '#787878', data: b.lower },
      ];
    }
  },
  { id: 'vwap', color: '#26c6da', desc: 'Volume-weighted average price, reset each session. Intraday fair-value line.', name: 'VWAP (session)', pane: 'main', calc: (c) => [{ label: 'VWAP', color: '#26c6da', data: TA.vwap(c) }] },
  { id: 'rsi', color: '#ce93d8', desc: 'Relative Strength Index, 14 periods. Above 70 = stretched up, below 30 = stretched down.', name: 'RSI 14', pane: 'sub', range: [0, 100], calc: (c) => [{ label: 'RSI 14', color: '#ce93d8', data: TA.rsi(c.map(x => x.close), 14) }] },
  {
    id: 'macd', color: '#4dd4c0', desc: 'MACD 12/26 with 9-period signal and histogram. Momentum and trend-change tool.', name: 'MACD (12, 26, 9)', pane: 'sub', calc: (c) => {
      const m = TA.macd(c.map(x => x.close));
      return [
        { label: 'MACD', color: '#4fc3f7', data: m.line },
        { label: 'Signal', color: '#ffb74d', data: m.signal },
        { label: 'Hist', color: '#888888', data: m.hist, style: 'histogram' },
      ];
    }
  },
  {
    id: 'stoch', color: '#ffd54f', desc: 'Stochastic 14/3/3. Where price sits inside its recent range.', name: 'Stochastic (14, 3, 3)', pane: 'sub', range: [0, 100], calc: (c) => {
      const s = TA.stochastic(c);
      return [
        { label: '%K', color: '#4fc3f7', data: s.k },
        { label: '%D', color: '#ff8a65', data: s.d },
      ];
    }
  },
  { id: 'atr', color: '#a5d6a7', desc: 'Average True Range, 14 periods. Volatility in price units — used for stop sizing.', name: 'ATR 14', pane: 'sub', calc: (c) => [{ label: 'ATR 14', color: '#a5d6a7', data: TA.atr(c, 14) }] },
];
