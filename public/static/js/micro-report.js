// ===========================================================================
// Microstructure report — the "modelled fills vs the book that really existed"
// page of a backtest report. Rendered by BacktestUI after a refinement pass.
// ===========================================================================

const MicroReport = (() => {
  const $ = (s) => document.querySelector(s);

  function fmt$(v) {
    const n = Number(v) || 0;
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString(undefined, {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }
  function fmtPct(v) { const n = Number(v) || 0; return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function tcls(v) { return v > 0 ? 't-up' : v < 0 ? 't-down' : ''; }
  function ts(t) { return new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 16); }
  const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const REASON = {
    sl: 'Stop loss', tp: 'Take profit', margin_call: 'Margin call', reverse: 'Reversed',
    prop_fail: 'Rule breach', strategy: 'Strategy', manual: 'Manual', end: 'End of test',
  };

  function emptyState() {
    return '<div class="micro-intro">' +
      '<h4>Fills were priced from the model, not the book</h4>' +
      '<p>This run used the flat spread you configured and filled every order at the close of ' +
      'the signal bar. That is the standard assumption, and it is the one most likely to ' +
      'flatter a strategy that trades often, trades small moves, or trades around news.</p>' +
      '<p>Tick <b>Re-price fills against real order-book data</b> in the backtest dialog and run ' +
      'again. Every fill is then priced at the quote that actually existed: real bid/ask from ' +
      'Dukascopy tick files for forex, indices, commodities and share CFDs, and size-based ' +
      'slippage from Binance archived book depth for crypto. Stops are re-priced at the tick ' +
      'that genuinely crossed them, so a gap through a stop costs what it really cost.</p>' +
      '<p class="t-faint">Only the bars where a trade opened or closed get downloaded, so the ' +
      'extra cost is a few hundred small files rather than a full tick history.</p></div>';
  }

  function verdictOf(m) {
    if (!m.refinedTrades) {
      return ['No fill could be matched to book data, so the numbers below are unchanged from the modelled run.', 'warn'];
    }
    if (m.origNet > 0 && m.newNet <= 0) {
      return ['The edge does not survive real fills. Every dollar of this result came from the spread assumption.', 'bad'];
    }
    if (m.delta < 0 && Math.abs(m.deltaPct) > 30) {
      return [`Real fills take ${Math.abs(m.deltaPct).toFixed(0)}% off the result. The strategy still makes money, but it is far more fragile than the modelled run suggested.`, 'warn'];
    }
    if (m.delta < 0) {
      return [`Real fills cost ${fmt$(Math.abs(m.delta))}. The result holds up.`, 'ok'];
    }
    return ['Real fills came out no worse than the model — the spread you configured was pessimistic for this instrument at these hours.', 'ok'];
  }

  function kpiCards(m, stats) {
    const card = (label, value, cls, sub) =>
      `<div class="mk-card"><span class="mk-label">${label}</span>` +
      `<b class="mk-value ${cls || ''}">${value}</b>` +
      (sub ? `<span class="mk-sub">${sub}</span>` : '') + '</div>';

    const pf = isFinite(m.newProfitFactor) ? m.newProfitFactor.toFixed(2) : '∞';
    const oldPf = isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞';

    return card('Modelled net profit', fmt$(m.origNet), tcls(m.origNet), 'flat spread, fill at bar close') +
      card('Re-priced net profit', fmt$(m.newNet), tcls(m.newNet), 'real quotes at every fill') +
      card('Cost of realism', fmt$(m.delta), tcls(m.delta),
        m.origNet !== 0 ? fmtPct(m.deltaPct) + ' of the modelled result' : '') +
      card('Profit factor', pf, m.newProfitFactor >= 1 ? 't-up' : 't-down', 'was ' + oldPf) +
      card('Win rate', m.newWinRate.toFixed(1) + '%', '', 'was ' + stats.winRate.toFixed(1) + '%') +
      card('Max drawdown', fmt$(m.newMaxDD), 't-down', 'was ' + fmt$(stats.maxDD));
  }

  // Spread reality check — tick-based instruments only.
  function spreadBlock(m) {
    if (m.kind !== 'tick' || m.spreadAvg === null) return '';
    const cfgEl = $('#bt-spread');
    const cfg = cfgEl ? (parseFloat(cfgEl.value) || 0) : 0;
    const overs = m.spreads.filter(x => x > cfg).length;
    const overPct = m.spreads.length ? overs / m.spreads.length * 100 : 0;

    const lo = m.spreadMin, hi = m.spreadMax;
    const BINS = 18;
    const width = (hi - lo) || 1;
    const bins = new Array(BINS).fill(0);
    for (const x of m.spreads) {
      bins[Math.min(BINS - 1, Math.floor((x - lo) / width * BINS))]++;
    }
    const peak = Math.max(...bins, 1);
    const cfgBin = (cfg >= lo && cfg <= hi) ? Math.min(BINS - 1, Math.floor((cfg - lo) / width * BINS)) : -1;

    const cols = bins.map((n, i) => {
      const a = (lo + width * i / BINS).toFixed(2);
      const b = (lo + width * (i + 1) / BINS).toFixed(2);
      return `<div class="mh-col ${i === cfgBin ? 'mh-mark' : ''}" ` +
        `style="height:${(n / peak * 100).toFixed(1)}%" ` +
        `title="${a}–${b} pips: ${n} fills"></div>`;
    }).join('');

    return '<div class="card"><div class="card-head"><div class="card-title">The spread you assumed vs the spread you got</div></div>' +
      '<div class="card-body"><div class="micro-split"><table class="dt compact"><tbody>' +
      `<tr><td>Spread configured</td><td><b>${cfg.toFixed(2)}</b></td></tr>` +
      `<tr><td>Median at your fills</td><td><b>${m.spreadMedian.toFixed(2)}</b></td></tr>` +
      `<tr><td>Average at your fills</td><td><b>${m.spreadAvg.toFixed(2)}</b></td></tr>` +
      `<tr><td>Tightest</td><td>${lo.toFixed(2)}</td></tr>` +
      `<tr><td>Widest</td><td class="t-down"><b>${hi.toFixed(2)}</b></td></tr>` +
      `<tr><td>Fills above your assumption</td><td class="${overPct > 50 ? 't-down' : ''}">` +
      `<b>${overs}</b> of ${m.spreads.length} (${overPct.toFixed(0)}%)</td></tr>` +
      '</tbody></table>' +
      `<div class="micro-hist">${cols}` +
      `<div class="mh-axis"><span>${lo.toFixed(2)}</span><span>spread at fill (pips)</span><span>${hi.toFixed(2)}</span></div>` +
      '</div></div>' +
      '<p class="micro-note">The marked column is where your configured spread sits. Everything ' +
      'to the right of it is a fill that cost more than the backtest charged you.</p></div></div>';
  }

  // Size-vs-liquidity block — crypto only.
  function depthBlock(m) {
    if (m.kind !== 'depth') return '';
    return '<div class="card"><div class="card-head"><div class="card-title">What your size cost against real liquidity</div></div>' +
      '<div class="card-body"><table class="dt compact"><tbody>' +
      `<tr><td>Average slippage entering</td><td><b>${m.entrySlipAvg.toFixed(4)} pips</b></td></tr>` +
      `<tr><td>Average slippage exiting</td><td><b>${m.exitSlipAvg.toFixed(4)} pips</b></td></tr>` +
      `<tr><td>Worst single exit</td><td class="t-down"><b>${m.worstExitSlip.toFixed(4)} pips</b></td></tr>` +
      `<tr><td>Orders larger than the archived book</td><td class="${m.beyondBookTrades ? 't-down' : ''}">` +
      `<b>${m.beyondBookTrades}</b></td></tr></tbody></table>` +
      '<p class="micro-note">Depth is archived as cumulative resting notional at 1–5% from mid, ' +
      'once a minute. Slippage is read off that curve, so it is exact at those five bands and ' +
      'interpolated between them.' +
      (m.beyondBookTrades
        ? ' Orders that ran past the 5% band are extrapolated — treat those as a floor on the true cost, not a measurement of it.'
        : '') +
      '</p></div></div>';
  }

  // Same-bar entry-and-stop is an engine artefact worth surfacing: the bar's
  // range is tested against the stop even for the part that printed before the
  // position opened, so these exits cannot be priced from ticks honestly.
  function sameBarBlock(m) {
    if (!m.sameBarStops) return '';
    const n = m.sameBarStops;
    return '<div class="callout warn" style="margin-top:18px">' +
      '<i class="fa-solid fa-triangle-exclamation"></i><div>' +
      `<b>${n}</b> ${n === 1 ? 'trade was' : 'trades were'} opened and stopped inside a single bar. ` +
      'The engine tests a stop against the whole bar&rsquo;s high and low, including the part that ' +
      'printed before the position existed, so those stops fired on prices the trade never saw. ' +
      `${n === 1 ? 'It was' : 'They were'} priced at the bar-close quote rather than a touch, and ` +
      'the underlying signal is worth a second look — a stop this tight relative to the bar is ' +
      'usually better tested on a lower timeframe.</div></div>';
  }

  function flipBlock(m) {
    if (!m.flippedToLoss && !m.flippedToWin) return '';
    const other = m.flippedToWin ? `, and ${m.flippedToWin} went the other way` : '';
    return `<div class="callout ${m.flippedToLoss ? 'warn' : ''}" style="margin-top:18px">` +
      '<i class="fa-solid fa-arrow-right-arrow-left"></i><div>' +
      `<b>${m.flippedToLoss}</b> winning ${m.flippedToLoss === 1 ? 'trade' : 'trades'} became ` +
      `${m.flippedToLoss === 1 ? 'a loser' : 'losers'} at real prices${other}. ` +
      'Those were inside the spread all along.</div></div>';
  }

  function worstBlock(m, digits) {
    if (!m.worst.length) return '';
    const rows = m.worst.map(r => {
      const d = r.newPnl - r.origPnl;
      return '<tr>' +
        `<td>#${r.id}</td>` +
        `<td class="${r.dir > 0 ? 't-up' : 't-down'}">${r.dir > 0 ? 'Long' : 'Short'}</td>` +
        `<td>${r.lots}</td><td>${ts(r.closeTime)}</td>` +
        `<td>${esc(REASON[r.reason] || r.reason)}</td>` +
        `<td>${r.origExit.toFixed(digits)}</td><td>${r.newExit.toFixed(digits)}</td>` +
        `<td class="${r.exitSlipPips > 0 ? 't-down' : ''}">${r.exitSlipPips.toFixed(2)}</td>` +
        `<td class="${tcls(d)}"><b>${fmt$(d)}</b></td></tr>`;
    }).join('');

    return '<div class="card" style="margin-top:14px"><div class="card-head"><div class="card-title">Where realism hurt most</div>' +
      `<span class="pill">${m.worst.length} worst fills</span></div>` +
      '<div class="card-body" style="padding:0"><div class="table-wrap"><table class="dt compact"><thead><tr>' +
      '<th>#</th><th>Side</th><th>Lots</th><th>Closed</th><th>Reason</th>' +
      '<th>Modelled exit</th><th>Real exit</th><th>Slip (pips)</th><th>P/L change</th>' +
      `</tr></thead><tbody>${rows}</tbody></table></div></div></div>`;
  }

  function render(m, stats, symInfo) {
    const host = $('#micro-body');
    if (!host) return;
    if (!m) { host.innerHTML = emptyState(); return; }

    const [verdict, vcls] = verdictOf(m);
    const cover = (m.coverage * 100).toFixed(0);
    const digits = (symInfo && symInfo.digits) ?? 5;

    host.innerHTML =
      `<div class="micro-verdict ${vcls}">${verdict}</div>` +
      `<div class="mk-grid">${kpiCards(m, stats)}</div>` +
      '<div class="callout" style="margin-top:16px"><i class="fa-solid fa-circle-info"></i><div>' +
      'The trade sequence is held fixed — this re-prices the fills the strategy already made, it ' +
      'does not re-run it. Changing fill prices would change later signals, and then there would ' +
      'be nothing to compare against. ' +
      `Book data matched <b>${cover}%</b> of fills, across ${m.filesFetched} files.` +
      (m.truncated ? ' <b>File budget reached</b> — later trades were left at modelled prices.' : '') +
      '</div></div>' +
      flipBlock(m) + sameBarBlock(m) +
      `<div style="margin-top:22px">${spreadBlock(m)}${depthBlock(m)}</div>` +
      worstBlock(m, digits);
  }

  return { render };
})();

window.MicroReport = MicroReport;
