// ===========================================================================
// Manual / documentation content. Plain HTML fragments rendered into .prose
// containers by dashboard.js. Written in English, aimed at a reader who has
// never used a backtester before.
// ===========================================================================

const DATA_DOC = `
<h2>Two feeds, no synthetic prices</h2>
<p>BlackTick never generates, interpolates or smooths a candle. Every bar you see was recorded
by a real venue. If the market was shut, the bar simply does not exist — you will see a gap over
weekends, Christmas and exchange holidays, and that is correct behaviour.</p>

<h3>Dukascopy — forex, indices, stocks, commodities</h3>
<p>Dukascopy is a Swiss bank that publishes its own historical tick and candle archive for free.
The files are binary, LZMA-compressed, and named by date. This app proxies them through
<code>/api/duka/…</code> and decodes them <b>in your browser</b>.</p>
<table>
  <thead><tr><th>Resolution</th><th>One file covers</th><th>Path shape</th></tr></thead>
  <tbody>
    <tr><td>M1 (1 minute)</td><td>One day</td><td><code>SYM/YYYY/MM/DD/BID_candles_min_1.bi5</code></td></tr>
    <tr><td>H1 (1 hour)</td><td>One month</td><td><code>SYM/YYYY/MM/BID_candles_hour_1.bi5</code></td></tr>
    <tr><td>D1 (1 day)</td><td>One year</td><td><code>SYM/YYYY/BID_candles_day_1.bi5</code></td></tr>
  </tbody>
</table>
<p>Inside a decompressed file, each candle is exactly <b>24 bytes, big-endian</b>:
a 32-bit second offset from the file's base timestamp, then open, close, low and high as
32-bit integers, then volume as a 32-bit float. Integers are divided by a per-asset factor —
100,000 for most forex pairs, 1,000 for JPY crosses, indices, stocks and commodities.</p>
<blockquote>These are <b>BID</b> prices. The ask is reconstructed as
<code>bid + spread</code> using the spread you set. That is why the spread field matters:
it is the only thing standing between your backtest and a fantasy where you buy at the bid.</blockquote>

<h3>Binance — cryptocurrency</h3>
<p>Crypto pairs come from the Binance spot <code>klines</code> endpoint through
<code>/api/binance/klines</code>, using the public <code>data-api.binance.vision</code> mirror with
<code>api.binance.com</code> as a fallback. These are mid-market last-traded prices from a single
exchange — no bid/ask split — so the spread you configure is applied symmetrically on top.
Crypto trades 24/7, so there are no weekend gaps.</p>

<h3>How a timeframe is built</h3>
<p>Only three resolutions actually exist on disk: M1, H1 and D1. Everything else is aggregated
client-side from the nearest smaller base:</p>
<table>
  <thead><tr><th>You select</th><th>Built from</th><th>Notes</th></tr></thead>
  <tbody>
    <tr><td>1m</td><td>M1 files, unmodified</td><td>One file per calendar day</td></tr>
    <tr><td>5m · 15m · 30m</td><td>M1, aggregated</td><td>Downloads can be large over long ranges</td></tr>
    <tr><td>1H</td><td>H1 files, unmodified</td><td>One file per month — very efficient</td></tr>
    <tr><td>4H</td><td>H1, aggregated</td><td>Buckets anchored to 00:00 UTC</td></tr>
    <tr><td>1D</td><td>D1 files, unmodified</td><td>One file per year</td></tr>
    <tr><td>1W</td><td>D1, aggregated</td><td>Weeks anchored to Monday 00:00 UTC</td></tr>
  </tbody>
</table>
<p>Aggregation takes the first open, the highest high, the lowest low, the last close and the
volume sum of the bars in each bucket — the standard, lossless definition.</p>

<h2>Known limitations — read these</h2>
<ul>
  <li><strong>All timestamps are UTC.</strong> There is no broker-server offset. If your live broker
  runs on GMT+2, your daily candles will not line up bar-for-bar with these.</li>
  <li><strong>Intrabar order is unknown.</strong> A bar tells you the high and the low but not which
  came first. The engine always assumes the <b>unfavourable</b> one hit first.</li>
  <li><strong>No slippage or requotes.</strong> Orders fill at the exact modelled price. Real fills
  during news are worse, sometimes much worse.</li>
  <li><strong>No swap / financing.</strong> Overnight interest on positions is not charged. Strategies
  that hold for weeks will look slightly better here than in reality.</li>
  <li><strong>Dividends and splits.</strong> Stock CFD history from Dukascopy is not adjusted for
  dividends. Treat single-stock results as indicative only.</li>
  <li><strong>One exchange for crypto.</strong> Binance is deep and liquid, but it is still one venue.</li>
</ul>

<h2>Verifying it yourself</h2>
<p>Nothing here is a black box. Open the browser console in the terminal and every load prints the
bar count. To go further, download a file directly and decode it with ten lines of Python:</p>
<pre><code>import lzma, struct, urllib.request

url = "https://YOUR-HOST/api/duka/EURUSD/2024/05/03/BID_candles_min_1.bi5"
raw = lzma.decompress(urllib.request.urlopen(url).read())

for i in range(3):
    off, o, c, l, h, v = struct.unpack_from("&gt;IIIIIf", raw, i * 24)
    print(off, o / 1e5, h / 1e5, l / 1e5, c / 1e5, v)</code></pre>
<p>Cross-check the numbers against any public chart for that date. They will match.</p>
`;

const MANUAL_DOC = `
<h2 id="m-start">Getting started</h2>
<p>A backtest answers one question: <em>if I had followed these exact rules over this exact period,
what would have happened?</em> Nothing more. It cannot tell you whether the rules will keep working.</p>
<p>The fastest honest first run:</p>
<ol>
  <li>Open <b>New Backtest</b> and accept the defaults — EURUSD, 1H, 2023–2024.</li>
  <li>Choose <b>EMA Trend Rider</b>. It is a plain trend-following strategy with a clear stop.</li>
  <li>Leave the account at $100,000, 1:100, 0.5 pip spread, $3.50 commission.</li>
  <li>Press <b>Run backtest in terminal</b> and read the Overview tab.</li>
</ol>
<p>Then do the single most useful thing you can do with this tool: set the spread to <code>0</code>,
run it again, and compare. The difference is what trading costs are doing to your idea.</p>

<h2 id="m-engine">How the engine fills orders</h2>
<h3>Order timing</h3>
<p>Your strategy is called once per bar, <b>after that bar has closed</b>. Everything you can see —
open, high, low, close — is history. There is no way to peek at the next bar, which means
look-ahead bias is structurally impossible.</p>
<p>When you call <code>buy()</code> or <code>sell()</code>, the order fills immediately at the close of the
bar that produced the signal. In live trading you would fill a fraction of a second later at a
slightly different price; over hundreds of trades this is usually a small effect, but it is not zero.</p>

<h3>Bid, ask and spread</h3>
<p>Bars carry BID prices. The ask is <code>bid + spread × pipSize</code>.</p>
<table>
  <thead><tr><th>Action</th><th>Fills at</th></tr></thead>
  <tbody>
    <tr><td>Open long</td><td>Ask (you pay the spread)</td></tr>
    <tr><td>Close long</td><td>Bid</td></tr>
    <tr><td>Open short</td><td>Bid</td></tr>
    <tr><td>Close short</td><td>Ask (you pay the spread)</td></tr>
  </tbody>
</table>
<p>So a round trip costs one full spread plus commission on both sides. A position opened and closed
at the same price is a loss, exactly as in reality.</p>

<h3>Re-pricing fills against the real order book</h3>
<p>A single spread number for a two-year test is a convenient fiction. Real spreads breathe: they
tighten in the London session and blow out at the rollover, at the open, and on every data release.
Tick <b>Re-price fills against real order-book data</b> in the backtest dialog and the run gets a
second pass that prices every fill at the quote the market was actually showing.</p>
<table>
  <thead><tr><th>Instrument</th><th>What gets used</th><th>What it fixes</th></tr></thead>
  <tbody>
    <tr><td>Forex, indices, commodities, share CFDs</td>
        <td>Dukascopy hourly tick files — real bid, ask and size at the touch</td>
        <td>The spread you actually paid, and stops priced at the tick that really crossed them
            rather than at the level, so a gap through a stop costs what it cost</td></tr>
    <tr><td>Crypto</td>
        <td>Binance archived book depth — resting notional at 1–5% from mid, once a minute</td>
        <td>What your <em>size</em> cost: a 0.05 BTC order fills at the touch, a 200 BTC order
            walks the book</td></tr>
  </tbody>
</table>
<p>Only the bars where a trade opened or closed are downloaded, so the pass costs a few hundred
small files rather than a full tick history. The results land in the <b>Microstructure</b> tab of
the report, next to a histogram of every spread you were actually quoted with your assumption
marked on it.</p>
<blockquote>The trade sequence is held fixed. This tells you what the trades your strategy took
really cost — not what the strategy would have done with better data. Changing fill prices would
change later signals, and then there would be nothing left to compare against.</blockquote>
<p>What it cannot do: simulate a limit order's place in the queue. That needs full per-level book
state through time, and neither venue publishes it. Nothing free does. Every fill here is modelled
as a market order.</p>

<h3>Stops and targets inside a bar</h3>
<p>This is where most backtesting software quietly flatters you. If a single bar's range contains
both your stop loss and your take profit, the honest answer is <em>we don't know which was hit
first</em>. BlackTick always resolves it as the <b>stop</b>.</p>
<blockquote>Consequence: strategies with a tight stop and a wide target will report a lower win rate
here than on platforms that resolve ties optimistically. That gap is not a bug — it is the
uncertainty other tools hide from you.</blockquote>

<h3>Position accounting</h3>
<p>The account is a <b>hedging</b> account: longs and shorts coexist as separate positions, each with
its own entry, stop and target. It is not netting. <code>ctx.position()</code> returns the net lots
(<code>+</code> long, <code>−</code> short, <code>0</code> flat) so you can still write netting-style logic if
you prefer, and <code>ctx.closeAll()</code> flattens everything.</p>

<h3>Profit, margin and the margin call</h3>
<pre><code>profit        = (exit − entry) × direction × lots × contractSize
notional      = lots × contractSize × price
marginNeeded  = notional / leverage
equity        = balance + unrealised P/L of open positions
marginLevel   = equity / marginUsed</code></pre>
<p>An order is <b>rejected</b> if the required margin exceeds your free margin — the strategy simply
gets <code>null</code> back and no trade appears. If margin level falls below <b>50%</b>, every position
is liquidated at the current bar and the trade reason is logged as <code>margin_call</code>.</p>
<p>Leverage does not change how much you earn per pip. It only changes how large a position your
margin can support. Raising leverage does not make a strategy more profitable; it makes ruin
reachable faster.</p>

<h3>Commission</h3>
<p>Charged as dollars per lot <b>per side</b> — so $3.50 with 1 lot costs $3.50 on entry and $3.50 on
exit, $7.00 round trip. Set it to zero to model a spread-only account.</p>

<h2 id="m-risk">Position sizing and risk</h2>
<p>Every bundled strategy sizes positions from risk, never from a fixed lot count. The helper is:</p>
<pre><code>const lots = ctx.riskLots(0.5, Math.abs(close - stopPrice));
ctx.buy(lots, stopPrice, targetPrice);</code></pre>
<p>This solves <code>lots × contractSize × stopDistance = balance × 0.5%</code> and rounds down to the
nearest 0.01 lot. A wider stop therefore produces a smaller position automatically, so the dollar
risk per trade stays constant regardless of volatility.</p>
<table>
  <thead><tr><th>Risk per trade</th><th>Character</th></tr></thead>
  <tbody>
    <tr><td>0.25% – 0.5%</td><td>Conservative. Survives long losing streaks. Required for prop challenges.</td></tr>
    <tr><td>0.5% – 1%</td><td>Standard for a funded or personal account.</td></tr>
    <tr><td>1% – 2%</td><td>Aggressive. Ten consecutive losses cost roughly a fifth of the account.</td></tr>
    <tr><td>Above 2%</td><td>Gambling. A normal drawdown becomes terminal.</td></tr>
  </tbody>
</table>
<p>Check the <b>Max consecutive losses</b> figure in the Performance tab, multiply it by your risk per
trade, and ask whether you could sit through that.</p>

<h2 id="m-prop">Prop-firm rule simulation</h2>
<p>Funded-account challenges fail people on rules, not on profitability. Switch a rule set on and the
engine enforces it bar by bar.</p>
<table>
  <thead><tr><th>Preset</th><th>Profit target</th><th>Daily loss</th><th>Max drawdown</th></tr></thead>
  <tbody>
    <tr><td>Evaluation Phase 1</td><td>+10%</td><td>5%</td><td>10% static</td></tr>
    <tr><td>Evaluation Phase 2</td><td>+5%</td><td>5%</td><td>10% static</td></tr>
    <tr><td>Funded account</td><td>none</td><td>5%</td><td>10% static</td></tr>
    <tr><td>Custom</td><td>your value</td><td>your value</td><td>static or trailing</td></tr>
  </tbody>
</table>
<h3>How each limit is measured</h3>
<ul>
  <li><strong>Daily loss</strong> — compared against the equity at the start of that UTC day, using the
  <b>worst equity reached inside each bar</b>, not the closing equity. A trade that dipped past the
  limit and recovered still fails the day.</li>
  <li><strong>Max drawdown, static</strong> — measured from the starting balance. Losing 10% ends the run
  whatever you made earlier.</li>
  <li><strong>Max drawdown, trailing</strong> — measured from the highest equity ever reached, so the
  floor rises with your profits and never falls back.</li>
  <li><strong>Profit target</strong> — the moment closing equity reaches it, the run is marked
  <b>passed</b> and stops.</li>
</ul>
<blockquote>Because worst-case intrabar equity is used, this simulator is <b>harsher</b> than a
backtester that only checks bar closes. If you pass here, you have a real margin of safety.</blockquote>

<h2 id="m-report">Reading the report</h2>
<h3>Overview</h3>
<p>Headline numbers plus the equity curve. The shape of the curve matters more than the final figure:
a straight-ish line beats a spike followed by a plateau, because the spike usually means one lucky
trade carried the whole result.</p>
<h3>Performance</h3>
<table>
  <thead><tr><th>Metric</th><th>What it tells you</th></tr></thead>
  <tbody>
    <tr><td>Net profit</td><td>Final balance minus starting balance, after all costs.</td></tr>
    <tr><td>Profit factor</td><td>Gross wins ÷ gross losses. Below 1.0 loses money. Above 1.3 is respectable; above 2.5 on a small sample usually means overfitting.</td></tr>
    <tr><td>Win rate</td><td>Almost meaningless alone. A 30% win rate with 4:1 payoff beats 70% with 1:3.</td></tr>
    <tr><td>Max drawdown</td><td>Largest peak-to-trough equity fall. The number that decides whether you can actually trade this.</td></tr>
    <tr><td>Sharpe ratio</td><td>Return per unit of volatility, annualised from bar returns. Useful for comparing two of your own runs, not for comparing to funds.</td></tr>
    <tr><td>Max consecutive losses</td><td>The psychological stress test. Multiply by risk per trade.</td></tr>
    <tr><td>Average hold time</td><td>Reveals whether the strategy is really doing what you thought.</td></tr>
    <tr><td>Total commission</td><td>If this rivals net profit, the edge is being eaten by costs.</td></tr>
  </tbody>
</table>
<h3>Trades</h3>
<p>Every fill: direction, size, entry, exit, reason (<code>sl</code>, <code>tp</code>, <code>strategy</code>,
<code>margin_call</code>, <code>reverse</code>, <code>prop_fail</code>) and net P/L. Sort by loss and look at
the five worst — that is where the real story lives.</p>
<h3>Monthly</h3>
<p>Return per calendar month, computed from equity at each month boundary. Look for whether profits
come from every month or from one freak month.</p>
<h3>Prop Firm</h3>
<p>Pass or fail, which rule broke and when, plus how close you came to each limit at the worst point.</p>

<h2 id="m-js">JavaScript API</h2>
<p>Define <code>bar(i, candles, ctx)</code>. Optionally define <code>init(candles, ctx)</code> to precompute
indicator series once — much faster than recomputing per bar.</p>
<pre><code>let fast, slow;

function init(candles, ctx) {
  const close = candles.map(c =&gt; c.close);
  fast = ctx.ta.ema(close, 20);
  slow = ctx.ta.ema(close, 50);
}

function bar(i, candles, ctx) {
  if (i &lt; 60) return;                 // let indicators warm up
  const c   = candles[i];
  const atr = ctx.atr14[i];
  if (!atr) return;

  if (ctx.ta.crossover(fast, slow, i) &amp;&amp; ctx.position() &lt;= 0) {
    ctx.closeAll();
    const stop = c.close - 2 * atr;
    ctx.buy(ctx.riskLots(0.5, c.close - stop), stop, c.close + 3 * atr);
  }
}</code></pre>
<table>
  <thead><tr><th>Member</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>ctx.buy(lots, sl, tp)</code></td><td>Open a long. <code>sl</code>/<code>tp</code> may be <code>null</code>. Returns the position, or <code>null</code> if margin was insufficient.</td></tr>
    <tr><td><code>ctx.sell(lots, sl, tp)</code></td><td>Open a short.</td></tr>
    <tr><td><code>ctx.closeAll()</code></td><td>Close every open position at this bar's close.</td></tr>
    <tr><td><code>ctx.setStops(sl, tp)</code></td><td>Modify stop and/or target on all open positions. Pass <code>null</code> to leave one unchanged. This is how you build a trailing stop.</td></tr>
    <tr><td><code>ctx.riskLots(pct, dist)</code></td><td>Lots such that a <code>dist</code> adverse move costs <code>pct</code>% of balance.</td></tr>
    <tr><td><code>ctx.position()</code></td><td>Net lots: positive long, negative short, zero flat.</td></tr>
    <tr><td><code>ctx.openCount()</code></td><td>Number of open positions.</td></tr>
    <tr><td><code>ctx.positions()</code></td><td>Live array of open positions (<code>dir, lots, entry, sl, tp, openTime</code>).</td></tr>
    <tr><td><code>ctx.balance()</code></td><td>Realised cash.</td></tr>
    <tr><td><code>ctx.equity()</code></td><td>Balance plus floating P/L.</td></tr>
    <tr><td><code>ctx.atr14</code></td><td>Pre-computed 14-period ATR array, aligned to <code>candles</code>.</td></tr>
    <tr><td><code>ctx.symInfo</code></td><td><code>{ sym, name, pip, lotUnits, digits, cat, source }</code>.</td></tr>
    <tr><td><code>ctx.log(...)</code></td><td>Print to the browser console.</td></tr>
    <tr><td><code>ctx.ta</code></td><td>Indicator library — see below.</td></tr>
  </tbody>
</table>
<h3>Indicator library (<code>ctx.ta</code>)</h3>
<p><code>sma(arr,n)</code> · <code>ema(arr,n)</code> · <code>rma(arr,n)</code> · <code>rsi(arr,n)</code> ·
<code>atr(candles,n)</code> · <code>tr(candles)</code> · <code>stdev(arr,n)</code> ·
<code>bollinger(arr,n,mult)</code> · <code>macd(arr,f,s,sig)</code> ·
<code>stochastic(candles,k,d)</code> · <code>highest(arr,n)</code> · <code>lowest(arr,n)</code> ·
<code>vwap(candles)</code> · <code>crossover(a,b,i)</code> · <code>crossunder(a,b,i)</code></p>
<p>Array functions return a same-length array with <code>NaN</code> during the warm-up window — always
guard with <code>if (!Number.isFinite(x)) return;</code>.</p>

<h2 id="m-pine">Pine Script support</h2>
<p>A working subset of Pine v5 is interpreted natively — enough to port most simple TradingView
strategies without rewriting them.</p>
<pre><code>//@version=5
strategy("MACD Momentum", overlay=true)

[macdLine, sigLine, _] = ta.macd(close, 12, 26, 9)
atr = ta.atr(14)

if ta.crossover(macdLine, sigLine) and strategy.position_size &lt;= 0
    strategy.close_all()
    strategy.entry("L", strategy.long, qty=1)
    strategy.exit("XL", from_entry="L", stop=close - 2 * atr, limit=close + 3 * atr)</code></pre>
<h3>Supported</h3>
<ul>
  <li>Variables (<code>=</code>), reassignment (<code>:=</code>), <code>var</code> declarations</li>
  <li><code>if</code> / <code>else if</code> / <code>else</code> with indentation-based blocks; ternaries</li>
  <li>Series: <code>open high low close volume hl2 hlc3 ohlc4 bar_index time</code>, and the
  <code>[n]</code> history operator</li>
  <li><code>ta.sma ema rma wma rsi atr tr stdev highest lowest change crossover crossunder cross macd</code></li>
  <li><code>math.*</code>, <code>na</code>, <code>nz</code>, <code>input.int/float/bool/string</code>
  (defaults are used — there is no settings panel)</li>
  <li><code>strategy.entry / exit / close / close_all</code>,
  <code>strategy.position_size / opentrades / equity / long / short</code></li>
  <li><code>plot()</code> and friends parse cleanly and are ignored</li>
</ul>
<h3>Not supported</h3>
<ul>
  <li><code>request.security()</code> — no multi-timeframe or multi-symbol access</li>
  <li>User-defined functions and types, arrays, matrices, maps</li>
  <li><code>strategy.risk.*</code>, alerts, tables, labels, boxes, <code>barstate.*</code></li>
  <li>Pending limit and stop entry orders (entries are market orders only)</li>
</ul>
<blockquote>Pine entries follow TradingView's netting convention: an entry in the opposite direction
closes the existing position first. Everywhere else the account is a hedging account.</blockquote>

<h2 id="m-python">Python API</h2>
<p>Python runs through Pyodide with numpy available. The runtime is about 10 MB and downloads once,
on first use, then stays cached.</p>
<pre><code>import numpy as np

LOOKBACK = 60
closes = None

def init(candles, ctx):
    global closes
    closes = np.array([c['close'] for c in candles])

def bar(i, candles, ctx):
    if i &lt; LOOKBACK + 1:
        return
    momentum = closes[i] / closes[i - LOOKBACK] - 1
    if momentum &gt; 0.02 and ctx.position() &lt;= 0:
        ctx.close_all()
        stop = closes[i] * 0.97
        ctx.buy(ctx.risk_lots(0.5, closes[i] - stop), stop, None)</code></pre>
<table>
  <thead><tr><th>Method</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>ctx.buy(lots, sl=None, tp=None)</code></td><td>Open a long.</td></tr>
    <tr><td><code>ctx.sell(lots, sl=None, tp=None)</code></td><td>Open a short.</td></tr>
    <tr><td><code>ctx.close_all()</code></td><td>Flatten everything.</td></tr>
    <tr><td><code>ctx.set_stops(sl=None, tp=None)</code></td><td>Modify stops on all open positions.</td></tr>
    <tr><td><code>ctx.risk_lots(pct, dist)</code></td><td>Risk-based position size.</td></tr>
    <tr><td><code>ctx.position()</code> · <code>ctx.open_count()</code></td><td>Net lots · number of open positions.</td></tr>
    <tr><td><code>ctx.balance()</code> · <code>ctx.equity()</code></td><td>Account state.</td></tr>
    <tr><td><code>ctx.log(*args)</code></td><td>Print to the browser console.</td></tr>
  </tbody>
</table>
<p><code>candles</code> is a list of dicts with keys <code>time, open, high, low, close, volume</code>.
Python is the slowest of the three languages — expect roughly a second per 10,000 bars.</p>

<h2 id="m-replay">Backtesting Session — manual trading</h2>
<p>Automated tests cannot evaluate discretionary rules. A manual backtesting session can.</p>
<ol>
  <li>In the terminal press <b>Backtesting Session</b>. One popup holds everything:
  the market (searchable across the whole Dukascopy catalog), timeframe, start date,
  balance, leverage and optional costs / prop-firm rules.</li>
  <li>The chart truncates there. Everything after is hidden.</li>
  <li>Step forward with <span class="kbd">&rarr;</span>, back with <span class="kbd">&larr;</span>,
  or play continuously with <span class="kbd">Space</span>.</li>
  <li>Use the order ticket to buy and sell. It shows the margin required and the exact dollar risk
  if your stop is hit before you commit.</li>
</ol>
<p>Stops and targets are evaluated on each new bar with the same conservative rule as backtests, and
the same prop-firm limits apply if you enabled a rule set in account settings. Stepping backwards
restores the account to its exact prior state — balance, open positions and prop counters all
rewind together.</p>

<h2 id="m-keys">Keyboard shortcuts</h2>
<table>
  <thead><tr><th>Key</th><th>Action</th></tr></thead>
  <tbody>
    <tr><td><span class="kbd">S</span></td><td>Open instrument search</td></tr>
    <tr><td><span class="kbd">I</span></td><td>Open indicators</td></tr>
    <tr><td><span class="kbd">R</span></td><td>Open / exit the backtesting session</td></tr>
    <tr><td><span class="kbd">B</span></td><td>Open backtest settings</td></tr>
    <tr><td><span class="kbd">&rarr;</span> / <span class="kbd">&larr;</span></td><td>Step replay forward / back</td></tr>
    <tr><td><span class="kbd">Space</span></td><td>Play / pause replay</td></tr>
    <tr><td><span class="kbd">Esc</span></td><td>Close dialog</td></tr>
    <tr><td><span class="kbd">Del</span></td><td>Delete selected drawing</td></tr>
  </tbody>
</table>

<h2 id="m-pitfalls">Avoiding false results</h2>
<ul>
  <li><strong>Overfitting.</strong> Tuning parameters until the curve looks beautiful produces a
  strategy that describes the past and predicts nothing. If a small parameter change collapses the
  result, you found noise.</li>
  <li><strong>Too few trades.</strong> Below roughly 100 trades, none of the statistics mean anything.
  Widen the date range or drop to a lower timeframe.</li>
  <li><strong>One regime only.</strong> A trend follower tested on 2020–2021 will look brilliant.
  Include a chop-heavy stretch and a crash.</li>
  <li><strong>Costs set to zero.</strong> The cheapest way to fool yourself. Always run once with
  realistic spread and commission, then again with double.</li>
  <li><strong>Survivorship in single stocks.</strong> The symbol list contains companies that did well.
  Testing a stock strategy on today's winners is a biased sample by construction.</li>
  <li><strong>Ignoring drawdown.</strong> A 300% return with a 60% drawdown is untradeable — you would
  have quit or been liquidated long before the recovery.</li>
</ul>
`;

const FAQ_ITEMS = [
  {
    q: 'Where do the news events on my chart come from?',
    a: 'The ForexFactory economic calendar, fetched live through the /api/news proxy. Past releases carry the actual figure alongside the forecast and previous value; upcoming releases carry the forecast only. Markers are coloured by impact — red for high, amber for medium — and are snapped onto the bar whose window contains the release time. If the calendar is unreachable, the backtest still runs and simply omits the markers.',
  },
  {
    q: 'Can my strategy read the economic calendar?',
    a: 'Yes. In JavaScript use ctx.news.minsToNext([\'high\']), ctx.news.minsSinceLast(...), ctx.news.isNear(mins, ...), plus next(), last(), today() and count(). In Python the same helpers are ctx.news_mins_to_next, ctx.news_mins_since_last, ctx.news_is_near and ctx.news_count. In Pine they are news.mins_to_next("high"), news.mins_since_last(...), news.is_near(30, "high") and news.count(). All of them return Infinity when nothing matches, so a strategy behaves normally if the calendar fails to load. See the "News Blackout Trend" and "Post-Release Momentum" strategies in the library for worked examples.',
  },
  {
    q: 'Is the price data real, or simulated?',
    a: `Real. Forex, indices, stocks and commodities come from the Dukascopy historical archive
    (a Swiss bank publishing its own tick data); crypto comes from the Binance spot API. The binary
    files are decoded in your browser and can be verified independently — the Data Sources page shows
    a ten-line Python snippet that decodes the same file and prints the same numbers.`,
  },
  {
    q: 'Why does my strategy perform worse here than on TradingView?',
    a: `Three usual reasons. First, when a bar contains both your stop and your target this engine
    always assumes the <b>stop</b> hit first, while many platforms resolve the tie in your favour.
    Second, spread is charged by direction on top of BID data, so a round trip always costs a full
    spread. Third, commission is charged on both sides. Set spread and commission to zero and the
    gap usually disappears — which tells you the edge was being paid to the broker.`,
  },
  {
    q: 'Do I need an account, an API key, or a broker?',
    a: `No. Everything runs in your browser and no money, credentials or personal data are involved.
    The server only proxies public market-data files.`,
  },
  {
    q: 'What does "leverage" actually change?',
    a: `Only how large a position your margin allows. Profit per pip depends on lot size, never on
    leverage. Raising leverage from 1:100 to 1:500 does not improve a strategy — it only lets you
    take positions big enough to be liquidated faster.`,
  },
  {
    q: 'Why are there gaps in the chart?',
    a: `Because the market was closed. Forex shuts from Friday evening to Sunday evening UTC; stocks
    and indices follow exchange hours and holidays. No candle is invented to fill a gap. Crypto has
    no gaps because it trades continuously.`,
  },
  {
    q: 'A backtest is taking a long time. Why?',
    a: `Because of how the archive is packaged. M1 data is one file per calendar day, so a one-year
    minute-resolution test needs about 250 downloads. H1 data is one file per month (12 per year) and
    D1 is one file per year. If you need a long history, prefer 1H or higher.`,
  },
  {
    q: 'Can I use my TradingView Pine script directly?',
    a: `Simple ones, usually yes. The interpreter covers variables, if/else, the <code>[n]</code>
    history operator, the common <code>ta.*</code> and <code>math.*</code> functions, and
    <code>strategy.entry / exit / close / close_all</code>. It does <b>not</b> support
    <code>request.security()</code>, user-defined functions, arrays, alerts or drawing objects.
    Paste your script and press <b>Check syntax</b> — you get a precise error if something is unsupported.`,
  },
  {
    q: 'What is a good profit factor?',
    a: `Above 1.0 means profitable before your own mistakes. 1.2–1.6 is a realistic, tradeable edge.
    Above 2.5 on a few dozen trades almost always means overfitting or an unrealistically small
    sample rather than a discovery.`,
  },
  {
    q: 'How many trades do I need before the numbers mean something?',
    a: `At least 100, ideally 300 or more, spread across different market conditions. With 20 trades
    the win rate and profit factor are essentially random.`,
  },
  {
    q: 'Why did the prop-firm test fail when my equity curve looks fine?',
    a: `Because daily loss and drawdown are measured against the <b>worst price reached inside each
    bar</b>, not the closing price. A position that dipped past the daily limit and recovered by the
    close still breaches the rule — and a real prop firm, watching tick by tick, would treat it the
    same way.`,
  },
  {
    q: 'Is overnight financing (swap) included?',
    a: `No. Swap and dividend adjustments are not modelled, so strategies that hold positions for
    many days will look marginally better here than in live trading.`,
  },
  {
    q: 'Can I save my own strategies?',
    a: `Code lives in the editor for the session and drawings are stored per symbol and timeframe in
    your browser. There is no server-side account, so keep a copy of any strategy you care about
    outside the app.`,
  },
];
