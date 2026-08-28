// ===========================================================================
// Strategy runner — executes JS / Pine / Python (Pyodide) strategies
// over candles with a Broker instance. Async, chunked to keep UI alive.
// ===========================================================================
const StrategyRunner = (() => {
  let pyodide = null;
  let pyodideLoading = null;

  // ---------------- example strategies ----------------
  const EXAMPLES = {
    js: {
      'MA Cross (JS)': `// JavaScript strategy.
// API: bar(i, candles, ctx) is called for every bar.
// ctx: { ta, broker, buy(lots, sl, tp), sell(lots, sl, tp), closeAll(),
//        position() -> net lots, equity(), balance() }
// Precomputed series allowed in init().

let fast, slow;

function init(candles, ctx) {
  const closes = candles.map(c => c.close);
  fast = ctx.ta.ema(closes, 20);
  slow = ctx.ta.ema(closes, 50);
}

function bar(i, candles, ctx) {
  if (i < 51) return;
  const c = candles[i];
  const atr = ctx.atr14[i];
  if (ctx.ta.crossover(fast, slow, i) && ctx.position() <= 0) {
    ctx.closeAll();
    ctx.buy(1, c.close - 2 * atr, c.close + 3 * atr);
  }
  if (ctx.ta.crossunder(fast, slow, i) && ctx.position() >= 0) {
    ctx.closeAll();
    ctx.sell(1, c.close + 2 * atr, c.close - 3 * atr);
  }
}`,
      'RSI Mean Reversion (JS)': `let rsi;

function init(candles, ctx) {
  rsi = ctx.ta.rsi(candles.map(c => c.close), 14);
}

function bar(i, candles, ctx) {
  if (i < 20) return;
  const c = candles[i];
  const atr = ctx.atr14[i];
  if (rsi[i] < 30 && ctx.position() === 0) {
    ctx.buy(1, c.close - 2.5 * atr, c.close + 2.5 * atr);
  }
  if (rsi[i] > 70 && ctx.position() === 0) {
    ctx.sell(1, c.close + 2.5 * atr, c.close - 2.5 * atr);
  }
  // exit on midline
  if (ctx.position() > 0 && rsi[i] > 55) ctx.closeAll();
  if (ctx.position() < 0 && rsi[i] < 45) ctx.closeAll();
}`,
      'Breakout Donchian (JS)': `let hh, ll;

function init(candles, ctx) {
  hh = ctx.ta.highest(candles.map(c => c.high), 20);
  ll = ctx.ta.lowest(candles.map(c => c.low), 20);
}

function bar(i, candles, ctx) {
  if (i < 22) return;
  const c = candles[i];
  const atr = ctx.atr14[i];
  if (c.close > hh[i - 1] && ctx.position() <= 0) {
    ctx.closeAll();
    ctx.buy(1, c.close - 2 * atr, null);
  }
  if (c.close < ll[i - 1] && ctx.position() >= 0) {
    ctx.closeAll();
    ctx.sell(1, c.close + 2 * atr, null);
  }
}`,
    },
    pine: {
      'MA Cross (Pine)': `//@version=5
strategy("MA Cross", overlay=true)

fastLen = input.int(20, "Fast Length")
slowLen = input.int(50, "Slow Length")

fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)

longCond = ta.crossover(fast, slow)
shortCond = ta.crossunder(fast, slow)

atr = ta.atr(14)

if longCond
    strategy.close_all()
    strategy.entry("L", strategy.long, qty=1)
    strategy.exit("XL", from_entry="L", stop=close - 2 * atr, limit=close + 3 * atr)

if shortCond
    strategy.close_all()
    strategy.entry("S", strategy.short, qty=1)
    strategy.exit("XS", from_entry="S", stop=close + 2 * atr, limit=close - 3 * atr)`,
      'RSI Strategy (Pine)': `//@version=5
strategy("RSI Strategy", overlay=false)

len = input.int(14, "RSI Length")
rsi = ta.rsi(close, len)
atr = ta.atr(14)

if rsi < 30 and strategy.position_size == 0
    strategy.entry("L", strategy.long, qty=1)
    strategy.exit("XL", from_entry="L", stop=close - 2.5 * atr, limit=close + 2.5 * atr)

if rsi > 70 and strategy.position_size == 0
    strategy.entry("S", strategy.short, qty=1)
    strategy.exit("XS", from_entry="S", stop=close + 2.5 * atr, limit=close - 2.5 * atr)

if strategy.position_size > 0 and rsi > 55
    strategy.close_all()
if strategy.position_size < 0 and rsi < 45
    strategy.close_all()`,
      'Bollinger Revert (Pine)': `//@version=5
strategy("Bollinger Revert", overlay=true)

len = input.int(20)
mult = input.float(2.0)

basis = ta.sma(close, len)
dev = mult * ta.stdev(close, len)
upper = basis + dev
lower = basis - dev

if close < lower and strategy.position_size == 0
    strategy.entry("L", strategy.long, qty=1)

if close > upper and strategy.position_size == 0
    strategy.entry("S", strategy.short, qty=1)

if strategy.position_size > 0 and close >= basis
    strategy.close_all()
if strategy.position_size < 0 and close <= basis
    strategy.close_all()`,
    },
    python: {
      'MA Cross (Python)': `# Python strategy (runs in-browser via Pyodide).
# Define bar(i, candles, ctx). candles: list of dicts (time, open, high, low, close, volume)
# ctx methods: buy(lots, sl=None, tp=None), sell(lots, sl=None, tp=None),
#              close_all(), position() -> net lots, equity(), balance()
# Precomputed numpy arrays: ctx.closes, ctx.highs, ctx.lows, plus helpers ema/sma/rsi/atr below.

import numpy as np

def ema(x, n):
    out = np.full(len(x), np.nan)
    k = 2 / (n + 1)
    for i in range(len(x)):
        if i == n - 1:
            out[i] = np.mean(x[:n])
        elif i >= n:
            out[i] = x[i] * k + out[i-1] * (1 - k)
    return out

FAST, SLOW = 20, 50
fast = slow = atr = None

def init(candles, ctx):
    global fast, slow, atr
    closes = np.array([c['close'] for c in candles])
    highs  = np.array([c['high'] for c in candles])
    lows   = np.array([c['low'] for c in candles])
    fast = ema(closes, FAST)
    slow = ema(closes, SLOW)
    pc = np.roll(closes, 1); pc[0] = closes[0]
    tr = np.maximum(highs - lows, np.maximum(abs(highs - pc), abs(lows - pc)))
    atr = ema(tr, 14)

def bar(i, candles, ctx):
    if i < SLOW + 1:
        return
    c = candles[i]['close']
    if np.isnan(fast[i]) or np.isnan(slow[i]) or np.isnan(fast[i-1]):
        return
    if fast[i-1] <= slow[i-1] and fast[i] > slow[i] and ctx.position() <= 0:
        ctx.close_all()
        ctx.buy(1, c - 2 * atr[i], c + 3 * atr[i])
    if fast[i-1] >= slow[i-1] and fast[i] < slow[i] and ctx.position() >= 0:
        ctx.close_all()
        ctx.sell(1, c + 2 * atr[i], c - 3 * atr[i])`,
      'Momentum (Python)': `import numpy as np

LOOKBACK = 40
closes = None

def init(candles, ctx):
    global closes
    closes = np.array([c['close'] for c in candles])

def bar(i, candles, ctx):
    if i < LOOKBACK + 1:
        return
    mom = closes[i] / closes[i - LOOKBACK] - 1
    if mom > 0.02 and ctx.position() <= 0:
        ctx.close_all()
        ctx.buy(1)
    elif mom < -0.02 and ctx.position() >= 0:
        ctx.close_all()
        ctx.sell(1)`,
    },
  };

  // ---------------- shared sizing / stop helpers ----------------
  // Lots such that a `dist` adverse price move costs `pct` % of realised balance.
  function riskLots(broker, pct, dist) {
    const units = broker.symInfo?.lotUnits || 100000;
    const d = Math.abs(Number(dist));
    const p = Number(pct);
    if (!isFinite(d) || d <= 0 || !isFinite(p) || p <= 0) return 0.01;
    const riskCash = broker.balance * (p / 100);
    const lossPerLot = d * units;
    if (lossPerLot <= 0) return 0.01;
    let lots = riskCash / lossPerLot;
    lots = Math.floor(lots * 100) / 100;      // broker-style 0.01 lot step
    if (!isFinite(lots) || lots < 0.01) lots = 0.01;
    if (lots > 500) lots = 500;               // sanity cap
    return lots;
  }

  // Modify SL / TP on every open position. null / undefined leaves the value alone.
  function setStops(broker, sl, tp) {
    let n = 0;
    for (const p of broker.positions) {
      if (sl !== null && sl !== undefined && isFinite(sl)) { p.sl = sl; n++; }
      if (tp !== null && tp !== undefined && isFinite(tp)) { p.tp = tp; n++; }
    }
    return n;
  }

  // ---------------- JS ctx factory ----------------
  function makeCtx(broker, candles, curBarRef) {
    const atr14 = TA.atr(candles, 14);
    const bar = () => candles[curBarRef.i];
    return {
      ta: TA,
      atr14,
      broker,
      symInfo: broker.symInfo,
      buy: (lots, sl = null, tp = null) => broker.open(1, lots || 1, bar(), sl, tp, 'strategy'),
      sell: (lots, sl = null, tp = null) => broker.open(-1, lots || 1, bar(), sl, tp, 'strategy'),
      closeAll: () => broker.closeAll(bar(), 'strategy'),
      position: () => broker.positions.reduce((s, p) => s + p.dir * p.lots, 0),
      equity: () => broker.equity(bar().close),
      balance: () => broker.balance,
      openCount: () => broker.positions.length,
      positions: () => broker.positions,
      riskLots: (pct, dist) => riskLots(broker, pct, dist),
      setStops: (sl = null, tp = null) => setStops(broker, sl, tp),
      log: (...a) => { try { console.log('[strategy]', ...a); } catch (_) {} },
    };
  }

  // ---------------- runners ----------------
  async function runJS(code, candles, broker, onProgress) {
    const curBarRef = { i: 0 };
    const ctx = makeCtx(broker, candles, curBarRef);
    // compile user code in a function scope exposing init/bar
    const fn = new Function('candles', 'ctx', 'TA', `
      "use strict";
      ${code}
      return { init: typeof init === 'function' ? init : null, bar: typeof bar === 'function' ? bar : null };
    `);
    const mod = fn(candles, ctx, TA);
    if (!mod.bar) throw new Error('Define function bar(i, candles, ctx)');
    if (mod.init) mod.init(candles, ctx);

    const CHUNK = 2000;
    for (let i = 0; i < candles.length; i++) {
      curBarRef.i = i;
      mod.bar(i, candles, ctx);
      broker.onBar(candles[i]);
      if (broker.propState && broker.propState.status.startsWith('failed')) {
        broker.closeAll(candles[i], 'prop_fail');
        // keep recording equity flat to the end? stop here.
        break;
      }
      if (i % CHUNK === 0) {
        if (onProgress) onProgress(i / candles.length);
        await new Promise(r => setTimeout(r, 0));
      }
    }
    broker.finishProp();
  }

  // ---------------- Pine runner ----------------
  async function runPine(code, candles, broker, onProgress) {
    const program = Pine.compile(code);
    const curBar = { i: 0 };
    const pendingExits = new Map(); // entryId -> {stop, limit}

    const actions = {
      positionSize: () => broker.positions.reduce((s, p) => s + p.dir * p.lots, 0),
      openCount: () => broker.positions.length,
      equity: () => broker.equity(candles[curBar.i].close),
      entry: (id, dir, qty) => {
        // netting like TV: close opposite first
        const opp = broker.positions.filter(p => p.dir !== dir);
        for (const p of opp) {
          const bid = candles[curBar.i].close, ask = bid + broker.spreadPrice;
          broker.close(p, p.dir > 0 ? bid : ask, candles[curBar.i].time, 'reverse');
        }
        const ex = pendingExits.get(id);
        const pos = broker.open(dir, qty, candles[curBar.i], ex?.stop ?? null, ex?.limit ?? null, id);
        return pos;
      },
      exit: (xid, fromId, stop, limit) => {
        const s = isNaN(stop) ? null : stop, l = isNaN(limit) ? null : limit;
        let applied = false;
        for (const p of broker.positions) {
          if (fromId === null || p.comment === fromId) { p.sl = s ?? p.sl; p.tp = l ?? p.tp; applied = true; }
        }
        if (!applied && fromId) pendingExits.set(fromId, { stop: s, limit: l });
      },
      closeId: (id) => {
        const bid = candles[curBar.i].close, ask = bid + broker.spreadPrice;
        for (const p of [...broker.positions]) {
          if (id === null || p.comment === id) broker.close(p, p.dir > 0 ? bid : ask, candles[curBar.i].time, 'strategy');
        }
      },
      closeAll: () => broker.closeAll(candles[curBar.i], 'strategy'),
    };

    const rt = Pine.createRuntime(candles, actions);
    const CHUNK = 1000;
    for (let i = 0; i < candles.length; i++) {
      curBar.i = i;
      rt.runBar(i, program);
      broker.onBar(candles[i]);
      if (broker.propState && broker.propState.status.startsWith('failed')) {
        broker.closeAll(candles[i], 'prop_fail');
        break;
      }
      if (i % CHUNK === 0) {
        if (onProgress) onProgress(i / candles.length);
        await new Promise(r => setTimeout(r, 0));
      }
    }
    broker.finishProp();
  }

  // ---------------- Python (Pyodide) runner ----------------
  async function ensurePyodide(onStatus) {
    if (pyodide) return pyodide;
    if (!pyodideLoading) {
      pyodideLoading = (async () => {
        onStatus?.('Loading Python runtime (~10 MB, first time only)…');
        if (!window.loadPyodide) {
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
          });
        }
        const py = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/' });
        onStatus?.('Loading numpy…');
        await py.loadPackage('numpy');
        pyodide = py;
        return py;
      })();
    }
    return pyodideLoading;
  }

  async function runPython(code, candles, broker, onProgress, onStatus) {
    const py = await ensurePyodide(onStatus);
    onStatus?.('Running Python strategy…');
    const curBar = { i: 0 };

    // JS bridge object
    const bridge = {
      buy: (lots, sl, tp) => broker.open(1, lots ?? 1, candles[curBar.i], sl ?? null, tp ?? null, 'py'),
      sell: (lots, sl, tp) => broker.open(-1, lots ?? 1, candles[curBar.i], sl ?? null, tp ?? null, 'py'),
      close_all: () => broker.closeAll(candles[curBar.i], 'strategy'),
      position: () => broker.positions.reduce((s, p) => s + p.dir * p.lots, 0),
      equity: () => broker.equity(candles[curBar.i].close),
      balance: () => broker.balance,
      open_count: () => broker.positions.length,
      risk_lots: (pct, dist) => riskLots(broker, pct, dist),
      set_stops: (sl, tp) => setStops(broker, sl ?? null, tp ?? null),
      log: (msg) => { try { console.log('[strategy:py]', msg); } catch (_) {} },
    };
    py.globals.set('_js_ctx', bridge);
    py.globals.set('_candles_json', JSON.stringify(candles));

    const setup = `
import json

class _Ctx:
    def __init__(self, js):
        self._js = js
    def buy(self, lots=1, sl=None, tp=None):
        return self._js.buy(lots, sl, tp)
    def sell(self, lots=1, sl=None, tp=None):
        return self._js.sell(lots, sl, tp)
    def close_all(self):
        return self._js.close_all()
    def position(self):
        return self._js.position()
    def equity(self):
        return self._js.equity()
    def balance(self):
        return self._js.balance()
    def open_count(self):
        return self._js.open_count()
    def risk_lots(self, pct, dist):
        return self._js.risk_lots(float(pct), float(dist))
    def set_stops(self, sl=None, tp=None):
        return self._js.set_stops(sl, tp)
    def log(self, *args):
        return self._js.log(' '.join(str(a) for a in args))

ctx = _Ctx(_js_ctx)
candles = json.loads(_candles_json)

${code}

_has_init = 'init' in dir()
if _has_init:
    init(candles, ctx)
`;
    await py.runPythonAsync(setup);

    const barFn = py.globals.get('bar');
    if (!barFn) throw new Error('Define function bar(i, candles, ctx) in Python');
    const pyCandles = py.globals.get('candles');
    const pyCtx = py.globals.get('ctx');

    const CHUNK = 500;
    for (let i = 0; i < candles.length; i++) {
      curBar.i = i;
      barFn(i, pyCandles, pyCtx);
      broker.onBar(candles[i]);
      if (broker.propState && broker.propState.status.startsWith('failed')) {
        broker.closeAll(candles[i], 'prop_fail');
        break;
      }
      if (i % CHUNK === 0) {
        if (onProgress) onProgress(i / candles.length);
        await new Promise(r => setTimeout(r, 0));
      }
    }
    barFn.destroy?.(); pyCandles.destroy?.(); pyCtx.destroy?.();
    broker.finishProp();
  }

  async function run(lang, code, candles, broker, onProgress, onStatus) {
    if (lang === 'js') return runJS(code, candles, broker, onProgress);
    if (lang === 'pine') return runPine(code, candles, broker, onProgress);
    if (lang === 'python') return runPython(code, candles, broker, onProgress, onStatus);
    throw new Error('unknown language');
  }

  function validate(lang, code) {
    try {
      if (lang === 'js') {
        new Function(code);
      } else if (lang === 'pine') {
        Pine.compile(code);
      } else if (lang === 'python') {
        if (!/def\s+bar\s*\(/.test(code)) throw new Error('Define def bar(i, candles, ctx)');
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  return { run, validate, EXAMPLES, riskLots, setStops };
})();

window.StrategyRunner = StrategyRunner;
