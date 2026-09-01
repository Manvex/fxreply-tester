// ===========================================================================
// Signal, trend and calendar panels, plus the news dots on the chart.
//
// Rendering only — every judgement lives in Signals. This file's job is to make
// the reasoning visible: a signal you cannot interrogate is worse than none,
// so the votes that produced it are always on screen next to the levels.
// ===========================================================================

const SignalUI = (() => {
  const $ = (s, r = document) => r.querySelector(s);

  let symbolFn = () => 'BTCUSDT';
  let newsCanvas = null, newsCtx = null, newsWrap = null;
  let timer = null;

  // ---- formatting -------------------------------------------------------
  const fmtUsd = (n) => {
    const a = Math.abs(n), sg = n < 0 ? '-' : '';
    if (a >= 1e9) return sg + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sg + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return sg + '$' + (a / 1e3).toFixed(0) + 'k';
    return sg + '$' + a.toFixed(0);
  };
  function px(v, d) {
    return Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function digitsOf() {
    const i = window.findSymbol ? findSymbol(symbolFn()) : null;
    return (i && i.digits) ?? 2;
  }
  const clock = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  function until(t) {
    const s = t - Math.floor(Date.now() / 1000);
    const a = Math.abs(s), m = Math.round(a / 60);
    if (a < 90) return s > 0 ? 'now' : 'just now';
    if (m < 60) return (s > 0 ? 'in ' : '') + m + 'm' + (s > 0 ? '' : ' ago');
    const h = Math.round(m / 60);
    return (s > 0 ? 'in ' : '') + h + 'h' + (s > 0 ? '' : ' ago');
  }

  // ---- multi-timeframe trend strip --------------------------------------
  function renderTrend(host) {
    if (!host) return;
    const ts = Signals.trends;
    host.innerHTML = ts.map(t => {
      const s = t.score;
      const cls = s == null ? 'na'
        : s > 0.45 ? 'up' : s > 0.15 ? 'up-weak'
        : s < -0.45 ? 'down' : s < -0.15 ? 'down-weak' : 'flat';
      const pct = s == null ? 0 : Math.round(Math.abs(s) * 100);
      return `<div class="tr-cell tr-${cls}" title="${t.tf} score ${s == null ? 'n/a' : s.toFixed(2)}">
        <span class="tr-tf">${t.tf}</span>
        <span class="tr-bar"><i style="height:${pct}%"></i></span>
        <span class="tr-lab">${t.label === 'n/a' ? '—' : t.label.replace('-weak', ' soft')}</span>
      </div>`;
    }).join('');
  }

  // ---- signal card ------------------------------------------------------
  function renderSignal(host, stateEl) {
    if (!host) return;
    const s = Signals.current;
    const d = digitsOf();

    if (!s || s.state === 'waiting') {
      stateEl && (stateEl.textContent = 'warming up');
      host.innerHTML = `<div class="sg-idle">${s ? s.reason : 'Starting up…'}</div>`;
      return;
    }

    if (s.state === 'blocked') {
      stateEl && (stateEl.textContent = 'stood down');
      host.innerHTML =
        `<div class="sg-blocked">
           <div class="sg-blocked-head"><i class="fa-solid fa-hand"></i> Standing aside</div>
           <p>${esc(s.reason)}</p>
         </div>${votesBlock(s)}`;
      return;
    }

    // Building toward a call: show the progress rather than a verdict, so the
    // card stops reading as an opinion that changes every few seconds.
    if (s.state === 'forming') {
      const need = Signals.thresholds.CONFIRM_TICKS;
      const got = s.formingTicks || 0;
      stateEl && (stateEl.textContent = got ? `forming ${got}/${need}` : 'watching');
      host.innerHTML =
        `<div class="sg-forming">
           <b>${got ? 'Building a case' : 'Watching'}</b>
           <p>${esc(s.reason || '')}</p>
           ${got ? `<div class="sg-ticks">${
             Array.from({ length: need }, (_, i) =>
               `<span class="sg-tick ${i < got ? 'on' : ''}"></span>`).join('')}</div>` : ''}
         </div>` + readsBlock(s) + votesBlock(s) + recordBlock();
      return;
    }

    if (s.state === 'closed') {
      stateEl && (stateEl.textContent = 'closed');
      host.innerHTML =
        `<div class="sg-closed">
           <b class="${s.closedWhy === 'target reached' ? 't-up' : s.closedWhy === 'stopped out' ? 't-down' : ''}">
             ${esc(s.side)} closed — ${esc(s.closedWhy)}</b>
           <p class="sg-runr">Entered ${px(s.entry, d)}, stop ${px(s.sl, d)}, target ${px(s.tp2, d)}.
             The engine now waits out its cooldown before considering another.</p>
         </div>` + recordBlock();
      return;
    }

    if (s.state === 'flat') {
      stateEl && (stateEl.textContent = 'no setup');
      host.innerHTML =
        `<div class="sg-flat"><b>No setup</b><p>${esc(s.reason)}</p></div>` +
        readsBlock(s) + votesBlock(s) + recordBlock();
      return;
    }

    stateEl && (stateEl.textContent = s.grade + ' · ' + s.side);
    const long = s.dir > 0;
    // Once committed the header reports the position, not a fresh opinion.
    const runNote = s.held
      ? `<span class="sg-held">held ${s.ageMin || 0}m</span>` : '';
    const rr = s.unrealisedR != null
      ? `<div class="sg-runr">Running ${s.unrealisedR >= 0 ? '+' : ''}${s.unrealisedR.toFixed(2)}R${
          s.tp1Hit ? ' · first target hit, stop at break-even' : ''}${
          s.note ? ' · ' + esc(s.note) : ''}</div>` : '';
    host.innerHTML =
      `<div class="sg-head ${long ? 'long' : 'short'}">
         <span class="sg-side">${s.side}</span>
         <span class="sg-grade">grade ${s.grade}</span>
         <span class="sg-conv">${(s.strength * 100).toFixed(0)}% conviction</span>
         ${runNote}
       </div>
       ${rr}
       <div class="sg-levels">
         <div class="sg-lv"><span>Entry</span><b>${px(s.entry, d)}</b></div>
         <div class="sg-lv sg-sl"><span>Stop</span><b>${px(s.sl, d)}</b>
           <small>${s.stopPct.toFixed(2)}%</small></div>
         <div class="sg-lv sg-tp"><span>Target 1</span><b>${px(s.tp1, d)}</b></div>
         <div class="sg-lv sg-tp"><span>Target 2</span><b>${px(s.tp2, d)}</b>
           <small>${s.rr.toFixed(2)}R${s.tpWhy ? ' · ' + esc(s.tpWhy) : ''}</small></div>
       </div>
       <div class="sg-note">Levels are drawn from resting liquidity: the stop sits beyond the
         wall behind the trade, the target stops short of the one in front. Size by risk, not
         by lots — this is a CFD / perp direction call, not a position.</div>
       ${planBlock(s)}
       ${readsBlock(s)}
       ${votesBlock(s)}
       ${newsMini(s)}
       ${recordBlock()}`;
  }

  /** The conditions the call was made under, whatever the call turned out to be. */
  function readsBlock(s) {
    const r = s.reads;
    if (!r) return '';
    const cells = [];
    if (r.reg) {
      cells.push(['Tape', r.reg.label,
        r.reg.label === 'dead' ? 'bad' : r.reg.label === 'hot' ? 'warn' : 'ok']);
    }
    if (r.bas) {
      const dir = r.bas.bps >= 0 ? 'over' : 'under';
      cells.push(['Perp vs spot', `${Math.abs(r.bas.bps).toFixed(1)} bps ${dir}`,
        Math.abs(r.bas.bps) > 15 ? 'warn' : 'ok']);
    }
    if (r.disp) {
      cells.push(['Venues agree', `${r.disp.bps.toFixed(1)} bps apart`,
        r.disp.bps > 8 ? 'warn' : 'ok']);
    }
    if (r.walls && r.walls.length) {
      cells.push(['Resting walls', String(r.walls.length), 'ok']);
    }
    const f = window.Derivs && Derivs.funding();
    if (f) {
      cells.push(['Funding', `${f.pct8h >= 0 ? '+' : ''}${f.pct8h.toFixed(3)}%/8h`,
        f.heat === 'extreme' ? 'bad' : f.heat === 'elevated' ? 'warn' : 'ok']);
    }
    const oi = r.oi;
    if (oi && oi.label !== 'flat') {
      cells.push(['Open interest', oi.label, oi.bias >= 0 ? 'ok' : 'warn']);
    }
    const rt = window.Derivs && Derivs.ratio();
    if (rt) {
      cells.push(['Accounts long', `${rt.long.toFixed(0)}%`, rt.crowded ? 'warn' : 'ok']);
    }
    if (!cells.length) return '';
    return '<div class="sg-sec">Conditions</div><div class="sg-reads">' +
      cells.map(([k, v, c]) =>
        `<span class="sg-read sg-${c}"><small>${esc(k)}</small><b>${esc(v)}</b></span>`).join('') +
      '</div>';
  }

  /** How the engine's own calls have actually turned out. */
  function recordBlock() {
    const rec = Signals.record();
    if (!rec || !rec.n) return '';
    const cls = rec.totalR > 0 ? 't-up' : rec.totalR < 0 ? 't-down' : '';
    const pills = rec.recent.map(x => {
      const k = x.r > 0 ? 'win' : x.r < 0 ? 'loss' : 'flat';
      return `<i class="sg-pip sg-pip-${k}" title="${x.side} ${x.result} ${x.r.toFixed(2)}R"></i>`;
    }).join('');
    return '<div class="sg-sec">Its own calls, tracked</div>' +
      `<div class="sg-record">
         <span><small>settled</small><b>${rec.n}</b></span>
         <span><small>hit rate</small><b>${rec.winRate.toFixed(0)}%</b></span>
         <span><small>total</small><b class="${cls}">${rec.totalR >= 0 ? '+' : ''}${rec.totalR.toFixed(1)}R</b></span>
         <span class="sg-pips">${pills}</span>
       </div>
       <div class="sg-note">Paper-tracked from the moment each call was made, stop to
         break-even once the first target prints. A handful of samples proves nothing —
         it is here so the engine cannot quietly ignore its own record.</div>`;
  }

  /** Size, liquidation and what the trade actually nets after costs. */
  function planBlock(s) {
    const p = s.plan || (window.Risk ? Risk.plan(s) : null);
    if (!p) return '';
    const d = digitsOf();
    const warns = Risk.warnings(p).map(w =>
      `<div class="sg-warn sg-warn-${w.level}">${esc(w.text)}</div>`).join('');

    return '<div class="sg-sec">Size and cost</div>' +
      `<div class="sg-plan">
         <div class="sg-pl"><span>Position</span><b>${p.qty < 1 ? p.qty.toFixed(4) : p.qty.toFixed(3)}</b>
           <small>${Risk.fmt(p.notional)} notional</small></div>
         <div class="sg-pl"><span>Risking</span><b>${Risk.fmt(p.riskCash)}</b>
           <small>${p.cfg.riskPct}% of ${Risk.fmt(p.cfg.balance)}</small></div>
         <div class="sg-pl"><span>Margin</span><b>${Risk.fmt(p.margin)}</b>
           <small>at ${p.cfg.leverage}x</small></div>
         <div class="sg-pl ${p.liqBeforeStop ? 'sg-danger' : ''}"><span>Liquidation</span>
           <b>${px(p.liq, d)}</b><small>${p.liqPct.toFixed(2)}% away</small></div>
         <div class="sg-pl"><span>Costs</span><b>${Risk.fmt(p.costCash)}</b>
           <small>${(p.costR * 100).toFixed(0)}% of risk</small></div>
         <div class="sg-pl"><span>Net at TP2</span>
           <b class="${p.netR2 >= 1 ? 't-up' : 't-down'}">${p.netR2.toFixed(2)}R</b>
           <small>gross ${p.grossR2.toFixed(2)}R</small></div>
       </div>` +
      (p.breakEvenPct != null
        ? `<div class="sg-note">Net of costs this needs to be right about
             <b>${p.breakEvenPct.toFixed(0)}%</b> of the time to break even, losing
             ${Math.abs(p.netLossR).toFixed(2)}R when it is wrong.</div>` : '') +
      warns;
  }

  function votesBlock(s) {
    if (!s.votes || !s.votes.length) return '';
    const rows = s.votes.map(v => {
      const w = Math.min(100, Math.abs(v.score) * 55);
      return `<div class="sg-vote">
        <span class="sg-vn">${esc(v.name)}</span>
        <span class="sg-vbar"><i class="${v.score >= 0 ? 'pos' : 'neg'}"
              style="width:${w.toFixed(0)}%"></i></span>
        <span class="sg-vd">${esc(v.detail)}</span>
      </div>`;
    }).join('');
    return `<div class="sg-sec">What went into it</div><div class="sg-votes">${rows}</div>`;
  }

  function newsMini(s) {
    if (!s.news || !s.news.length) return '';
    const rows = s.news.slice(0, 3).map(e =>
      `<div class="sg-nrow"><i class="nd nd-${impactClass(e)}"></i>
         <span>${esc(e.title)}</span><small>${until(e.t)}</small></div>`).join('');
    return `<div class="sg-sec">Ahead of it</div>${rows}`;
  }

  // ---- calendar ---------------------------------------------------------
  function impactClass(e) {
    // Colour by what it means for THIS pair, not by the raw impact tag: a
    // high-impact JPY print is not a high-impact event for bitcoin.
    const s = e.score != null ? e.score : 0;
    if (s >= 0.8) return 'crit';
    if (s >= 0.5) return 'high';
    if (s >= 0.28) return 'med';
    return 'low';
  }

  function renderNews(host, countEl) {
    if (!host) return;
    const list = Signals.upcoming(symbolFn(), 48 * 3600);
    countEl && (countEl.textContent = String(list.length));
    if (!list.length) {
      host.innerHTML = `<div class="sg-idle">No releases in the window.</div>`;
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    host.innerHTML = list.slice(0, 14).map(e => {
      const past = e.t < now;
      return `<div class="nw-row ${past ? 'past' : ''}">
        <i class="nd nd-${impactClass(e)}"></i>
        <span class="nw-cur">${esc(e.cur || 'ALL')}</span>
        <span class="nw-title">${esc(e.title)}</span>
        <span class="nw-when">${clock(e.t)}<small>${until(e.t)}</small></span>
      </div>`;
    }).join('');
  }

  // ---- news dots on the chart -------------------------------------------
  // Drawn on their own canvas above everything else, pinned to the time axis,
  // sitting in a strip along the bottom the way TradingView marks them.
  function ensureNewsCanvas() {
    const wrap = $('#lcp-chart-wrap') || $('#chart-wrap');
    if (!wrap) return false;
    if (newsCanvas && newsWrap === wrap) return true;
    newsWrap = wrap;
    newsCanvas = wrap.querySelector('#news-canvas');
    if (!newsCanvas) {
      newsCanvas = document.createElement('canvas');
      newsCanvas.id = 'news-canvas';
      newsCanvas.style.cssText = 'position:absolute;inset:0;z-index:6;pointer-events:none';
      wrap.appendChild(newsCanvas);
    }
    newsCtx = newsCanvas.getContext('2d');
    return true;
  }

  const DOT = {
    crit: '#8b1a16', high: '#f2615c', med: '#f0b45e', low: '#5b6472',
  };

  function paintNewsDots() {
    if (!window.ChartMgr || !ChartMgr.chart || !ensureNewsCanvas()) return;
    const r = newsWrap.getBoundingClientRect();
    if (newsCanvas.width !== Math.round(r.width * devicePixelRatio) ||
        newsCanvas.height !== Math.round(r.height * devicePixelRatio)) {
      newsCanvas.width = Math.round(r.width * devicePixelRatio);
      newsCanvas.height = Math.round(r.height * devicePixelRatio);
      newsCanvas.style.width = r.width + 'px';
      newsCanvas.style.height = r.height + 'px';
      newsCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
    const W = newsCanvas.clientWidth, H = newsCanvas.clientHeight;
    newsCtx.clearRect(0, 0, W, H);

    const cs = ChartMgr.candles;
    if (!cs || cs.length < 2) return;
    const list = Signals.upcoming(symbolFn(), 48 * 3600);
    if (!list.length) return;

    const last = cs[cs.length - 1], prev = cs[cs.length - 2];
    const xLast = ChartMgr.timeToX(last.time);
    const xPrev = ChartMgr.timeToX(prev.time);
    if (xLast == null || xPrev == null) return;
    const perSec = (xLast - xPrev) / (last.time - prev.time);
    const y = H - 16;

    for (const e of list) {
      const x = xLast + (e.t - last.time) * perSec;
      if (x < -8 || x > W + 8) continue;
      const cls = impactClass(e);
      const col = DOT[cls];
      const future = e.t > Date.now() / 1000;

      // A dashed riser marks a release that has not happened yet, so an event
      // ahead of price is obviously scheduled rather than historical.
      if (future) {
        newsCtx.save();
        newsCtx.strokeStyle = col;
        newsCtx.globalAlpha = 0.35;
        newsCtx.setLineDash([3, 4]);
        newsCtx.beginPath();
        newsCtx.moveTo(x, 0); newsCtx.lineTo(x, y - 7);
        newsCtx.stroke();
        newsCtx.restore();
      }

      newsCtx.beginPath();
      newsCtx.arc(x, y, cls === 'crit' || cls === 'high' ? 5 : 4, 0, Math.PI * 2);
      newsCtx.fillStyle = col;
      newsCtx.globalAlpha = future ? 0.95 : 0.5;
      newsCtx.fill();
      newsCtx.globalAlpha = 1;
      newsCtx.lineWidth = 1;
      newsCtx.strokeStyle = 'rgba(11,13,16,.85)';
      newsCtx.stroke();
    }
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- lifecycle --------------------------------------------------------
  function mount(opts) {
    lastMount = opts;
    symbolFn = opts.symbol || symbolFn;
    Signals.start(symbolFn, 5000);
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      renderTrend($(opts.trend));
      renderSignal($(opts.signal), $(opts.state));
      renderNews($(opts.news), $(opts.newsCount));
      paintNewsDots();
    }, 900);
  }

  /** Force a redraw — used when the account inputs change under the card. */
  let lastMount = null;
  function repaint() {
    if (!lastMount) return;
    renderSignal($(lastMount.signal), $(lastMount.state));
  }

  function unmount() {
    if (timer) { clearInterval(timer); timer = null; }
    Signals.stop();
    if (newsCtx && newsCanvas) newsCtx.clearRect(0, 0, newsCanvas.clientWidth, newsCanvas.clientHeight);
  }

  function onSymbolChange() { Signals.reset(); }

  return { mount, unmount, onSymbolChange, paintNewsDots, repaint };
})();

window.SignalUI = SignalUI;
