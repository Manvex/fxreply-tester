// ===========================================================================
// BlackTick — Strategy Library
// Each entry is a fully documented, runnable strategy with explicit rules.
// Fields:
//   id        unique slug
//   name      display name
//   lang      'js' | 'pine' | 'python'
//   family    'trend' | 'mean-reversion' | 'breakout' | 'momentum' | 'pattern' | 'template'
//   summary   one-line description
//   rules     { entryLong, entryShort, exit, sizing }  plain-English rules
//   markets   suggested instrument classes
//   tf        suggested timeframes
//   code      source code
// ===========================================================================

const STRATEGY_LIBRARY = [

  // =========================================================================
  // 1. EMA trend following with ATR risk — JS
  // =========================================================================
  {
    id: 'ema-trend-atr',
    name: 'EMA Trend Rider',
    lang: 'js',
    family: 'trend',
    summary: 'Trades in the direction of a fast/slow EMA cross, but only while price is on the correct side of a long-term trend filter. Stops and targets scale with volatility (ATR).',
    rules: {
      entryLong: 'EMA(20) crosses above EMA(50) AND close > EMA(200)',
      entryShort: 'EMA(20) crosses below EMA(50) AND close < EMA(200)',
      exit: 'Stop = 2 x ATR(14), Target = 3 x ATR(14). Position is also flipped on an opposite cross.',
      sizing: 'Risk-based: each trade risks a fixed % of current balance based on the stop distance.',
    },
    markets: ['Forex', 'Indices', 'Crypto'],
    tf: ['1h', '4h', '1d'],
    code: `// ===== EMA Trend Rider =====
// Trend-following with a long-term filter and volatility-scaled risk.
//
// Tunables
const FAST = 20;        // fast EMA length
const SLOW = 50;        // slow EMA length
const FILTER = 200;     // long-term trend filter
const ATR_STOP = 2.0;   // stop distance in ATR multiples
const ATR_TARGET = 3.0; // target distance in ATR multiples
const RISK_PCT = 1.0;   // % of balance risked per trade

let fast, slow, filter;

function init(candles, ctx) {
  const closes = candles.map(c => c.close);
  fast   = ctx.ta.ema(closes, FAST);
  slow   = ctx.ta.ema(closes, SLOW);
  filter = ctx.ta.ema(closes, FILTER);
}

function bar(i, candles, ctx) {
  // Wait until every series has a value.
  if (i < FILTER + 2) return;

  const c = candles[i];
  const atr = ctx.atr14[i];
  if (!isFinite(atr) || atr <= 0) return;

  const up   = ctx.ta.crossover(fast, slow, i)  && c.close > filter[i];
  const down = ctx.ta.crossunder(fast, slow, i) && c.close < filter[i];

  if (up && ctx.position() <= 0) {
    ctx.closeAll();
    const stop = c.close - ATR_STOP * atr;
    ctx.buy(ctx.riskLots(RISK_PCT, ATR_STOP * atr), stop, c.close + ATR_TARGET * atr);
  }

  if (down && ctx.position() >= 0) {
    ctx.closeAll();
    const stop = c.close + ATR_STOP * atr;
    ctx.sell(ctx.riskLots(RISK_PCT, ATR_STOP * atr), stop, c.close - ATR_TARGET * atr);
  }
}`,
  },

  // =========================================================================
  // 2. RSI mean reversion with trend filter — JS
  // =========================================================================
  {
    id: 'rsi-reversion',
    name: 'RSI Pullback Reversion',
    lang: 'js',
    family: 'mean-reversion',
    summary: 'Buys oversold dips inside an uptrend and sells overbought rallies inside a downtrend. Exits when RSI returns to its midline or the volatility stop is hit.',
    rules: {
      entryLong: 'RSI(14) < 30 AND close > SMA(200) (dip inside an uptrend)',
      entryShort: 'RSI(14) > 70 AND close < SMA(200) (rally inside a downtrend)',
      exit: 'RSI crosses back through 50, or stop at 2 x ATR(14), or target at 2.5 x ATR(14).',
      sizing: 'Risk-based, 1% of balance per trade.',
    },
    markets: ['Forex', 'Stocks', 'Indices'],
    tf: ['15m', '1h', '4h'],
    code: `// ===== RSI Pullback Reversion =====
// Counter-trend entries, but only in the direction of the bigger trend.
//
const RSI_LEN = 14;
const OVERSOLD = 30;
const OVERBOUGHT = 70;
const MIDLINE = 50;
const TREND_LEN = 200;
const ATR_STOP = 2.0;
const ATR_TARGET = 2.5;
const RISK_PCT = 1.0;

let rsi, trend;

function init(candles, ctx) {
  const closes = candles.map(c => c.close);
  rsi   = ctx.ta.rsi(closes, RSI_LEN);
  trend = ctx.ta.sma(closes, TREND_LEN);
}

function bar(i, candles, ctx) {
  if (i < TREND_LEN + 2) return;

  const c = candles[i];
  const atr = ctx.atr14[i];
  if (!isFinite(atr) || atr <= 0 || !isFinite(rsi[i])) return;

  const pos = ctx.position();

  // --- exits first: give the midline priority over new signals ---
  if (pos > 0 && rsi[i] > MIDLINE) { ctx.closeAll(); return; }
  if (pos < 0 && rsi[i] < MIDLINE) { ctx.closeAll(); return; }
  if (pos !== 0) return;   // one position at a time

  // --- entries ---
  if (rsi[i] < OVERSOLD && c.close > trend[i]) {
    ctx.buy(ctx.riskLots(RISK_PCT, ATR_STOP * atr),
            c.close - ATR_STOP * atr,
            c.close + ATR_TARGET * atr);
  }
  else if (rsi[i] > OVERBOUGHT && c.close < trend[i]) {
    ctx.sell(ctx.riskLots(RISK_PCT, ATR_STOP * atr),
             c.close + ATR_STOP * atr,
             c.close - ATR_TARGET * atr);
  }
}`,
  },

  // =========================================================================
  // 3. Donchian breakout with trailing stop — JS
  // =========================================================================
  {
    id: 'donchian-breakout',
    name: 'Donchian Breakout + Trail',
    lang: 'js',
    family: 'breakout',
    summary: 'Classic turtle-style channel breakout. Enters on a new N-bar extreme and rides the move with an ATR trailing stop instead of a fixed target.',
    rules: {
      entryLong: 'Close breaks above the highest high of the previous 20 bars',
      entryShort: 'Close breaks below the lowest low of the previous 20 bars',
      exit: 'ATR trailing stop at 2.5 x ATR(14) from the best price reached. No fixed target — the trail decides.',
      sizing: 'Risk-based, 1% of balance per trade using the initial stop distance.',
    },
    markets: ['Commodities', 'Indices', 'Crypto'],
    tf: ['4h', '1d'],
    code: `// ===== Donchian Breakout + ATR Trail =====
// Breakout entries, trailing exit. Trend-capture rather than mean reversion.
//
const CHANNEL = 20;      // lookback for the channel
const ATR_TRAIL = 2.5;   // trailing stop distance in ATR
const RISK_PCT = 1.0;

let hh, ll;
let peak = null;         // best price reached while in a position

function init(candles, ctx) {
  hh = ctx.ta.highest(candles.map(c => c.high), CHANNEL);
  ll = ctx.ta.lowest(candles.map(c => c.low), CHANNEL);
  peak = null;
}

function bar(i, candles, ctx) {
  if (i < CHANNEL + 2) return;

  const c = candles[i];
  const atr = ctx.atr14[i];
  if (!isFinite(atr) || atr <= 0) return;

  const pos = ctx.position();

  // ---- manage an open position: move the trailing stop ----
  if (pos !== 0) {
    if (pos > 0) {
      peak = peak === null ? c.high : Math.max(peak, c.high);
      ctx.setStops(peak - ATR_TRAIL * atr, null);
    } else {
      peak = peak === null ? c.low : Math.min(peak, c.low);
      ctx.setStops(peak + ATR_TRAIL * atr, null);
    }
    return;   // never add to an existing position
  }

  peak = null;

  // ---- breakout entries (compare to the channel of PREVIOUS bars) ----
  if (c.close > hh[i - 1]) {
    ctx.buy(ctx.riskLots(RISK_PCT, ATR_TRAIL * atr), c.close - ATR_TRAIL * atr, null);
    peak = c.high;
  }
  else if (c.close < ll[i - 1]) {
    ctx.sell(ctx.riskLots(RISK_PCT, ATR_TRAIL * atr), c.close + ATR_TRAIL * atr, null);
    peak = c.low;
  }
}`,
  },

  // =========================================================================
  // 4. Bollinger squeeze breakout — JS
  // =========================================================================
  {
    id: 'bb-squeeze',
    name: 'Bollinger Squeeze Break',
    lang: 'js',
    family: 'breakout',
    summary: 'Waits for volatility to contract (narrow Bollinger Bands) and then trades the first expansion in either direction — the classic squeeze-then-release pattern.',
    rules: {
      entryLong: 'Band width is in the lowest 25% of the last 100 bars AND close closes above the upper band',
      entryShort: 'Band width is in the lowest 25% of the last 100 bars AND close closes below the lower band',
      exit: 'Stop at the Bollinger midline (SMA 20) or 2 x ATR, whichever is nearer. Target = 3 x the initial risk.',
      sizing: 'Risk-based, 1% per trade.',
    },
    markets: ['Forex', 'Indices', 'Crypto'],
    tf: ['1h', '4h'],
    code: `// ===== Bollinger Squeeze Break =====
// Low volatility -> expansion. Trade the release.
//
const BB_LEN = 20;
const BB_MULT = 2.0;
const SQUEEZE_LOOKBACK = 100;   // window used to rank current band width
const SQUEEZE_PCTL = 0.25;      // "narrow" = bottom 25% of that window
const RR = 3.0;                 // reward : risk
const RISK_PCT = 1.0;

let upper, lower, mid, width;

function init(candles, ctx) {
  const closes = candles.map(c => c.close);
  const bb = ctx.ta.bollinger(closes, BB_LEN, BB_MULT);
  upper = bb.upper; lower = bb.lower; mid = bb.mid;
  width = upper.map((u, i) => (u - lower[i]) / mid[i]);   // normalised width
}

// Is the current band width in the bottom X% of its recent range?
function isSqueezed(i) {
  if (!isFinite(width[i])) return false;
  let lo = Infinity, hi = -Infinity;
  for (let j = i - SQUEEZE_LOOKBACK + 1; j <= i; j++) {
    if (!isFinite(width[j])) return false;
    lo = Math.min(lo, width[j]); hi = Math.max(hi, width[j]);
  }
  if (hi === lo) return false;
  return (width[i] - lo) / (hi - lo) <= SQUEEZE_PCTL;
}

function bar(i, candles, ctx) {
  if (i < BB_LEN + SQUEEZE_LOOKBACK + 2) return;
  if (ctx.position() !== 0) return;

  const c = candles[i];
  const atr = ctx.atr14[i];
  if (!isFinite(atr) || atr <= 0) return;
  if (!isSqueezed(i - 1)) return;   // squeeze must exist BEFORE the break

  if (c.close > upper[i]) {
    const stop = Math.max(mid[i], c.close - 2 * atr);
    const risk = c.close - stop;
    if (risk <= 0) return;
    ctx.buy(ctx.riskLots(RISK_PCT, risk), stop, c.close + RR * risk);
  }
  else if (c.close < lower[i]) {
    const stop = Math.min(mid[i], c.close + 2 * atr);
    const risk = stop - c.close;
    if (risk <= 0) return;
    ctx.sell(ctx.riskLots(RISK_PCT, risk), stop, c.close - RR * risk);
  }
}`,
  },

  // =========================================================================
  // 5. London breakout session strategy — JS
  // =========================================================================
  {
    id: 'session-breakout',
    name: 'Asia Range / London Break',
    lang: 'js',
    family: 'pattern',
    summary: 'Measures the quiet Asian session range (00:00–07:00 UTC) and trades the first break of that range during the London session. Flat before the New York close.',
    rules: {
      entryLong: 'During 07:00–16:00 UTC, price closes above the 00:00–07:00 UTC high',
      entryShort: 'During 07:00–16:00 UTC, price closes below the 00:00–07:00 UTC low',
      exit: 'Stop on the opposite side of the range, target = 1.5 x range height, and a hard time exit at 20:00 UTC.',
      sizing: 'Risk-based, 1% per trade. Only one trade per day.',
    },
    markets: ['Forex', 'Indices (GER40, UK100)'],
    tf: ['15m', '30m', '1h'],
    code: `// ===== Asia Range / London Break =====
// Intraday session strategy. Use on 15m / 30m / 1h.
//
const RANGE_START = 0;    // UTC hour: Asian range begins
const RANGE_END = 7;      // UTC hour: range closes, trading window opens
const TRADE_END = 16;     // UTC hour: no new entries after this
const FLAT_HOUR = 20;     // UTC hour: force flat
const TARGET_MULT = 1.5;  // target as a multiple of range height
const RISK_PCT = 1.0;

let dayKey = null, rHigh = -Infinity, rLow = Infinity, tradedToday = false;

function init() {
  dayKey = null; rHigh = -Infinity; rLow = Infinity; tradedToday = false;
}

function bar(i, candles, ctx) {
  const c = candles[i];
  const d = new Date(c.time * 1000);
  const hour = d.getUTCHours();
  const key = Math.floor(c.time / 86400);

  // ---- new UTC day: reset the range ----
  if (key !== dayKey) {
    dayKey = key;
    rHigh = -Infinity; rLow = Infinity; tradedToday = false;
  }

  // ---- build the Asian range ----
  if (hour >= RANGE_START && hour < RANGE_END) {
    rHigh = Math.max(rHigh, c.high);
    rLow = Math.min(rLow, c.low);
    return;
  }

  // ---- force flat late in the day ----
  if (hour >= FLAT_HOUR) { if (ctx.position() !== 0) ctx.closeAll(); return; }

  // ---- trading window ----
  if (hour < RANGE_END || hour >= TRADE_END) return;
  if (tradedToday || ctx.position() !== 0) return;
  if (!isFinite(rHigh) || !isFinite(rLow)) return;

  const height = rHigh - rLow;
  if (height <= 0) return;

  if (c.close > rHigh) {
    ctx.buy(ctx.riskLots(RISK_PCT, height), rLow, c.close + TARGET_MULT * height);
    tradedToday = true;
  }
  else if (c.close < rLow) {
    ctx.sell(ctx.riskLots(RISK_PCT, height), rHigh, c.close - TARGET_MULT * height);
    tradedToday = true;
  }
}`,
  },

  // =========================================================================
  // 6. MACD momentum — Pine
  // =========================================================================
  {
    id: 'macd-momentum-pine',
    name: 'MACD Momentum',
    lang: 'pine',
    family: 'momentum',
    summary: 'Pine Script version of a MACD histogram momentum system with an EMA trend filter and ATR-based exits.',
    rules: {
      entryLong: 'MACD line crosses above its signal line while close > EMA(200)',
      entryShort: 'MACD line crosses below its signal line while close < EMA(200)',
      exit: 'Stop = 2 x ATR(14), Limit = 3 x ATR(14); position flipped on the opposite cross.',
      sizing: 'Fixed 1 lot (Pine qty). Change `qty=` to adjust.',
    },
    markets: ['Indices', 'Forex', 'Crypto'],
    tf: ['1h', '4h', '1d'],
    code: `//@version=5
strategy("MACD Momentum", overlay=true)

// ---- inputs ----
fastLen  = input.int(12, "MACD fast")
slowLen  = input.int(26, "MACD slow")
sigLen   = input.int(9,  "MACD signal")
trendLen = input.int(200, "Trend EMA")
atrMult  = input.float(2.0, "ATR stop")
rrMult   = input.float(3.0, "ATR target")
qty      = input.float(1.0, "Lots")

// ---- series ----
macdLine = ta.ema(close, fastLen) - ta.ema(close, slowLen)
signal   = ta.ema(macdLine, sigLen)
trend    = ta.ema(close, trendLen)
atr      = ta.atr(14)

bullCross = ta.crossover(macdLine, signal)
bearCross = ta.crossunder(macdLine, signal)

longOk  = bullCross and close > trend
shortOk = bearCross and close < trend

// ---- orders ----
if longOk and strategy.position_size <= 0
    strategy.close_all()
    strategy.entry("Long", strategy.long, qty=qty)
    strategy.exit("XL", from_entry="Long", stop=close - atrMult * atr, limit=close + rrMult * atr)

if shortOk and strategy.position_size >= 0
    strategy.close_all()
    strategy.entry("Short", strategy.short, qty=qty)
    strategy.exit("XS", from_entry="Short", stop=close + atrMult * atr, limit=close - rrMult * atr)`,
  },

  // =========================================================================
  // 7. Supertrend-style ATR channel — Pine
  // =========================================================================
  {
    id: 'atr-channel-pine',
    name: 'ATR Channel Trend',
    lang: 'pine',
    family: 'trend',
    summary: 'A Supertrend-flavoured system: an ATR band trails price, and the position flips whenever price closes on the other side of the band.',
    rules: {
      entryLong: 'Close closes above the upper ATR band (band = HL2 + 3 x ATR(10))',
      entryShort: 'Close closes below the lower ATR band (band = HL2 − 3 x ATR(10))',
      exit: 'Always in the market — flips direction on the opposite band break. Protective stop = 2.5 x ATR.',
      sizing: 'Fixed 1 lot.',
    },
    markets: ['Crypto', 'Indices', 'Commodities'],
    tf: ['1h', '4h', '1d'],
    code: `//@version=5
strategy("ATR Channel Trend", overlay=true)

atrLen  = input.int(10, "ATR length")
mult    = input.float(3.0, "Band multiplier")
stopMlt = input.float(2.5, "Protective stop (ATR)")
qty     = input.float(1.0, "Lots")

atr = ta.atr(atrLen)
upperBand = hl2 + mult * atr
lowerBand = hl2 - mult * atr

// Track the band that price must break to flip direction.
var float trailUp = na
var float trailDn = na
trailUp := na(trailUp) ? lowerBand : math.max(lowerBand, trailUp)
trailDn := na(trailDn) ? upperBand : math.min(upperBand, trailDn)

goLong  = close > trailDn
goShort = close < trailUp

if goLong and strategy.position_size <= 0
    strategy.close_all()
    strategy.entry("L", strategy.long, qty=qty)
    strategy.exit("XL", from_entry="L", stop=close - stopMlt * atr)
    trailDn := upperBand
    trailUp := lowerBand

if goShort and strategy.position_size >= 0
    strategy.close_all()
    strategy.entry("S", strategy.short, qty=qty)
    strategy.exit("XS", from_entry="S", stop=close + stopMlt * atr)
    trailDn := upperBand
    trailUp := lowerBand`,
  },

  // =========================================================================
  // 8. Bollinger reversion — Pine
  // =========================================================================
  {
    id: 'bb-revert-pine',
    name: 'Bollinger Reversion',
    lang: 'pine',
    family: 'mean-reversion',
    summary: 'Fades stretched moves back to the mean: enters when price closes outside a Bollinger band and exits at the midline.',
    rules: {
      entryLong: 'Close < lower band (SMA 20 − 2σ)',
      entryShort: 'Close > upper band (SMA 20 + 2σ)',
      exit: 'Close at the SMA(20) midline. Hard stop 3 x ATR(14) to survive trending markets.',
      sizing: 'Fixed 1 lot.',
    },
    markets: ['Forex', 'Stocks'],
    tf: ['30m', '1h', '4h'],
    code: `//@version=5
strategy("Bollinger Reversion", overlay=true)

len     = input.int(20, "BB length")
mult    = input.float(2.0, "BB stdev")
stopMlt = input.float(3.0, "Stop (ATR)")
qty     = input.float(1.0, "Lots")

basis = ta.sma(close, len)
dev   = mult * ta.stdev(close, len)
upper = basis + dev
lower = basis - dev
atr   = ta.atr(14)

// ---- entries: only when flat ----
if close < lower and strategy.position_size == 0
    strategy.entry("L", strategy.long, qty=qty)
    strategy.exit("XL", from_entry="L", stop=close - stopMlt * atr)

if close > upper and strategy.position_size == 0
    strategy.entry("S", strategy.short, qty=qty)
    strategy.exit("XS", from_entry="S", stop=close + stopMlt * atr)

// ---- exits at the mean ----
if strategy.position_size > 0 and close >= basis
    strategy.close_all()

if strategy.position_size < 0 and close <= basis
    strategy.close_all()`,
  },

  // =========================================================================
  // 9. Dual momentum with volatility target — Python
  // =========================================================================
  {
    id: 'py-momentum',
    name: 'Volatility-Targeted Momentum',
    lang: 'python',
    family: 'momentum',
    summary: 'NumPy momentum system: goes long when both a short and a long lookback return are positive, and scales position size so every trade targets the same volatility.',
    rules: {
      entryLong: 'Return over 20 bars > 0 AND return over 60 bars > 0',
      entryShort: 'Return over 20 bars < 0 AND return over 60 bars < 0',
      exit: 'Flips when the two lookbacks disagree; protective stop at 3 x ATR(14).',
      sizing: 'Volatility targeting — larger size in quiet markets, smaller in wild ones.',
    },
    markets: ['Crypto', 'Indices'],
    tf: ['4h', '1d'],
    code: `# ===== Volatility-Targeted Momentum =====
# Runs in-browser through Pyodide with NumPy.
import numpy as np

SHORT_LB = 20       # short lookback (bars)
LONG_LB  = 60       # long lookback (bars)
ATR_LEN  = 14
STOP_ATR = 3.0      # protective stop, in ATR multiples
RISK_PCT = 1.0      # % of balance risked per trade

closes = highs = lows = atr = None

def _rma(x, n):
    out = np.full(len(x), np.nan)
    prev = np.nan
    for i in range(len(x)):
        if np.isnan(prev):
            if i >= n - 1:
                w = x[i - n + 1:i + 1]
                if not np.isnan(w).any():
                    prev = w.mean()
                    out[i] = prev
        else:
            prev = (x[i] + (n - 1) * prev) / n
            out[i] = prev
    return out

def init(candles, ctx):
    global closes, highs, lows, atr
    closes = np.array([c['close'] for c in candles])
    highs  = np.array([c['high'] for c in candles])
    lows   = np.array([c['low'] for c in candles])
    prev_c = np.roll(closes, 1); prev_c[0] = closes[0]
    tr = np.maximum(highs - lows,
         np.maximum(np.abs(highs - prev_c), np.abs(lows - prev_c)))
    atr = _rma(tr, ATR_LEN)

def bar(i, candles, ctx):
    if i < LONG_LB + ATR_LEN + 2:
        return
    a = atr[i]
    if not np.isfinite(a) or a <= 0:
        return

    price = closes[i]
    mom_s = price / closes[i - SHORT_LB] - 1.0
    mom_l = price / closes[i - LONG_LB] - 1.0
    pos = ctx.position()

    long_ok  = mom_s > 0 and mom_l > 0
    short_ok = mom_s < 0 and mom_l < 0

    # Volatility-targeted size: risk the same $ amount every trade.
    lots = ctx.risk_lots(RISK_PCT, STOP_ATR * a)

    if long_ok and pos <= 0:
        ctx.close_all()
        ctx.buy(lots, price - STOP_ATR * a, None)
    elif short_ok and pos >= 0:
        ctx.close_all()
        ctx.sell(lots, price + STOP_ATR * a, None)
    elif not long_ok and not short_ok and pos != 0:
        ctx.close_all()   # signals disagree -> stand aside`,
  },

  // =========================================================================
  // 10. Opening range gap fade — Python
  // =========================================================================
  {
    id: 'py-zscore',
    name: 'Z-Score Pairs-Style Fade',
    lang: 'python',
    family: 'mean-reversion',
    summary: 'Statistical mean reversion: measures how many standard deviations price sits from its rolling mean and fades extreme readings back toward it.',
    rules: {
      entryLong: 'Z-score of close vs SMA(50) < −2.0',
      entryShort: 'Z-score of close vs SMA(50) > +2.0',
      exit: 'Z-score returns inside ±0.5, or protective stop at 3 x ATR(14).',
      sizing: 'Risk-based, 1% of balance per trade.',
    },
    markets: ['Forex', 'Stocks', 'Indices'],
    tf: ['1h', '4h'],
    code: `# ===== Z-Score Mean Reversion =====
import numpy as np

LOOKBACK  = 50      # window for mean / stdev
ENTRY_Z   = 2.0     # enter when |z| exceeds this
EXIT_Z    = 0.5     # exit when |z| falls back inside this
ATR_LEN   = 14
STOP_ATR  = 3.0
RISK_PCT  = 1.0

closes = z = atr = None

def _rma(x, n):
    out = np.full(len(x), np.nan); prev = np.nan
    for i in range(len(x)):
        if np.isnan(prev):
            if i >= n - 1:
                w = x[i - n + 1:i + 1]
                if not np.isnan(w).any():
                    prev = w.mean(); out[i] = prev
        else:
            prev = (x[i] + (n - 1) * prev) / n
            out[i] = prev
    return out

def init(candles, ctx):
    global closes, z, atr
    closes = np.array([c['close'] for c in candles])
    highs  = np.array([c['high'] for c in candles])
    lows   = np.array([c['low'] for c in candles])

    n = len(closes)
    z = np.full(n, np.nan)
    for i in range(LOOKBACK - 1, n):
        w = closes[i - LOOKBACK + 1:i + 1]
        sd = w.std()
        if sd > 0:
            z[i] = (closes[i] - w.mean()) / sd

    prev_c = np.roll(closes, 1); prev_c[0] = closes[0]
    tr = np.maximum(highs - lows,
         np.maximum(np.abs(highs - prev_c), np.abs(lows - prev_c)))
    atr = _rma(tr, ATR_LEN)

def bar(i, candles, ctx):
    if i < LOOKBACK + ATR_LEN + 2:
        return
    if not np.isfinite(z[i]) or not np.isfinite(atr[i]) or atr[i] <= 0:
        return

    price = closes[i]
    pos = ctx.position()

    # ---- exits ----
    if pos != 0 and abs(z[i]) <= EXIT_Z:
        ctx.close_all()
        return
    if pos != 0:
        return

    # ---- entries ----
    lots = ctx.risk_lots(RISK_PCT, STOP_ATR * atr[i])
    if z[i] < -ENTRY_Z:
        ctx.buy(lots, price - STOP_ATR * atr[i], None)
    elif z[i] > ENTRY_Z:
        ctx.sell(lots, price + STOP_ATR * atr[i], None)`,
  },

  // =========================================================================
  // 11. Blank templates
  // =========================================================================
  {
    id: 'tmpl-js',
    name: 'Blank Template (JavaScript)',
    lang: 'js',
    family: 'template',
    summary: 'A commented starting point showing every function available in the JavaScript strategy API.',
    rules: {
      entryLong: '— (you write it)',
      entryShort: '—',
      exit: '—',
      sizing: '—',
    },
    markets: ['Any'],
    tf: ['Any'],
    code: `// ===== Blank JavaScript strategy =====
// Two optional functions:
//   init(candles, ctx)          -> runs once, precompute indicator arrays here
//   bar(i, candles, ctx)        -> runs on every bar, place orders here
//
// candles[i] = { time, open, high, low, close, volume }   time = UTC seconds
//
// ctx.ta.*        sma ema rma wma rsi atr tr stdev bollinger macd stochastic
//                 highest lowest vwap crossover(a,b,i) crossunder(a,b,i)
// ctx.atr14[i]    ATR(14) precomputed for convenience
// ctx.buy(lots, sl, tp)    open long   (sl / tp may be null)
// ctx.sell(lots, sl, tp)   open short
// ctx.closeAll()           close everything at this bar's close
// ctx.setStops(sl, tp)     modify stops on all open positions
// ctx.position()           net lots: >0 long, <0 short, 0 flat
// ctx.balance()            realised balance
// ctx.equity()             balance + floating PnL
// ctx.riskLots(pct, dist)  lots so that a 'dist' price move risks 'pct' % of balance
// ctx.symInfo              { sym, pip, lotUnits, digits, ... }
// ctx.log(...)             prints to the browser console

let myIndicator;

function init(candles, ctx) {
  const closes = candles.map(c => c.close);
  myIndicator = ctx.ta.sma(closes, 50);
}

function bar(i, candles, ctx) {
  if (i < 60) return;                  // warm-up
  const c = candles[i];

  // Example: buy when price is above the SMA and we are flat.
  if (c.close > myIndicator[i] && ctx.position() === 0) {
    const stop = c.close - 2 * ctx.atr14[i];
    ctx.buy(ctx.riskLots(1.0, c.close - stop), stop, c.close + 4 * ctx.atr14[i]);
  }
}`,
  },
  {
    id: 'tmpl-pine',
    name: 'Blank Template (Pine Script)',
    lang: 'pine',
    family: 'template',
    summary: 'Starting point listing the Pine v5 subset that BlackTick understands.',
    rules: { entryLong: '—', entryShort: '—', exit: '—', sizing: '—' },
    markets: ['Any'],
    tf: ['Any'],
    code: `//@version=5
strategy("My Strategy", overlay=true)

// ---- Supported ----
// series:     open high low close volume hl2 hlc3 ohlc4 bar_index time
// history:    close[1], myVar[3]
// inputs:     input.int / input.float / input.bool / input.string
// ta.*        sma ema rma wma rsi atr tr stdev highest lowest
//             change cross crossover crossunder
// math.*      abs min max round floor ceil sqrt pow exp log sign avg pi
// vars:       x = expr        (recomputed every bar)
//             var x = expr    (initialised once, then carried)
//             x := expr       (reassign)
// control:    if / else if / else  with indented blocks, ternary a ? b : c
// orders:     strategy.entry(id, strategy.long|strategy.short, qty=..)
//             strategy.exit(id, from_entry=.., stop=.., limit=..)
//             strategy.close(id) / strategy.close_all()
// state:      strategy.position_size, strategy.opentrades, strategy.equity
//
// plot(), plotshape(), label.new() etc. are accepted but ignored.

length = input.int(20, "Length")
ma  = ta.sma(close, length)
atr = ta.atr(14)

if ta.crossover(close, ma) and strategy.position_size == 0
    strategy.entry("L", strategy.long, qty=1)
    strategy.exit("XL", from_entry="L", stop=close - 2 * atr, limit=close + 4 * atr)

if ta.crossunder(close, ma) and strategy.position_size > 0
    strategy.close_all()`,
  },
  {
    id: 'tmpl-python',
    name: 'Blank Template (Python)',
    lang: 'python',
    family: 'template',
    summary: 'Starting point for real Python strategies running on Pyodide with NumPy available.',
    rules: { entryLong: '—', entryShort: '—', exit: '—', sizing: '—' },
    markets: ['Any'],
    tf: ['Any'],
    code: `# ===== Blank Python strategy =====
# Runs on Pyodide (CPython in WebAssembly). NumPy is preloaded.
#
#   init(candles, ctx)      optional, runs once
#   bar(i, candles, ctx)    runs on every bar
#
# candles is a list of dicts: {'time','open','high','low','close','volume'}
#
# ctx.buy(lots, sl=None, tp=None)
# ctx.sell(lots, sl=None, tp=None)
# ctx.close_all()
# ctx.set_stops(sl, tp)
# ctx.position()      net lots
# ctx.balance()       realised balance
# ctx.equity()        balance + floating PnL
# ctx.risk_lots(pct, dist)   size for a given % risk and stop distance

import numpy as np

ma = None

def init(candles, ctx):
    global ma
    closes = np.array([c['close'] for c in candles])
    ma = np.convolve(closes, np.ones(50) / 50, mode='full')[:len(closes)]
    ma[:49] = np.nan

def bar(i, candles, ctx):
    if i < 60:
        return
    price = candles[i]['close']
    if price > ma[i] and ctx.position() == 0:
        ctx.buy(1, price * 0.99, price * 1.02)
    elif price < ma[i] and ctx.position() > 0:
        ctx.close_all()`,
  },

  // =========================================================================
  // 14. News blackout trend filter — JS
  // =========================================================================
  {
    id: 'news-blackout-trend',
    name: 'News Blackout Trend',
    lang: 'js',
    family: 'news',
    summary: 'A plain EMA pullback system that simply refuses to be in the market around high-impact releases. Entries are blocked inside the blackout window and open trades are flattened before the release lands.',
    rules: {
      entryLong: 'Close > EMA(50) and the previous bar dipped below EMA(20), with no high-impact release inside the blackout window',
      entryShort: 'Close < EMA(50) and the previous bar poked above EMA(20), with no high-impact release inside the blackout window',
      exit: 'Stop = 2 x ATR(14), target = 3 x ATR(14). Any open position is closed as soon as a high-impact release comes within BEFORE_MINS.',
      sizing: 'Risk-based — each trade risks RISK_PCT of balance over the stop distance.',
    },
    markets: ['Forex', 'Indices'],
    tf: ['15m', '30m', '1h'],
    code: `// ===== News Blackout Trend =====
// Demonstrates ctx.news — the real ForexFactory economic calendar.
//
// The trading logic is deliberately simple; the point is the news filter.
// Run it twice, once with BEFORE_MINS = 0, to see how much of the equity
// curve is really just event risk.
//
const FAST = 20;
const SLOW = 50;
const ATR_STOP = 2.0;
const ATR_TARGET = 3.0;
const RISK_PCT = 1.0;
const BEFORE_MINS = 45;   // no new trades this close to a release
const AFTER_MINS  = 30;   // no new trades this soon after one

let fast, slow;

function init(candles, ctx) {
  const closes = candles.map(c => c.close);
  fast = ctx.ta.ema(closes, FAST);
  slow = ctx.ta.ema(closes, SLOW);
}

function bar(i, candles, ctx) {
  if (i < SLOW + 2) return;
  const c = candles[i];
  const atr = ctx.atr14[i];
  if (!isFinite(atr) || atr <= 0) return;

  // ---- News gate -------------------------------------------------------
  // Both helpers return Infinity when nothing matches, so a calendar that
  // failed to load degrades gracefully into "trade normally".
  const toNext    = ctx.news.minsToNext(['high']);
  const sinceLast = ctx.news.minsSinceLast(['high']);

  // Flatten before the release rather than riding the spike through it.
  if (toNext <= BEFORE_MINS) {
    if (ctx.position() !== 0) ctx.closeAll();
    return;
  }
  if (sinceLast <= AFTER_MINS) return;   // let the dust settle

  const upTrend   = c.close > slow[i];
  const downTrend = c.close < slow[i];
  const dipped = candles[i - 1].low  < fast[i - 1] && c.close > fast[i];
  const poked  = candles[i - 1].high > fast[i - 1] && c.close < fast[i];

  const dist = ATR_STOP * atr;
  const lots = ctx.riskLots(RISK_PCT, dist);
  if (lots <= 0) return;

  if (upTrend && dipped && ctx.position() <= 0) {
    ctx.closeAll();
    ctx.buy(lots, c.close - dist, c.close + ATR_TARGET * atr);
  } else if (downTrend && poked && ctx.position() >= 0) {
    ctx.closeAll();
    ctx.sell(lots, c.close + dist, c.close - ATR_TARGET * atr);
  }
}`,
  },

  // =========================================================================
  // 15. Post-release momentum — Python
  // =========================================================================
  {
    id: 'news-momentum-py',
    name: 'Post-Release Momentum',
    lang: 'python',
    family: 'news',
    summary: 'Does the opposite of the blackout system: it only trades in the minutes right after a high-impact release, following the direction of the bar that reacted to it.',
    rules: {
      entryLong: 'A high-impact release happened within WINDOW_MINS and the reaction bar closed in the upper third of its range',
      entryShort: 'A high-impact release happened within WINDOW_MINS and the reaction bar closed in the lower third of its range',
      exit: 'Stop = 1.5 x ATR(14), target = 2.5 x ATR(14). Everything is flattened once the window closes.',
      sizing: 'Risk-based — RISK_PCT of balance over the stop distance.',
    },
    markets: ['Forex', 'Indices'],
    tf: ['5m', '15m'],
    code: `# ===== Post-Release Momentum =====
# Trades only inside the reaction window after a high-impact release, using
# the real ForexFactory calendar through the ctx.news_* helpers.
#
# This is event-risk trading. On a live feed the spread widens far more than
# the fixed spread this backtester assumes, so treat any profit here as an
# optimistic upper bound, not a tradable edge.
import numpy as np

WINDOW_MINS = 20     # only trade this soon after a release
ATR_LEN     = 14
ATR_STOP    = 1.5
ATR_TARGET  = 2.5
RISK_PCT    = 0.5    # smaller than usual — event risk is not kind

atr = None

def _rma(x, n):
    out = np.full(len(x), np.nan)
    prev = np.nan
    for i in range(len(x)):
        if np.isnan(prev):
            if i >= n - 1:
                w = x[i - n + 1:i + 1]
                if not np.isnan(w).any():
                    prev = w.mean()
                    out[i] = prev
        else:
            prev = (x[i] + (n - 1) * prev) / n
            out[i] = prev
    return out

def init(candles, ctx):
    global atr
    highs  = np.array([c['high'] for c in candles])
    lows   = np.array([c['low'] for c in candles])
    closes = np.array([c['close'] for c in candles])
    prev_c = np.roll(closes, 1); prev_c[0] = closes[0]
    tr = np.maximum(highs - lows,
         np.maximum(np.abs(highs - prev_c), np.abs(lows - prev_c)))
    atr = _rma(tr, ATR_LEN)

def bar(i, candles, ctx):
    if i < ATR_LEN + 2:
        return
    a = atr[i]
    if not np.isfinite(a) or a <= 0:
        return

    c = candles[i]

    # How long since the last high-impact release? inf means "none found".
    since = ctx.news_mins_since_last(['high'])
    if since > WINDOW_MINS:
        return                      # outside the reaction window
    if ctx.position() != 0:
        return                      # already positioned, let SL/TP work

    rng = c['high'] - c['low']
    if rng <= 0:
        return
    where = (c['close'] - c['low']) / rng   # 1 = closed on the high

    dist = ATR_STOP * a
    lots = ctx.risk_lots(RISK_PCT, dist)
    if lots <= 0:
        return

    if where > 0.66:
        ctx.buy(lots, c['close'] - dist, c['close'] + ATR_TARGET * a)
    elif where < 0.34:
        ctx.sell(lots, c['close'] + dist, c['close'] - ATR_TARGET * a)
`,
  },
];

const FAMILY_META = {
  'trend':          { label: 'Trend Following', icon: 'fa-arrow-trend-up', color: 'info' },
  'mean-reversion': { label: 'Mean Reversion',  icon: 'fa-arrows-left-right-to-line', color: 'brand' },
  'breakout':       { label: 'Breakout',        icon: 'fa-bolt', color: 'warn' },
  'momentum':       { label: 'Momentum',        icon: 'fa-gauge-high', color: 'up' },
  'pattern':        { label: 'Session / Pattern', icon: 'fa-clock', color: 'info' },
  'news':           { label: 'News Aware',      icon: 'fa-bullhorn', color: 'warn' },
  'template':       { label: 'Template',        icon: 'fa-file-code', color: 'dim' },
};

const LANG_META = {
  js:     { label: 'JavaScript', tag: 'tag-js', icon: 'fa-js' },
  pine:   { label: 'Pine Script', tag: 'tag-pine', icon: 'fa-chart-line' },
  python: { label: 'Python', tag: 'tag-python', icon: 'fa-python' },
};

function getStrategy(id) { return STRATEGY_LIBRARY.find(s => s.id === id); }
function strategiesByLang(lang) { return STRATEGY_LIBRARY.filter(s => s.lang === lang); }

window.STRATEGY_LIBRARY = STRATEGY_LIBRARY;
window.FAMILY_META = FAMILY_META;
window.LANG_META = LANG_META;
window.getStrategy = getStrategy;
window.strategiesByLang = strategiesByLang;
