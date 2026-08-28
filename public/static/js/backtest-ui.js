// ===========================================================================
// Backtest UI — run flow, results rendering (overview, performance, trades,
// monthly, prop firm report), equity curve chart.
// ===========================================================================
const BacktestUI = (() => {
  const $ = (s) => document.querySelector(s);
  let equityChart = null, equitySeries = null;
  let lastStats = null;

  function fmt$(v) { return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtPct(v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }
  function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }
  function fmtDur(sec) {
    if (sec < 3600) return Math.round(sec / 60) + 'm';
    if (sec < 86400) return (sec / 3600).toFixed(1) + 'h';
    return (sec / 86400).toFixed(1) + 'd';
  }

  function propFromUI() {
    const mode = $('#bt-propfirm').value;
    switch (mode) {
      case 'ftmo1': return { targetPct: 10, dailyPct: 5, maxPct: 10, ddType: 'static' };
      case 'ftmo2': return { targetPct: 5, dailyPct: 5, maxPct: 10, ddType: 'static' };
      case 'funded': return { targetPct: 0, dailyPct: 5, maxPct: 10, ddType: 'static' };
      case 'custom': return {
        targetPct: parseFloat($('#pf-c-target').value) || 0,
        dailyPct: parseFloat($('#pf-c-daily').value) || 5,
        maxPct: parseFloat($('#pf-c-max').value) || 10,
        ddType: $('#pf-c-ddtype').value,
      };
      default: return null;
    }
  }

  async function runBacktest() {
    const sym = window.App.currentSymbol;
    const tf = window.App.currentTF;
    const info = window.App.currentSymbolInfo;
    const lang = $('#strategy-lang').value;
    const code = $('#strategy-code').value;

    const v = StrategyRunner.validate(lang, code);
    if (!v.ok) { window.App.toast('Strategy error: ' + v.error); return; }

    const fromSec = Date.parse($('#bt-start').value + 'T00:00:00Z') / 1000;
    const toSec = Date.parse($('#bt-end').value + 'T23:59:59Z') / 1000;
    if (!(fromSec < toSec)) { window.App.toast('Invalid date range'); return; }

    const progress = $('#bt-progress'), fill = $('#bt-progress-fill'), ptext = $('#bt-progress-text');
    progress.classList.remove('hidden');
    const setP = (frac, label) => { fill.style.width = (frac * 100).toFixed(0) + '%'; ptext.textContent = label || (frac * 100).toFixed(0) + '%'; };

    try {
      setP(0.02, 'Downloading data…');
      const candles = await DataStore.load(sym, tf, fromSec, toSec, f => setP(0.02 + f * 0.45, 'Downloading data… ' + Math.round(f * 100) + '%'));
      if (candles.length < 30) { window.App.toast('Not enough data in range (' + candles.length + ' bars)'); progress.classList.add('hidden'); return; }

      const broker = new Broker({
        balance: parseFloat($('#bt-balance').value) || 100000,
        leverage: parseInt($('#bt-leverage').value) || 100,
        spread: parseFloat($('#bt-spread').value) || 0,
        commission: parseFloat($('#bt-commission').value) || 0,
        symInfo: info,
        prop: propFromUI(),
      });

      setP(0.5, 'Running strategy…');
      await StrategyRunner.run(lang, code, candles, broker,
        f => setP(0.5 + f * 0.45, 'Running… ' + Math.round(f * 100) + '%'),
        msg => setP(0.5, msg));

      // close any remaining positions at end
      if (broker.positions.length) broker.closeAll(candles[candles.length - 1], 'end');

      setP(0.97, 'Computing stats…');
      const stats = computeStats(broker, candles);
      lastStats = { stats, broker, candles, sym, tf };

      renderResults(stats, broker, candles);
      renderChartMarkers(broker, candles);
      setP(1, 'Done');
      setTimeout(() => progress.classList.add('hidden'), 600);
      window.App.closeModals();
      // switch bottom tab to tester
      document.querySelector('.bp-tab[data-tab="tester"]').click();
      $('#bottom-panel').classList.remove('collapsed');
    } catch (e) {
      console.error(e);
      window.App.toast('Backtest failed: ' + e.message);
      progress.classList.add('hidden');
    }
  }

  function renderChartMarkers(broker, candles) {
    // show trades on the main chart
    ChartMgr.setData(candles, window.App.currentSymbolInfo);
    const markers = [];
    for (const t of broker.closed) {
      markers.push({
        time: t.openTime, position: t.dir > 0 ? 'belowBar' : 'aboveBar',
        color: t.dir > 0 ? '#26a69a' : '#ef5350',
        shape: t.dir > 0 ? 'arrowUp' : 'arrowDown',
        text: (t.dir > 0 ? 'L' : 'S') + t.lots,
      });
      markers.push({
        time: t.closeTime, position: t.dir > 0 ? 'aboveBar' : 'belowBar',
        color: t.pnl >= 0 ? '#26a69a' : '#ef5350',
        shape: 'circle',
        text: (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(0),
      });
    }
    markers.sort((a, b) => a.time - b.time);
    ChartMgr.setMarkers(markers.slice(0, 500)); // cap for perf
  }

  function renderResults(s, broker, candles) {
    $('#tester-empty').classList.add('hidden');
    $('#tester-results').classList.remove('hidden');

    // ---- overview stats ----
    const rows = [
      ['Net Profit', `<b class="${cls(s.netProfit)}">${fmt$(s.netProfit)} (${fmtPct(s.netProfitPct)})</b>`],
      ['Final Equity', `<b>${fmt$(s.final)}</b>`],
      ['Total Trades', `<b>${s.totalTrades}</b>`],
      ['Win Rate', `<b>${s.winRate.toFixed(1)}%</b>`],
      ['Profit Factor', `<b>${isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}</b>`],
      ['Max Drawdown', `<b class="down">${fmt$(s.maxDD)} (${s.maxDDpct.toFixed(2)}%)</b>`],
      ['Sharpe Ratio', `<b>${s.sharpe.toFixed(2)}</b>`],
      ['Avg Trade', `<b class="${cls(s.avgTrade)}">${fmt$(s.avgTrade)}</b>`],
    ];
    $('#ov-stats').innerHTML = rows.map(r => `<div class="ov-stat"><span>${r[0]}</span>${r[1]}</div>`).join('');

    // ---- equity chart ----
    renderEquityChart(s.equitySeries, broker.initial);

    // ---- performance table ----
    const perf = [
      ['Initial Balance', fmt$(s.initial)], ['Final Equity', fmt$(s.final)],
      ['Net Profit', fmt$(s.netProfit) + ' (' + fmtPct(s.netProfitPct) + ')'],
      ['Gross Profit', fmt$(s.grossProfit)], ['Gross Loss', fmt$(-s.grossLoss)],
      ['Profit Factor', isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'],
      ['Sharpe Ratio (annualized)', s.sharpe.toFixed(2)],
      ['Max Drawdown', fmt$(s.maxDD) + ' (' + s.maxDDpct.toFixed(2) + '%)'],
      ['Total Trades', s.totalTrades], ['Winning Trades', s.wins], ['Losing Trades', s.losses],
      ['Win Rate', s.winRate.toFixed(2) + '%'],
      ['Average Win', fmt$(s.avgWin)], ['Average Loss', fmt$(-s.avgLoss)],
      ['Largest Win', fmt$(s.largestWin)], ['Largest Loss', fmt$(s.largestLoss)],
      ['Max Consecutive Wins', s.maxConsecWins], ['Max Consecutive Losses', s.maxConsecLosses],
      ['Avg Hold Time', fmtDur(s.avgHoldSec)],
      ['Total Commission Paid', fmt$(s.totalCommission)],
    ];
    $('#perf-table').innerHTML = '<table class="bt-table">' +
      perf.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('') + '</table>';

    // ---- trades table ----
    const dg = window.App.currentSymbolInfo.digits;
    $('#trades-table').innerHTML = `<table class="bt-table">
      <thead><tr><th>#</th><th>Side</th><th>Lots</th><th>Entry Time</th><th>Entry</th><th>Exit Time</th><th>Exit</th><th>Reason</th><th>PnL</th><th>PnL %</th></tr></thead>
      <tbody>` + broker.closed.map((t, i) => {
        const pnlPct = t.pnl / s.initial * 100;
        return `<tr>
          <td>${i + 1}</td>
          <td><span class="badge ${t.dir > 0 ? 'long' : 'short'}">${t.dir > 0 ? 'LONG' : 'SHORT'}</span></td>
          <td>${t.lots}</td>
          <td>${ts(t.openTime)}</td><td>${t.entry.toFixed(dg)}</td>
          <td>${ts(t.closeTime)}</td><td>${t.exit.toFixed(dg)}</td>
          <td>${t.reason.toUpperCase()}</td>
          <td class="${cls(t.pnl)}">${fmt$(t.pnl)}</td>
          <td class="${cls(t.pnl)}">${fmtPct(pnlPct)}</td>
        </tr>`;
      }).join('') + '</tbody></table>';

    // ---- monthly table ----
    renderMonthly(s);

    // ---- prop firm report ----
    renderPropReport(broker, s);
  }

  function ts(t) {
    return new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 16);
  }

  function renderMonthly(s) {
    if (s.monthly.size === 0) { $('#monthly-table').innerHTML = '<p style="color:#666;padding:20px">No closed trades.</p>'; return; }
    // build year -> month grid
    const byYear = new Map();
    for (const [key, m] of s.monthly) {
      const [y, mo] = key.split('-');
      if (!byYear.has(y)) byYear.set(y, {});
      byYear.get(y)[+mo] = { ...m, pct: s.monthlyPct.get(key) ?? 0 };
    }
    const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let html = '<table class="bt-table"><thead><tr><th>Year</th>' + MN.map(m => `<th>${m}</th>`).join('') + '<th>Total</th></tr></thead><tbody>';
    for (const [y, months] of [...byYear.entries()].sort()) {
      let yearPnl = 0;
      html += `<tr><td><b>${y}</b></td>`;
      for (let m = 1; m <= 12; m++) {
        const d = months[m];
        if (!d) { html += '<td>—</td>'; continue; }
        yearPnl += d.pnl;
        html += `<td class="${d.pnl >= 0 ? 'pos' : 'neg'}" title="${d.trades} trades, ${d.wins} wins">${fmt$(d.pnl)}<br><small>${fmtPct(d.pct)}</small></td>`;
      }
      html += `<td class="${yearPnl >= 0 ? 'pos' : 'neg'}"><b>${fmt$(yearPnl)}</b></td></tr>`;
    }
    html += '</tbody></table>';
    $('#monthly-table').innerHTML = html;
  }

  function renderPropReport(broker, s) {
    const el = $('#propfirm-report');
    if (!broker.prop) {
      el.innerHTML = '<p style="color:#666;padding:20px">Prop firm mode was off for this backtest. Enable it in Backtest Settings.</p>';
      return;
    }
    const ps = broker.propState;
    const r = broker.prop;
    let status, statusCls;
    switch (ps.status) {
      case 'passed': status = '✔ CHALLENGE PASSED'; statusCls = 'ok'; break;
      case 'failed_daily': status = '✘ FAILED — Daily loss limit breached'; statusCls = 'fail'; break;
      case 'failed_max': status = '✘ FAILED — Max drawdown breached'; statusCls = 'fail'; break;
      default: status = r.targetPct > 0 ? '— Target not reached (still active)' : '— Account survived (funded mode)'; statusCls = ps.status === 'active' ? 'ok' : 'fail';
    }
    let html = `<div class="pf-big ${statusCls}">${status}</div>`;
    html += `<table class="bt-table">
      <tr><td>Profit Target</td><td>${r.targetPct > 0 ? r.targetPct + '% (' + fmt$(broker.initial * r.targetPct / 100) + ')' : 'None'}</td></tr>
      <tr><td>Daily Loss Limit</td><td>${r.dailyPct}% (${fmt$(broker.initial * r.dailyPct / 100)})</td></tr>
      <tr><td>Max Drawdown (${r.ddType})</td><td>${r.maxPct}% (${fmt$(broker.initial * r.maxPct / 100)})</td></tr>
      <tr><td>Worst Daily PnL seen</td><td class="down">${fmt$(ps.worstDailyPnl)}</td></tr>
      <tr><td>Max Drawdown seen</td><td class="down">${fmt$(ps.maxDrawdownSeen)}</td></tr>
      ${ps.failTime ? `<tr><td>Failed at</td><td>${ts(ps.failTime)}</td></tr>` : ''}
      ${ps.passTime ? `<tr><td>Passed at</td><td>${ts(ps.passTime)}</td></tr>` : ''}
    </table>`;
    // daily log
    if (ps.dailyLog.length) {
      html += '<h4 style="margin:14px 0 6px;color:#aaa">Daily Breakdown</h4><table class="bt-table"><thead><tr><th>Day</th><th>Start Eq</th><th>End Eq</th><th>Min Eq (intrabar)</th><th>Day PnL</th></tr></thead><tbody>';
      for (const d of ps.dailyLog.slice(-60)) {
        html += `<tr><td>${new Date(d.day * 1000).toISOString().slice(0, 10)}</td>
          <td>${fmt$(d.startEq)}</td><td>${fmt$(d.endEq)}</td><td>${fmt$(d.minEq)}</td>
          <td class="${cls(d.pnl)}">${fmt$(d.pnl)}</td></tr>`;
      }
      html += '</tbody></table>';
    }
    el.innerHTML = html;
  }

  function renderEquityChart(eqSeries, initial) {
    const el = $('#equity-chart');
    el.innerHTML = '';
    equityChart = LightweightCharts.createChart(el, {
      layout: { background: { type: 'solid', color: '#000000' }, textColor: '#888', fontSize: 10 },
      grid: { vertLines: { color: '#111' }, horzLines: { color: '#111' } },
      rightPriceScale: { borderColor: '#222' },
      timeScale: { borderColor: '#222', timeVisible: true },
      autoSize: true,
      handleScroll: false, handleScale: false,
    });
    equitySeries = equityChart.addAreaSeries({
      lineColor: '#ffffff', topColor: 'rgba(255,255,255,0.15)', bottomColor: 'rgba(255,255,255,0.0)',
      lineWidth: 1.5, priceLineVisible: false,
    });
    // thin the series for perf
    const step = Math.max(1, Math.floor(eqSeries.length / 2000));
    const data = [];
    for (let i = 0; i < eqSeries.length; i += step) data.push({ time: eqSeries[i].time, value: eqSeries[i].equity });
    if (eqSeries.length) data.push({ time: eqSeries[eqSeries.length - 1].time, value: eqSeries[eqSeries.length - 1].equity });
    equitySeries.setData(data);
    equitySeries.createPriceLine({ price: initial, color: '#555', lineWidth: 1, lineStyle: 3, title: 'initial' });
    equityChart.timeScale().fitContent();
  }

  return { runBacktest, get lastStats() { return lastStats; } };
})();

window.BacktestUI = BacktestUI;
