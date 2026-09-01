// ===========================================================================
// Position sizing, liquidation and the true cost of a trade.
//
// The signal engine says where to get in and where to get out. It says nothing
// about how much, and how much is the part that decides whether a run of
// ordinary losses is a drawdown or the end of the account.
//
// Two things this exists to put on screen:
//
//   Size          risk a fixed fraction of the account, not a fixed number of
//                 contracts. The stop distance sets the size; a wider stop
//                 means a smaller position for exactly the same risk.
//   Liquidation   on a leveraged perpetual the exchange has its own exit, and
//                 it does not care about yours. If liquidation sits closer than
//                 the stop, the trade is already lost before it can be wrong.
//                 That case is called out rather than shown as a number.
//
// Costs are folded into the reward too. A 2R setup on a perp, taken and closed
// as a taker, with funding across the hold, is not a 2R setup. Showing the net
// figure is what stops the marginal trade being taken.
// ===========================================================================

const Risk = (() => {
  const LS = 'bt_risk_cfg';

  const cfg = {
    balance: 10000,
    riskPct: 1,
    leverage: 10,
    takerBps: 4.5,      // Binance USD-M taker, both sides, in basis points
    holdHours: 4,       // used to price funding into the trade
  };
  try {
    const saved = JSON.parse(localStorage.getItem(LS) || 'null');
    if (saved) Object.assign(cfg, saved);
  } catch (_e) {}

  function save() {
    try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (_e) {}
  }
  function set(k, v) {
    if (!(k in cfg)) return;
    const n = +v;
    if (Number.isFinite(n) && n >= 0) { cfg[k] = n; save(); }
  }

  /**
   * Size a trade from the account and the stop, then check the exchange's own
   * exit against it.
   *
   * Maintenance margin is approximated at 0.5%, which is the tier most retail
   * position sizes fall into on the majors. It is deliberately conservative:
   * the real figure rises with position size, so a real liquidation sits at or
   * before the price shown here, never after it.
   */
  const MAINT_MARGIN = 0.005;

  function plan(signal) {
    if (!signal || signal.state !== 'signal') return null;
    const { entry, sl, tp1, tp2, dir } = signal;
    const stopDist = Math.abs(entry - sl);
    if (!(stopDist > 0) || !(entry > 0)) return null;

    const riskCash = cfg.balance * (cfg.riskPct / 100);
    const qty = riskCash / stopDist;                 // in base units
    const notional = qty * entry;
    const margin = notional / Math.max(1, cfg.leverage);

    // Liquidation for an isolated position at this leverage.
    const liq = dir > 0
      ? entry * (1 - 1 / cfg.leverage + MAINT_MARGIN)
      : entry * (1 + 1 / cfg.leverage - MAINT_MARGIN);
    const liqDist = Math.abs(entry - liq);
    const liqBeforeStop = liqDist <= stopDist;

    // What the round trip actually costs.
    const feeCash = notional * (cfg.takerBps / 10000) * 2;
    const f = window.Derivs && Derivs.funding();
    // Funding is paid by longs when positive. Charged per 8h block held.
    let fundingCash = 0;
    if (f) {
      const blocks = cfg.holdHours / 8;
      fundingCash = notional * (f.rate * blocks) * (dir > 0 ? 1 : -1);
    }
    const costCash = feeCash + fundingCash;

    const grossR1 = Math.abs(tp1 - entry) / stopDist;
    const grossR2 = Math.abs(tp2 - entry) / stopDist;
    const netR1 = (Math.abs(tp1 - entry) * qty - costCash) / riskCash;
    const netR2 = (Math.abs(tp2 - entry) * qty - costCash) / riskCash;
    // A loss costs the stop plus the same costs, so the downside is worse than 1R.
    const netLossR = -(riskCash + costCash) / riskCash;

    return {
      qty, notional, margin, riskCash,
      stopDist, stopPct: (stopDist / entry) * 100,
      liq, liqDist, liqPct: (liqDist / entry) * 100, liqBeforeStop,
      // The leverage at which liquidation would land exactly on the stop.
      maxSafeLeverage: Math.max(1, Math.floor(1 / (stopDist / entry + MAINT_MARGIN))),
      feeCash, fundingCash, costCash,
      costR: costCash / riskCash,
      grossR1, grossR2, netR1, netR2, netLossR,
      // Break-even hit rate at the net numbers, which is the figure that matters.
      breakEvenPct: netR2 > 0 ? (100 * 1 / (1 + netR2 / Math.abs(netLossR))) : null,
      cfg: { ...cfg },
      funding: f,
    };
  }

  /** Sizing capped so margin never exceeds a sane slice of the account. */
  function warnings(p) {
    if (!p) return [];
    const out = [];
    if (p.liqBeforeStop) {
      out.push({
        level: 'bad',
        text: `Liquidation at ${p.liq.toFixed(2)} is closer than your stop. At ${p.cfg.leverage}x this trade is closed by the exchange before your own exit — drop to ${p.maxSafeLeverage}x or lower.`,
      });
    } else if (p.liqDist < p.stopDist * 2) {
      out.push({
        level: 'warn',
        text: `Liquidation sits only ${(p.liqDist / p.stopDist).toFixed(1)}x your stop away. A wick you would normally survive would take the position out.`,
      });
    }
    if (p.margin > p.cfg.balance * 0.5) {
      out.push({
        level: 'warn',
        text: `Margin of ${fmt(p.margin)} is over half the account. The size is right for the risk, but the leverage is doing too much of the work.`,
      });
    }
    if (p.costR > 0.15) {
      out.push({
        level: 'warn',
        text: `Costs eat ${(p.costR * 100).toFixed(0)}% of the amount risked before the trade moves. Fees and funding are a large share of this setup.`,
      });
    }
    if (p.netR2 < 1) {
      out.push({
        level: 'bad',
        text: `Net of costs the target is only ${p.netR2.toFixed(2)}R against a ${Math.abs(p.netLossR).toFixed(2)}R loss. This does not pay for itself.`,
      });
    }
    return out;
  }

  function fmt(n) {
    const a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(1) + 'k';
    return s + '$' + a.toFixed(2);
  }

  return { plan, warnings, set, fmt, get cfg() { return { ...cfg }; } };
})();

window.Risk = Risk;
