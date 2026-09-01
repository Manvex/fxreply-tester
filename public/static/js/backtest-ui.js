// ===========================================================================
// Backtest UI — run flow + report rendering.
//   Overview      KPI cards + equity curve
//   Performance   full statistics table
//   Trades        trade-by-trade blotter
//   Monthly       year x month heat grid
//   Prop Firm     verdict, rule bars, daily breakdown
// ===========================================================================
const BacktestUI = (() => {
  const $ = (s) => document.querySelector(s);
  let equityChart = null, equitySeries = null;
  let lastStats = null;

  // ---- formatting -------------------------------------------------------
  function fmt$(v) {
    const n = Number(v) || 0;
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmt$c(v) { // compact, for dense grids
    const n = Number(v) || 0, a = Math.abs(n), sg = n < 0 ? '-' : '';
    if (a >= 1e6) return sg + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return sg + '$' + (a / 1e3).toFixed(1) + 'k';
    return sg + '$' + a.toFixed(0);
  }
  function fmtPct(v) { const n = Number(v) || 0; return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function tcls(v) { return v > 0 ? 't-up' : v < 0 ? 't-down' : ''; }
  function fmtDur(sec) {
    if (!isFinite(sec) || sec <= 0) return '—';
    if (sec < 3600) return Math.round(sec / 60) + 'm';
    if (sec < 86400) return (sec / 3600).toFixed(1) + 'h';
    return (sec / 86400).toFixed(1) + 'd';
  }
  function ts(t) { return new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 16); }
  function day(t) { return new Date(t * 1000).toISOString().slice(0, 10); }
  const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const REASON = (window.App && window.App.REASON) || {
    sl: 'Stop loss', tp: 'Take profit', margin_call: 'Margin call',
    reverse: 'Reversed', prop_fail: 'Rule breach', strategy: 'Strategy', manual: 'Manual', end: 'End of test',
  };

  // ---- prop firm presets ------------------------------------------------
  function propFromUI() {
    const sel = $('#bt-prop');
    const mode = sel ? sel.value : 'none';
    switch (mode) {
      case 'ftmo1': return { targetPct: 10, dailyPct: 5, maxPct: 10, ddType: 'static' };
      case 'ftmo2': return { targetPct: 5, dailyPct: 5, maxPct: 10, ddType: 'static' };
      case 'funded': return { targetPct: 0, dailyPct: 5, maxPct: 10, ddType: 'static' };
      case 'custom': return {
        targetPct: parseFloat($('#pc-target').value) || 0,
        dailyPct: parseFloat($('#pc-daily').value) || 5,
        maxPct: parseFloat($('#pc-max').value) || 10,
        ddType: $('#pc-ddtype').value || 'static',
      };
      default: return null;
    }
  }

  const PROP_LABEL = {
    none: 'No rules', ftmo1: 'FTMO Phase 1', ftmo2: 'FTMO Phase 2',
    funded: 'Funded account', custom: 'Custom rules',
  };

  // ---- run flow ---------------------------------------------------------
  async function runBacktest() {
    const sym = window.App.currentSymbol;
    const tf = window.App.currentTF;
    const info = window.App.currentSymbolInfo;
    const lang = window.App.currentStrategyLang();
    const code = window.App.currentStrategyCode();

    const v = StrategyRunner.validate(lang, code);
    if (!v.ok) {
      window.App.toast('Strategy error: ' + v.error, 'err');
      window.App.openTab && window.App.openTab('editor');
      return;
    }

    const fromSec = Date.parse($('#bt-start').value + 'T00:00:00Z') / 1000;
    const toSec = Date.parse($('#bt-end').value + 'T23:59:59Z') / 1000;
    if (!(fromSec < toSec)) { window.App.toast('Start date must be before the end date', 'err'); return; }

    const progress = $('#bt-progress'), fill = $('#bt-progress-fill');
    const ptext = $('#bt-progress-text'), ppct = $('#bt-progress-pct');
    const runBtn = $('#bt-run');
    progress.classList.remove('hidden');
    if (runBtn) runBtn.disabled = true;
    const setP = (frac, label) => {
      const p = Math.max(0, Math.min(1, frac));
      fill.style.width = (p * 100).toFixed(1) + '%';
      ppct.textContent = Math.round(p * 100) + '%';
      if (label) ptext.textContent = label;
    };

    try {
      setP(0.02, 'Downloading market data…');
      const candles = await DataStore.load(sym, tf, fromSec, toSec,
        f => setP(0.02 + f * 0.45, 'Downloading market data…'));

      if (candles.length < 30) {
        window.App.toast(`Only ${candles.length} bars in that range — widen the dates`, 'err');
        progress.classList.add('hidden');
        if (runBtn) runBtn.disabled = false;
        return;
      }

      // Real economic calendar for the same window — used by the news overlay
      // and exposed to strategies via ctx.news.
      let newsEvents = [];
      const wantNews = !$('#bt-news') || $('#bt-news').checked;
      if (wantNews) {
        setP(0.47, 'Loading economic calendar…');
        try {
          newsEvents = await NewsStore.load(fromSec, toSec);
        } catch (e) {
          console.warn('[news] load failed', e);
          window.App.toast('Economic calendar unavailable — continuing without news', 'warn');
        }
      }

      const prop = propFromUI();
      const broker = new Broker({
        balance: parseFloat($('#bt-balance').value) || 100000,
        leverage: parseInt($('#bt-leverage').value) || 100,
        spread: parseFloat($('#bt-spread').value) || 0,
        commission: parseFloat($('#bt-commission').value) || 0,
        symInfo: info,
        prop,
      });

      setP(0.5, 'Running strategy…');
      await StrategyRunner.run(lang, code, candles, broker,
        f => setP(0.5 + f * 0.45, 'Running strategy…'),
        msg => setP(0.5, msg), newsEvents);

      if (broker.positions.length) broker.closeAll(candles[candles.length - 1], 'end');

      setP(0.97, 'Computing statistics…');
      const stats = computeStats(broker, candles);

      // Optional pass: re-price every fill against the book that really existed.
      // Only the bars where a trade opened or closed get downloaded.
      let micro = null;
      const wantRefine = $('#bt-refine') && $('#bt-refine').checked;
      if (wantRefine && broker.closed.length) {
        try {
          micro = await Refine.run({
            broker, symInfo: info, tfSec: DataStore.TF_SEC[tf],
            onProgress: (f, label) => setP(0.97 + f * 0.03, label),
          });
        } catch (e) {
          console.warn('[refine] failed', e);
          window.App.toast('Order-book re-pricing failed — showing modelled fills only', 'warn');
        }
      }

      lastStats = { stats, broker, candles, sym, tf, news: newsEvents, micro };

      const meta = {
        sym, tf, bars: candles.length,
        from: day(candles[0].time), to: day(candles[candles.length - 1].time),
        prop: PROP_LABEL[$('#bt-prop').value] || 'No rules',
        news: newsEvents.length,
        spread: parseFloat($('#bt-spread').value) || 0,
        lev: parseInt($('#bt-leverage').value) || 100,
      };

      renderResults(stats, broker, candles, meta, micro);
      renderChartMarkers(broker, candles, newsEvents, tf);
      window.App.setNewsEvents(newsEvents, tf);
      setP(1, 'Done');
      setTimeout(() => { progress.classList.add('hidden'); if (runBtn) runBtn.disabled = false; }, 500);

      window.App.closeModals();
      window.App.openTab('tester');
      const dock = $('#dock');
      dock.classList.remove('collapsed');
      dock.classList.add('tall');
      window.App.toast(
        `Backtest complete — ${stats.totalTrades} trades, ${fmtPct(stats.netProfitPct)}`,
        stats.netProfit >= 0 ? 'ok' : 'warn');
    } catch (e) {
      console.error(e);
      window.App.toast('Backtest failed: ' + e.message, 'err');
      progress.classList.add('hidden');
      if (runBtn) runBtn.disabled = false;
    }
  }

  // ---- chart markers ----------------------------------------------------
  function renderChartMarkers(broker, candles, newsEvents, tf) {
    ChartMgr.setData(candles, window.App.currentSymbolInfo);
    const markers = [];
    for (const t of broker.closed) {
      markers.push({
        time: t.openTime, position: t.dir > 0 ? 'belowBar' : 'aboveBar',
        color: t.dir > 0 ? '#26d0a5' : '#f2615c',
        shape: t.dir > 0 ? 'arrowUp' : 'arrowDown',
        text: (t.dir > 0 ? 'B ' : 'S ') + t.lots,
      });
      markers.push({
        time: t.closeTime, position: t.dir > 0 ? 'aboveBar' : 'belowBar',
        color: t.pnl >= 0 ? '#26d0a5' : '#f2615c',
        shape: 'circle',
        text: (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(0),
      });
    }
    markers.sort((a, b) => a.time - b.time);
    ChartMgr.setTradeMarkers(markers.slice(0, 500));
  }

  // ---- report root ------------------------------------------------------
  function renderResults(s, broker, candles, meta, micro) {
    $('#tester-empty').style.display = 'none';
    $('#tester-empty').classList.add('hidden');
    const res = $('#tester-results');
    res.classList.remove('hidden');
    res.style.display = 'flex';

    if (meta) {
      $('#results-meta').innerHTML =
        `<span class="pill">${meta.sym} · ${meta.tf}</span>` +
        `<span class="pill">${meta.bars.toLocaleString()} bars</span>` +
        `<span class="pill">${meta.from} → ${meta.to}</span>` +
        `<span class="pill">1:${meta.lev}</span>` +
        `<span class="pill">spread ${meta.spread}</span>` +
        (meta.prop !== 'No rules' ? `<span class="pill pill-brand">${meta.prop}</span>` : '') +
        (meta.news ? `<span class="pill"><i class="fa-solid fa-bullhorn"></i> ${meta.news} events</span>` : '');
    }

    renderOverview(s, broker);
    renderEquityChart(s.equitySeries, broker.initial);
    renderPerformance(s);
    renderTrades(s, broker);
    renderMonthly(s);
    renderPropReport(broker, s);
    MicroReport.render(micro, s, window.App.currentSymbolInfo);
  }

  // ---- overview: KPI cards ---------------------------------------------
  function renderOverview(s, broker) {
    const pf = isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞';
    const expectancy = s.totalTrades ? s.netProfit / s.totalTrades : 0;

    // plain-English read on the headline numbers
    let verdict, vcls;
    if (s.totalTrades < 20) { verdict = 'Too few trades to judge'; vcls = 'warn'; }
    else if (s.netProfit > 0 && s.profitFactor >= 1.3 && s.maxDDpct < 25) { verdict = 'Solid on this sample'; vcls = 'ok'; }
    else if (s.netProfit > 0) { verdict = 'Profitable but fragile'; vcls = 'warn'; }
    else { verdict = 'Loses money on this sample'; vcls = 'bad'; }

    const kpis = [
      { k: 'Net Profit', v: fmt$(s.netProfit), s: fmtPct(s.netProfitPct), c: tcls(s.netProfit) },
      { k: 'Final Equity', v: fmt$(s.final), s: 'from ' + fmt$(s.initial) },
      { k: 'Max Drawdown', v: s.maxDDpct.toFixed(2) + '%', s: fmt$(s.maxDD), c: 't-down' },
      { k: 'Profit Factor', v: pf, s: pf === '∞' ? 'no losers' : (s.profitFactor >= 1 ? 'gross win / gross loss' : 'losing edge'), c: s.profitFactor >= 1.3 ? 't-up' : s.profitFactor < 1 ? 't-down' : '' },
      { k: 'Win Rate', v: s.winRate.toFixed(1) + '%', s: `${s.wins}W / ${s.losses}L` },
      { k: 'Trades', v: String(s.totalTrades), s: s.totalTrades < 20 ? 'small sample' : 'sample size ok' },
      { k: 'Sharpe', v: s.sharpe.toFixed(2), s: 'annualized', c: s.sharpe >= 1 ? 't-up' : s.sharpe < 0 ? 't-down' : '' },
      { k: 'Expectancy', v: fmt$(expectancy), s: 'avg per trade', c: tcls(expectancy) },
      { k: 'Avg Hold', v: fmtDur(s.avgHoldSec), s: 'per position' },
      { k: 'Costs Paid', v: fmt$(s.totalCommission), s: 'commission only', c: 't-down' },
    ];

    $('#ov-kpis').innerHTML =
      `<div class="kpi wide verdict ${vcls}">
         <div class="verdict-ico"><i class="fa-solid ${vcls === 'ok' ? 'fa-circle-check' : vcls === 'bad' ? 'fa-circle-xmark' : 'fa-triangle-exclamation'}"></i></div>
         <div><div class="kpi-k">Read on this run</div><div class="kpi-v" style="font-size:16px">${verdict}</div>
         <div class="kpi-s">${s.totalTrades} trades · ${fmtPct(s.netProfitPct)} net · ${s.maxDDpct.toFixed(1)}% peak-to-trough drop</div></div>
       </div>` +
      kpis.map(k => `<div class="kpi">
        <div class="kpi-k">${k.k}</div>
        <div class="kpi-v ${k.c || ''}">${k.v}</div>
        <div class="kpi-s">${k.s}</div>
      </div>`).join('');
  }

  // ---- performance table ------------------------------------------------
  function renderPerformance(s) {
    const groups = [
      ['Capital', [
        ['Initial balance', fmt$(s.initial)],
        ['Final equity', fmt$(s.final)],
        ['Net profit', fmt$(s.netProfit) + '  (' + fmtPct(s.netProfitPct) + ')', tcls(s.netProfit)],
        ['Gross profit', fmt$(s.grossProfit), 't-up'],
        ['Gross loss', fmt$(-s.grossLoss), 't-down'],
        ['Commission paid', fmt$(s.totalCommission), 't-down'],
      ]],
      ['Risk', [
        ['Max drawdown', fmt$(s.maxDD) + '  (' + s.maxDDpct.toFixed(2) + '%)', 't-down'],
        ['Profit factor', isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'],
        ['Sharpe ratio (annualized)', s.sharpe.toFixed(2)],
        ['Recovery factor', s.maxDD > 0 ? (s.netProfit / s.maxDD).toFixed(2) : '—'],
      ]],
      ['Trades', [
        ['Total trades', s.totalTrades],
        ['Winning trades', s.wins],
        ['Losing trades', s.losses],
        ['Win rate', s.winRate.toFixed(2) + '%'],
        ['Average win', fmt$(s.avgWin), 't-up'],
        ['Average loss', fmt$(-s.avgLoss), 't-down'],
        ['Average trade', fmt$(s.avgTrade), tcls(s.avgTrade)],
        ['Largest win', fmt$(s.largestWin), 't-up'],
        ['Largest loss', fmt$(s.largestLoss), 't-down'],
        ['Max consecutive wins', s.maxConsecWins],
        ['Max consecutive losses', s.maxConsecLosses],
        ['Average hold time', fmtDur(s.avgHoldSec)],
      ]],
    ];
    $('#perf-body').innerHTML = groups.map(([title, rows]) => `
      <div class="card" style="margin-bottom:14px">
        <div class="card-head"><div class="card-title">${title}</div></div>
        <div class="card-body" style="padding:0">
          <table class="dt compact"><tbody>
            ${rows.map(r => `<tr><td>${r[0]}</td><td class="num ${r[2] || ''}" style="text-align:right">${r[1]}</td></tr>`).join('')}
          </tbody></table>
        </div>
      </div>`).join('');
  }

  // ---- trades blotter ---------------------------------------------------
  function renderTrades(s, broker) {
    const host = $('#trades-body');
    if (!broker.closed.length) {
      host.innerHTML = `<div class="empty"><div class="empty-icon"><i class="fa-solid fa-inbox"></i></div>
        <h3>No trades were taken</h3>
        <p>The strategy never produced an entry signal in this window. Try a longer date range,
        a different timeframe, or loosen the entry conditions.</p></div>`;
      return;
    }
    const dg = window.App.currentSymbolInfo.digits;
    let run = broker.initial;
    const rows = broker.closed.map((t, i) => {
      run += t.pnl;
      return `<tr>
        <td class="num">${i + 1}</td>
        <td><span class="badge-side ${t.dir > 0 ? 'long' : 'short'}">${t.dir > 0 ? 'LONG' : 'SHORT'}</span></td>
        <td class="num">${t.lots}</td>
        <td class="mono">${ts(t.openTime)}</td>
        <td class="num mono">${t.entry.toFixed(dg)}</td>
        <td class="mono">${ts(t.closeTime)}</td>
        <td class="num mono">${t.exit.toFixed(dg)}</td>
        <td>${REASON[t.reason] || t.reason}</td>
        <td class="num ${tcls(t.pnl)}">${fmt$(t.pnl)}</td>
        <td class="num ${tcls(t.pnl)}">${fmtPct(t.pnl / s.initial * 100)}</td>
        <td class="num mono">${fmt$c(run)}</td>
      </tr>`;
    }).join('');

    host.innerHTML = `
      <div class="table-toolbar">
        <span class="pill">${broker.closed.length} closed trades</span>
        <span class="pill">${s.wins} wins · ${s.losses} losses</span>
        <span style="flex:1"></span>
        <button class="btn btn-sm btn-outline" id="trades-csv"><i class="fa-solid fa-download"></i> Export CSV</button>
      </div>
      <div class="table-wrap">
        <table class="dt compact">
          <thead><tr>
            <th>#</th><th>Side</th><th>Lots</th><th>Entry time</th><th>Entry</th>
            <th>Exit time</th><th>Exit</th><th>Exit reason</th><th>P&amp;L</th><th>P&amp;L %</th><th>Balance</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    const btn = document.getElementById('trades-csv');
    if (btn) btn.addEventListener('click', () => exportCsv(broker, dg));
  }

  function exportCsv(broker, dg) {
    const head = 'n,side,lots,open_time,entry,close_time,exit,reason,pnl,commission\n';
    const body = broker.closed.map((t, i) => [
      i + 1, t.dir > 0 ? 'long' : 'short', t.lots,
      new Date(t.openTime * 1000).toISOString(), t.entry.toFixed(dg),
      new Date(t.closeTime * 1000).toISOString(), t.exit.toFixed(dg),
      t.reason, t.pnl.toFixed(2), (t.commission || 0).toFixed(2),
    ].join(',')).join('\n');
    const blob = new Blob([head + body], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${window.App.currentSymbol}_${window.App.currentTF}_trades.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    window.App.toast('Trades exported', 'ok');
  }

  // ---- monthly heat grid ------------------------------------------------
  function renderMonthly(s) {
    const host = $('#monthly-body');
    if (!s.monthly.size) {
      host.innerHTML = `<div class="empty"><div class="empty-icon"><i class="fa-solid fa-calendar"></i></div>
        <h3>Nothing to break down</h3><p>No closed trades in this backtest.</p></div>`;
      return;
    }
    const byYear = new Map();
    for (const [key, m] of s.monthly) {
      const [y, mo] = key.split('-');
      if (!byYear.has(y)) byYear.set(y, {});
      byYear.get(y)[+mo] = { ...m, pct: s.monthlyPct.get(key) ?? 0 };
    }
    // scale colour intensity to the largest absolute monthly % move
    let maxAbs = 0;
    for (const [, v] of s.monthlyPct) maxAbs = Math.max(maxAbs, Math.abs(v));
    if (maxAbs === 0) maxAbs = 1;

    const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let html = `<div class="table-toolbar">
      <span class="pill">Cell = that month's return on the equity curve</span>
      <span style="flex:1"></span>
      <span class="pill" style="background:var(--up-soft);color:var(--up)">green = up month</span>
      <span class="pill" style="background:var(--down-soft);color:var(--down)">red = down month</span>
    </div>
    <div class="table-wrap"><table class="dt compact month-grid">
      <thead><tr><th>Year</th>${MN.map(m => `<th style="text-align:center">${m}</th>`).join('')}<th style="text-align:center">Year</th></tr></thead><tbody>`;

    for (const [y, months] of [...byYear.entries()].sort()) {
      let yearPnl = 0, yearTrades = 0;
      html += `<tr><td class="y">${y}</td>`;
      for (let m = 1; m <= 12; m++) {
        const d = months[m];
        if (!d) { html += '<td class="na">·</td>'; continue; }
        yearPnl += d.pnl; yearTrades += d.trades;
        const alpha = Math.min(0.34, 0.06 + Math.abs(d.pct) / maxAbs * 0.28);
        const bg = d.pct >= 0 ? `rgba(38,208,165,${alpha})` : `rgba(242,97,92,${alpha})`;
        html += `<td style="background:${bg}" title="${d.trades} trades · ${d.wins} wins · ${fmt$(d.pnl)}">
          <div class="m-pct ${tcls(d.pct)}">${fmtPct(d.pct)}</div>
          <div class="m-abs">${fmt$c(d.pnl)}</div></td>`;
      }
      html += `<td class="tot ${tcls(yearPnl)}" title="${yearTrades} trades">
        <div class="m-pct">${fmt$c(yearPnl)}</div><div class="m-abs">${yearTrades} tr</div></td></tr>`;
    }
    host.innerHTML = html + '</tbody></table></div>';
  }

  // ---- prop firm report -------------------------------------------------
  function renderPropReport(broker, s) {
    const el = $('#prop-body');
    if (!broker.prop) {
      el.innerHTML = `<div class="empty"><div class="empty-icon"><i class="fa-solid fa-shield-halved"></i></div>
        <h3>Prop firm rules were off</h3>
        <p>Enable a rule set in <b>Backtest Settings</b> to check this strategy against
        FTMO-style daily loss and max drawdown limits. The engine evaluates them on
        intrabar worst-case equity, so it is stricter than a bar-close check.</p>
        <button class="btn btn-primary btn-sm" onclick="document.getElementById('btn-tester').click()">
          <i class="fa-solid fa-sliders"></i> Open Backtest Settings</button></div>`;
      return;
    }
    const ps = broker.propState, r = broker.prop;

    let title, sub, vcls, ico;
    switch (ps.status) {
      case 'passed':
        title = 'Challenge passed'; vcls = 'pass'; ico = 'fa-circle-check';
        sub = `Profit target of ${r.targetPct}% reached on ${ps.passTime ? ts(ps.passTime) : '—'} without breaching a limit.`;
        break;
      case 'failed_daily':
        title = 'Failed — daily loss limit'; vcls = 'fail'; ico = 'fa-circle-xmark';
        sub = `Equity fell more than ${r.dailyPct}% below the day's opening equity on ${ps.failTime ? ts(ps.failTime) : '—'}.`;
        break;
      case 'failed_max':
        title = 'Failed — max drawdown'; vcls = 'fail'; ico = 'fa-circle-xmark';
        sub = `${r.ddType === 'trailing' ? 'Trailing' : 'Static'} drawdown exceeded ${r.maxPct}% on ${ps.failTime ? ts(ps.failTime) : '—'}.`;
        break;
      default:
        if (r.targetPct > 0) { title = 'Survived, target not reached'; vcls = 'neutral'; ico = 'fa-circle-half-stroke';
          sub = `No limit was breached, but the ${r.targetPct}% profit target was not hit in this window.`; }
        else { title = 'Account survived'; vcls = 'pass'; ico = 'fa-circle-check';
          sub = 'Funded mode has no profit target — the account stayed inside every limit.'; }
    }

    const dailyCap = broker.initial * r.dailyPct / 100;
    const maxCap = broker.initial * r.maxPct / 100;
    const targetCash = broker.initial * r.targetPct / 100;
    const bars = [
      { label: 'Worst single day', used: Math.abs(ps.worstDailyPnl), cap: dailyCap,
        note: `limit ${fmt$(dailyCap)} (${r.dailyPct}%)` },
      { label: `Max drawdown (${r.ddType})`, used: ps.maxDrawdownSeen, cap: maxCap,
        note: `limit ${fmt$(maxCap)} (${r.maxPct}%)` },
    ];
    if (r.targetPct > 0) {
      bars.push({ label: 'Progress to profit target', used: Math.max(0, s.netProfit), cap: targetCash,
        note: `target ${fmt$(targetCash)} (${r.targetPct}%)`, invert: true });
    }

    let html = `<div class="verdict ${vcls}" style="margin-bottom:14px">
      <div class="verdict-ico"><i class="fa-solid ${ico}"></i></div>
      <div><div style="font-size:15px;font-weight:600">${title}</div>
      <div style="font-size:12px;color:var(--txt-2);margin-top:3px">${sub}</div></div>
    </div>`;

    html += '<div class="rule-bars">';
    for (const b of bars) {
      const frac = b.cap > 0 ? Math.min(1, b.used / b.cap) : 0;
      let st;
      if (b.invert) st = frac >= 1 ? 'ok' : 'warn';
      else st = frac >= 1 ? 'bad' : frac > 0.7 ? 'warn' : 'ok';
      html += `<div class="rule-bar">
        <div class="rb-top"><span>${b.label}</span><b class="num">${fmt$(b.used)} <span style="color:var(--txt-3);font-weight:400">/ ${b.note}</span></b></div>
        <div class="rb-track"><div class="rb-fill ${st}" style="width:${(frac * 100).toFixed(1)}%"></div></div>
      </div>`;
    }
    html += '</div>';

    html += `<div class="card" style="margin-top:14px">
      <div class="card-head"><div class="card-title">Rule set</div></div>
      <div class="card-body" style="padding:0"><table class="kv"><tbody>
        <tr><td>Profit target</td><td class="num">${r.targetPct > 0 ? r.targetPct + '% · ' + fmt$(targetCash) : 'None'}</td></tr>
        <tr><td>Daily loss limit</td><td class="num">${r.dailyPct}% · ${fmt$(dailyCap)}</td></tr>
        <tr><td>Max drawdown</td><td class="num">${r.maxPct}% · ${fmt$(maxCap)} · ${r.ddType}</td></tr>
        <tr><td>Drawdown base</td><td>${r.ddType === 'trailing' ? 'Highest equity reached (trails up)' : 'Starting balance (fixed)'}</td></tr>
        <tr><td>Evaluated on</td><td>Intrabar worst-case equity (high/low, not just close)</td></tr>
      </tbody></table></div></div>`;

    if (ps.dailyLog && ps.dailyLog.length) {
      const shown = ps.dailyLog.slice(-90);
      html += `<div class="card" style="margin-top:14px">
        <div class="card-head"><div class="card-title">Daily breakdown</div>
          <span class="pill">last ${shown.length} of ${ps.dailyLog.length} days</span></div>
        <div class="card-body" style="padding:0"><div class="table-wrap"><table class="dt compact">
        <thead><tr><th>Day</th><th>Open equity</th><th>Close equity</th><th>Intrabar low</th><th>Day P&amp;L</th><th>% of daily limit</th></tr></thead><tbody>`;
      for (const d of shown) {
        const usedPct = dailyCap > 0 ? Math.max(0, -d.pnl) / dailyCap * 100 : 0;
        html += `<tr>
          <td class="mono">${day(d.day)}</td>
          <td class="num">${fmt$(d.startEq)}</td>
          <td class="num">${fmt$(d.endEq)}</td>
          <td class="num">${fmt$(d.minEq)}</td>
          <td class="num ${tcls(d.pnl)}">${fmt$(d.pnl)}</td>
          <td class="num ${usedPct >= 100 ? 't-down' : ''}">${usedPct.toFixed(0)}%</td>
        </tr>`;
      }
      html += '</tbody></table></div></div></div>';
    }
    el.innerHTML = html;
  }

  // ---- equity curve -----------------------------------------------------
  function renderEquityChart(eqSeries, initial) {
    const el = $('#equity-chart');
    if (!el) return;
    el.innerHTML = '';
    equityChart = LightweightCharts.createChart(el, {
      layout: { background: { type: 'solid', color: '#0f1216' }, textColor: '#8b949e', fontSize: 10,
                fontFamily: "'Inter', -apple-system, sans-serif" },
      grid: { vertLines: { color: 'rgba(255,255,255,.03)' }, horzLines: { color: 'rgba(255,255,255,.045)' } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,.07)' },
      timeScale: { borderColor: 'rgba(255,255,255,.07)', timeVisible: true },
      crosshair: { vertLine: { color: 'rgba(77,212,192,.4)', style: 3 },
                   horzLine: { color: 'rgba(77,212,192,.4)', style: 3 } },
      autoSize: true, handleScroll: false, handleScale: false,
    });
    const last = eqSeries.length ? eqSeries[eqSeries.length - 1].equity : initial;
    const up = last >= initial;
    equitySeries = equityChart.addAreaSeries({
      lineColor: up ? '#4dd4c0' : '#f2615c',
      topColor: up ? 'rgba(77,212,192,.28)' : 'rgba(242,97,92,.28)',
      bottomColor: 'rgba(77,212,192,0)',
      lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
    });
    const step = Math.max(1, Math.floor(eqSeries.length / 2000));
    const data = [];
    for (let i = 0; i < eqSeries.length; i += step) data.push({ time: eqSeries[i].time, value: eqSeries[i].equity });
    if (eqSeries.length) data.push({ time: eqSeries[eqSeries.length - 1].time, value: eqSeries[eqSeries.length - 1].equity });
    equitySeries.setData(data);
    equitySeries.createPriceLine({
      price: initial, color: 'rgba(255,255,255,.28)', lineWidth: 1, lineStyle: 3,
      title: 'start', axisLabelVisible: true,
    });
    equityChart.timeScale().fitContent();
  }

  return {
    runBacktest,
    renderResults,
    get lastStats() { return lastStats; },
  };
})();

window.BacktestUI = BacktestUI;
