// ===========================================================================
// Backtest / trading engine.
// Broker model: netting-free hedging account, market orders filled at
// close of signal bar (+spread on entry for buys / on exit for sells),
// SL/TP checked intrabar against high/low (conservative: SL first).
// Leverage/margin, commission per lot per side, prop-firm rule tracking.
// ===========================================================================

class Broker {
  constructor(opts) {
    this.initial = opts.balance;
    this.balance = opts.balance;
    this.leverage = opts.leverage || 100;
    this.spread = opts.spread ?? 0;            // in pips/points (symInfo.pip units)
    this.commission = opts.commission ?? 0;    // $ per lot per side
    this.symInfo = opts.symInfo;
    this.positions = [];                       // open
    this.closed = [];                          // closed trades
    this.equitySeries = [];                    // {time, equity, balance}
    this.nextId = 1;

    // prop firm
    this.prop = opts.prop || null;             // {targetPct, dailyPct, maxPct, ddType}
    this.propState = this.prop ? {
      status: 'active',                        // active | failed_daily | failed_max | passed
      failTime: null, passTime: null,
      dayStartEquity: opts.balance, dayKey: null,
      peakEquity: opts.balance,
      worstDailyPnl: 0, maxDrawdownSeen: 0,
      dailyLog: [],                            // {day, startEq, endEq, minEq, pnl}
      curDay: null,
    } : null;
  }

  get spreadPrice() { return this.spread * this.symInfo.pip; }

  contractValue(price, lots) { return lots * this.symInfo.lotUnits * price; }

  marginRequired(price, lots) { return this.contractValue(price, lots) / this.leverage; }

  usedMargin(price) {
    return this.positions.reduce((s, p) => s + this.marginRequired(price, p.lots), 0);
  }

  floatPnl(bid) {
    let pnl = 0;
    for (const p of this.positions) pnl += this.posPnl(p, bid);
    return pnl;
  }

  posPnl(p, bid) {
    const ask = bid + this.spreadPrice;
    // long closes at bid, short closes at ask
    const cur = p.dir > 0 ? bid : ask;
    return (cur - p.entry) * p.dir * p.lots * this.symInfo.lotUnits;
  }

  equity(bid) { return this.balance + this.floatPnl(bid); }

  open(dir, lots, bar, sl = null, tp = null, comment = '') {
    const bid = bar.close;
    const ask = bid + this.spreadPrice;
    const entry = dir > 0 ? ask : bid;
    const margin = this.marginRequired(entry, lots);
    const free = this.equity(bid) - this.usedMargin(bid);
    if (margin > free) return null; // rejected: not enough margin
    const commission = this.commission * lots;
    this.balance -= commission;
    const pos = {
      id: this.nextId++, dir, lots, entry, sl, tp,
      openTime: bar.time, comment, commissionPaid: commission,
    };
    this.positions.push(pos);
    return pos;
  }

  close(pos, price, time, reason) {
    const idx = this.positions.indexOf(pos);
    if (idx < 0) return;
    this.positions.splice(idx, 1);
    const commission = this.commission * pos.lots;
    const pnl = (price - pos.entry) * pos.dir * pos.lots * this.symInfo.lotUnits;
    this.balance += pnl - commission;
    this.closed.push({
      id: pos.id, dir: pos.dir, lots: pos.lots,
      entry: pos.entry, exit: price,
      openTime: pos.openTime, closeTime: time,
      pnl: pnl - commission - pos.commissionPaid,
      grossPnl: pnl, commission: commission + pos.commissionPaid,
      reason, comment: pos.comment,
    });
  }

  closeAll(bar, reason = 'manual') {
    const bid = bar.close, ask = bid + this.spreadPrice;
    for (const p of [...this.positions]) this.close(p, p.dir > 0 ? bid : ask, bar.time, reason);
  }

  // Process one bar: check SL/TP intrabar, margin call, prop rules, record equity
  onBar(bar) {
    const spr = this.spreadPrice;
    // intrabar SL/TP — conservative ordering: for each pos, check SL first
    for (const p of [...this.positions]) {
      if (p.dir > 0) {
        // long: exits at bid prices (bar prices are bid)
        if (p.sl !== null && bar.low <= p.sl) { this.close(p, p.sl, bar.time, 'sl'); continue; }
        if (p.tp !== null && bar.high >= p.tp) { this.close(p, p.tp, bar.time, 'tp'); continue; }
      } else {
        // short: exits at ask = bid + spread
        if (p.sl !== null && bar.high + spr >= p.sl) { this.close(p, p.sl, bar.time, 'sl'); continue; }
        if (p.tp !== null && bar.low + spr <= p.tp) { this.close(p, p.tp, bar.time, 'tp'); continue; }
      }
    }

    // margin call / stop out at 50% margin level
    const eq = this.equity(bar.close);
    const um = this.usedMargin(bar.close);
    if (um > 0 && eq / um < 0.5) {
      this.closeAll(bar, 'margin_call');
    }

    // worst-case intrabar equity for prop-firm daily/max DD checks
    let worstEq = this.balance;
    for (const p of this.positions) {
      const worstPrice = p.dir > 0 ? bar.low : bar.high + spr;
      worstEq += (worstPrice - p.entry) * p.dir * p.lots * this.symInfo.lotUnits;
    }
    worstEq = Math.min(worstEq, eq);

    if (this.propState && this.propState.status === 'active') this.checkProp(bar, eq, worstEq);

    this.equitySeries.push({ time: bar.time, equity: eq, balance: this.balance });
  }

  checkProp(bar, eq, worstEq) {
    const ps = this.propState, rules = this.prop;
    const dayKey = Math.floor(bar.time / 86400);
    if (ps.dayKey === null || dayKey !== ps.dayKey) {
      // close out previous day log
      if (ps.curDay) ps.dailyLog.push(ps.curDay);
      ps.dayKey = dayKey;
      ps.dayStartEquity = eq;
      ps.curDay = { day: dayKey * 86400, startEq: eq, endEq: eq, minEq: eq, pnl: 0 };
    }
    ps.curDay.endEq = eq;
    ps.curDay.minEq = Math.min(ps.curDay.minEq, worstEq);
    ps.curDay.pnl = eq - ps.curDay.startEq;
    ps.peakEquity = Math.max(ps.peakEquity, eq);

    // daily loss (relative to day-start equity)
    const dailyLossLimit = ps.dayStartEquity * rules.dailyPct / 100;
    const dailyPnlWorst = worstEq - ps.dayStartEquity;
    ps.worstDailyPnl = Math.min(ps.worstDailyPnl, dailyPnlWorst);
    if (dailyPnlWorst <= -dailyLossLimit) {
      ps.status = 'failed_daily'; ps.failTime = bar.time; return;
    }

    // max drawdown
    const ddBase = rules.ddType === 'trailing' ? ps.peakEquity : this.initial;
    const maxLoss = ddBase * rules.maxPct / 100;
    const dd = ddBase - worstEq;
    ps.maxDrawdownSeen = Math.max(ps.maxDrawdownSeen, dd);
    if (dd >= maxLoss) {
      ps.status = 'failed_max'; ps.failTime = bar.time; return;
    }

    // profit target
    if (rules.targetPct > 0 && eq >= this.initial * (1 + rules.targetPct / 100)) {
      ps.status = 'passed'; ps.passTime = bar.time;
    }
  }

  finishProp() {
    if (this.propState && this.propState.curDay) {
      this.propState.dailyLog.push(this.propState.curDay);
      this.propState.curDay = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------
function computeStats(broker, candles) {
  const trades = broker.closed;
  const eq = broker.equitySeries;
  const initial = broker.initial;
  const final = eq.length ? eq[eq.length - 1].equity : broker.balance;

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  // max drawdown from equity curve
  let peak = -Infinity, maxDD = 0, maxDDpct = 0;
  for (const e of eq) {
    peak = Math.max(peak, e.equity);
    const dd = peak - e.equity;
    if (dd > maxDD) { maxDD = dd; maxDDpct = dd / peak * 100; }
  }

  // sharpe (per-bar returns, annualized approx by bar count/year)
  let sharpe = 0;
  if (eq.length > 2) {
    const rets = [];
    for (let i = 1; i < eq.length; i++) rets.push(eq[i].equity / eq[i - 1].equity - 1);
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
    const barSec = candles.length > 1 ? candles[1].time - candles[0].time : 3600;
    const barsPerYear = 31536000 / barSec;
    sharpe = sd > 0 ? (mean / sd) * Math.sqrt(barsPerYear) : 0;
  }

  const holdTimes = trades.map(t => t.closeTime - t.openTime);

  // monthly breakdown
  const monthly = new Map(); // 'YYYY-MM' -> {pnl, trades, wins}
  for (const t of trades) {
    const d = new Date(t.closeTime * 1000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!monthly.has(key)) monthly.set(key, { pnl: 0, trades: 0, wins: 0 });
    const m = monthly.get(key);
    m.pnl += t.pnl; m.trades++; if (t.pnl > 0) m.wins++;
  }
  // monthly equity % (based on balance at month boundaries)
  const monthlyPct = new Map();
  if (eq.length) {
    let curKey = null, startBal = initial;
    for (const e of eq) {
      const d = new Date(e.time * 1000);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (key !== curKey) {
        if (curKey !== null) { /* close prev */ }
        if (curKey !== null) monthlyPct.set(curKey, (lastEq / startBal - 1) * 100);
        curKey = key; startBal = lastEq ?? initial;
      }
      var lastEq = e.equity;
    }
    if (curKey !== null) monthlyPct.set(curKey, (lastEq / startBal - 1) * 100);
  }

  let maxConsecW = 0, maxConsecL = 0, curW = 0, curL = 0;
  for (const t of trades) {
    if (t.pnl > 0) { curW++; curL = 0; } else { curL++; curW = 0; }
    maxConsecW = Math.max(maxConsecW, curW);
    maxConsecL = Math.max(maxConsecL, curL);
  }

  return {
    initial, final,
    netProfit: final - initial,
    netProfitPct: (final / initial - 1) * 100,
    grossProfit, grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
    totalTrades: trades.length,
    wins: wins.length, losses: losses.length,
    winRate: trades.length ? wins.length / trades.length * 100 : 0,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    avgTrade: trades.length ? (final - initial) / trades.length : 0,
    largestWin: wins.length ? Math.max(...wins.map(t => t.pnl)) : 0,
    largestLoss: losses.length ? Math.min(...losses.map(t => t.pnl)) : 0,
    maxDD, maxDDpct, sharpe,
    maxConsecWins: maxConsecW, maxConsecLosses: maxConsecL,
    avgHoldSec: holdTimes.length ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0,
    totalCommission: trades.reduce((s, t) => s + t.commission, 0),
    monthly, monthlyPct,
    equitySeries: eq,
    trades,
  };
}

window.Broker = Broker;
window.computeStats = computeStats;
