// ===========================================================================
// Fill refinement pass.
//
// The backtest engine fills at bar close using a constant spread. This pass
// takes the trades it produced and re-prices every fill against what the
// market actually showed at that instant:
//
//   FX / CFD (Dukascopy)  real bid/ask from hourly tick files. Stop and target
//                         exits are re-priced at the first tick that actually
//                         crossed the level, so gaps through a stop cost what
//                         they really cost instead of filling at the level.
//   Crypto (Binance)      size-dependent slippage from archived book depth,
//                         applied on top of the configured spread.
//
// The signal sequence is held FIXED. This answers "what did these trades really
// cost?", not "what would the strategy have done with better data" — changing
// fill prices can change subsequent signals, and re-running would no longer be
// a comparison. Every number this produces is labelled as a cost re-pricing.
//
// Only the bars where a fill happened are downloaded, so a 200-trade backtest
// costs a few hundred small files instead of a full tick history.
// ===========================================================================

const Refine = (() => {

  // Nudge back off the bar boundary so we read the last tick *inside* the bar
  // that produced the signal, not the first tick of the next one.
  const EPS = 0.001;

  async function run({ broker, symInfo, tfSec, onProgress }) {
    const trades = broker.closed;
    if (!trades.length) return null;

    BookStore.resetBudget();
    const book = new BookStore.Book(symInfo);

    // Only the instants where money changed hands.
    const spans = [];
    for (const t of trades) {
      spans.push([t.openTime, t.openTime + tfSec]);
      spans.push([t.closeTime, t.closeTime + tfSec]);
    }

    await book.preload(spans, f => onProgress && onProgress(f * 0.9, 'Downloading tick data…'));
    if (onProgress) onProgress(0.92, 'Re-pricing fills…');

    const rows = [];
    const pip = symInfo.pip || 0.0001;
    const units = symInfo.lotUnits || 1;

    for (const t of trades) {
      const row = {
        id: t.id, dir: t.dir, lots: t.lots,
        openTime: t.openTime, closeTime: t.closeTime, reason: t.reason,
        origEntry: t.entry, origExit: t.exit, origPnl: t.pnl,
        newEntry: t.entry, newExit: t.exit, newPnl: t.pnl,
        entrySlipPips: 0, exitSlipPips: 0,
        realSpreadPips: null, beyondBook: false, sameBarStop: false,
        refined: false,
      };

      if (book.kind === 'tick') {
        const qIn = book.quoteAt(t.openTime + tfSec - EPS);
        if (qIn) {
          row.newEntry = t.dir > 0 ? qIn.ask : qIn.bid;
          row.realSpreadPips = (qIn.ask - qIn.bid) / pip;
          row.refined = true;
        }

        let qOut = null;
        if (t.reason === 'sl' || t.reason === 'tp') {
          // Price the stop at the first tick that genuinely crossed it. A long
          // exits on the bid, a short on the ask, so each side is tested
          // against the quote it would actually have been filled on.
          //
          // The search may never start before the entry: the engine tests stops
          // against the whole bar's range, so a position opened and stopped
          // inside one bar can be "hit" by a price that printed before it
          // existed. Clamping to the entry instant keeps that impossible.
          const entryAt = t.openTime + tfSec;
          const from = Math.max(t.closeTime, entryAt);
          const to = t.closeTime + tfSec;
          if (from < to) {
            const lvl = t.exit;
            const test = t.dir > 0
              ? (t.reason === 'sl' ? (tk => tk.bid <= lvl) : (tk => tk.bid >= lvl))
              : (t.reason === 'sl' ? (tk => tk.ask >= lvl) : (tk => tk.ask <= lvl));
            const touch = book.firstTouch(from, to, test);
            if (touch) qOut = touch;
          } else {
            // Opened and stopped in the same bar: the position existed only at
            // that bar's close, so there is no window to search. Price it at
            // the close quote and count it — a run full of these is telling you
            // the strategy's stops are being triggered by bars it never traded.
            row.sameBarStop = true;
          }
        }
        if (!qOut) qOut = book.quoteAt(t.closeTime + tfSec - EPS);

        if (qOut) {
          row.newExit = t.dir > 0 ? qOut.bid : qOut.ask;
          row.refined = true;
        }
      } else if (book.kind === 'depth') {
        // Bars carry a single mid-ish price; the engine already charged the
        // configured spread. What is missing is the cost of size, so walk the
        // archived book for the entry and again for the exit. Slippage always
        // works against the trade, on both legs.
        const sIn = book.slippage(t.openTime + tfSec, t.lots, t.dir, t.entry);
        const sOut = book.slippage(t.closeTime + tfSec, t.lots, -t.dir, t.exit);
        if (sIn.known || sOut.known) {
          row.newEntry = t.entry + t.dir * sIn.price;
          row.newExit = t.exit - t.dir * sOut.price;
          row.beyondBook = sIn.beyondBook || sOut.beyondBook;
          row.refined = true;
        }
      }

      if (row.refined) {
        // Slip is signed so that a positive number always means "worse than the
        // backtest assumed", whichever way the trade was facing.
        row.entrySlipPips = t.dir * (row.newEntry - t.entry) / pip;
        row.exitSlipPips = -t.dir * (row.newExit - t.exit) / pip;
        const gross = (row.newExit - row.newEntry) * t.dir * t.lots * units;
        row.newPnl = gross - t.commission;
      }
      rows.push(row);
    }

    return summarise(rows, broker, book, symInfo);
  }

  function median(xs) {
    if (!xs.length) return 0;
    const a = [...xs].sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function summarise(rows, broker, book, symInfo) {
    const refined = rows.filter(r => r.refined);
    const origNet = rows.reduce((s, r) => s + r.origPnl, 0);
    const newNet = rows.reduce((s, r) => s + r.newPnl, 0);

    const spreads = refined.map(r => r.realSpreadPips).filter(x => x !== null && isFinite(x));
    const entrySlips = refined.map(r => r.entrySlipPips).filter(isFinite);
    const exitSlips = refined.map(r => r.exitSlipPips).filter(isFinite);

    // Trades whose sign flipped once real costs were applied — the ones whose
    // profitability was an artefact of the constant-spread assumption.
    const flippedToLoss = rows.filter(r => r.origPnl > 0 && r.newPnl <= 0).length;
    const flippedToWin = rows.filter(r => r.origPnl <= 0 && r.newPnl > 0).length;

    const newWins = rows.filter(r => r.newPnl > 0);
    const grossProfit = newWins.reduce((s, r) => s + r.newPnl, 0);
    const grossLoss = Math.abs(rows.filter(r => r.newPnl <= 0).reduce((s, r) => s + r.newPnl, 0));

    // Walk the same trade sequence in close order to get the drawdown the
    // re-priced fills would actually have produced.
    const byClose = [...rows].sort((a, b) => a.closeTime - b.closeTime);
    let eq = broker.initial, peak = broker.initial, maxDD = 0;
    for (const r of byClose) {
      eq += r.newPnl;
      peak = Math.max(peak, eq);
      maxDD = Math.max(maxDD, peak - eq);
    }

    // Worst offenders, for the detail table.
    const worst = [...refined].sort((a, b) => (a.newPnl - a.origPnl) - (b.newPnl - b.origPnl)).slice(0, 12);

    return {
      kind: book.kind,
      symbol: symInfo.sym,
      coverage: refined.length / rows.length,
      truncated: book.truncated,
      filesFetched: BookStore.filesFetched,
      totalTrades: rows.length,
      refinedTrades: refined.length,

      origNet, newNet, delta: newNet - origNet,
      deltaPct: origNet !== 0 ? (newNet - origNet) / Math.abs(origNet) * 100 : 0,

      origFinal: broker.initial + origNet,
      newFinal: broker.initial + newNet,
      initial: broker.initial,

      newProfitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
      newWinRate: rows.length ? newWins.length / rows.length * 100 : 0,
      newMaxDD: maxDD,
      newMaxDDpct: peak > 0 ? maxDD / peak * 100 : 0,

      spreadAvg: spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : null,
      spreadMedian: spreads.length ? median(spreads) : null,
      spreadMax: spreads.length ? Math.max(...spreads) : null,
      spreadMin: spreads.length ? Math.min(...spreads) : null,
      spreads,

      entrySlipAvg: entrySlips.length ? entrySlips.reduce((a, b) => a + b, 0) / entrySlips.length : 0,
      exitSlipAvg: exitSlips.length ? exitSlips.reduce((a, b) => a + b, 0) / exitSlips.length : 0,
      worstExitSlip: exitSlips.length ? Math.max(...exitSlips) : 0,
      beyondBookTrades: rows.filter(r => r.beyondBook).length,
      sameBarStops: rows.filter(r => r.sameBarStop).length,

      flippedToLoss, flippedToWin,
      rows, worst,
    };
  }

  return { run };
})();

window.Refine = Refine;
