// ===========================================================================
// Dashboard controller — navigation, market browser, strategy library,
// guided backtest wizard, manual, FAQ.
// ===========================================================================
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const CAT_ICON = {
    forex: 'fa-money-bill-transfer',
    indices: 'fa-chart-area',
    stocks: 'fa-building-columns',
    commodities: 'fa-oil-well',
    crypto: 'fa-bitcoin-sign',
  };
  const CAT_LABEL = {
    forex: 'Forex', indices: 'Index', stocks: 'Stock',
    commodities: 'Commodity', crypto: 'Crypto',
  };

  // Escape anything that comes from an upstream feed before it touches innerHTML.
  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ESC_MAP[c]);

  // ---------------------------------------------------------------- toast
  function toast(msg, kind = 'info') {
    const host = $('#toast-host');
    const ico = { ok: 'fa-circle-check', err: 'fa-circle-exclamation', warn: 'fa-triangle-exclamation', info: 'fa-circle-info' }[kind];
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = `<i class="fa-solid ${ico}"></i><span>${msg}</span>`;
    host.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 240);
    }, 3800);
  }

  // ---------------------------------------------------------------- routing
  function closeDrawer() {
    $('#sidenav') && $('#sidenav').classList.remove('open');
    $('#nav-scrim') && $('#nav-scrim').classList.remove('open');
    document.body.classList.remove('nav-open');
  }
  function openDrawer() {
    $('#sidenav') && $('#sidenav').classList.add('open');
    $('#nav-scrim') && $('#nav-scrim').classList.add('open');
    document.body.classList.add('nav-open');
  }

  function show(page) {
    $$('.page').forEach(p => p.classList.toggle('active', p.dataset.page === page));
    $$('.nav-item[data-nav]').forEach(n => n.classList.toggle('active', n.dataset.nav === page));
    closeDrawer();
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (location.hash.slice(1) !== page) history.replaceState(null, '', '#' + page);
    // Exchange sockets stay open only while their page is on screen.
    if (page === 'live') mountLive();
    else {
      window.LiveCrypto && LiveCrypto.unmount();
      window.SignalUI && SignalUI.unmount();
      window.MicroPanels && MicroPanels.unmount();
      window.Sessions && Sessions.unmount();
    }
  }
  $$('.nav-item[data-nav]').forEach(n => n.addEventListener('click', () => show(n.dataset.nav)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => show(b.dataset.goto)));

  // ------------------------------------------------------------- live crypto
  // The pair list is the crypto slice of the symbol universe, so it stays in
  // step with whatever the rest of the app supports.
  let livePair = 'BTCUSDT';
  let liveClass = 'crypto';
  try {
    livePair = localStorage.getItem('bt_live_pair') || livePair;
    liveClass = localStorage.getItem('bt_live_class') || liveClass;
  } catch (_e) {}

  // Indices carry none of the crypto microstructure — there is no exchange
  // order book behind a CFD to consolidate — so the two classes show different
  // panels rather than pretending the same ones apply.
  const INDEX_SYMS = ['NAS100', 'US30', 'SPX500', 'GER40', 'UK100', 'JPN225'];
  const isIndex = () => liveClass === 'index';

  function renderPairs() {
    const host = $('#lcp-pairs');
    if (!host) return;
    const list = isIndex()
      ? INDEX_SYMS.filter(s => window.findSymbol && findSymbol(s)).map(s => findSymbol(s))
      : (window.SYMBOLS || []).filter(s => s.cat === 'crypto').slice(0, 14);
    if (!list.some(p => p.sym === livePair)) livePair = list[0] ? list[0].sym : livePair;

    host.innerHTML = list.map(p =>
      `<button class="lcp-pair ${p.sym === livePair ? 'active' : ''}" data-sym="${p.sym}">
         ${isIndex() ? p.sym : p.sym.replace(/USDT$/, '')}</button>`).join('');
    host.onclick = (e) => {
      const b = e.target.closest('.lcp-pair');
      if (!b) return;
      livePair = b.dataset.sym;
      try { localStorage.setItem('bt_live_pair', livePair); } catch (_e) {}
      renderPairs();
      mountLive();
      loadChart();
    };

    $$('#lcp-class button').forEach(b =>
      b.classList.toggle('active', (b.dataset.class === 'index') === isIndex()));
    $('#lcp-index') && $('#lcp-index').classList.toggle('hidden', !isIndex());
    $('#lcp-index2') && $('#lcp-index2').classList.toggle('hidden', !isIndex());
    $('#lcp-call-wrap') && $('#lcp-call-wrap').classList.toggle('hidden', !isIndex());
    // Everything below is crypto-only; hiding it is more honest than showing
    // empty panels that can never fill for an index.
    for (const sel of ['.lcp-micro', '.lcp-grid', '#lcp-market', '#lcp-quote', '#lcp-venues']) {
      const el = document.querySelector(sel);
      if (el) el.classList.toggle('hidden', isIndex());
    }
  }

  // ---- sessions --------------------------------------------------------
  function renderSessions() {
    const host = $('#lcp-sessions');
    if (!host || !window.Sessions) return;
    host.innerHTML = Sessions.DEFS.map(d =>
      `<button class="ses-chip ${Sessions.isOn(d.id) ? '' : 'off'}" data-ses="${d.id}">
         <i style="background:${d.color}"></i>${d.label}
         <small>${Sessions.fmtLocal(d.from)}–${Sessions.fmtLocal(d.to)}</small>
       </button>`).join('');
    host.onclick = (e) => {
      const b = e.target.closest('.ses-chip');
      if (!b) return;
      Sessions.toggle(b.dataset.ses);
      // Trend is context on the call, and it only exists while the engine runs.
      if (window.Signals) Signals.start(() => livePair, 30000);
      renderSessions();
      Sessions.paint();
    };
    const tz = $('#lcp-tz');
    if (tz) {
      const off = Sessions.localOffsetMin();
      const sign = off >= 0 ? '+' : '-';
      tz.textContent = `${Sessions.zoneName()} · UTC${sign}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
    }
    renderSessionNow();
  }

  function renderSessionNow() {
    const host = $('#lcp-ses-now');
    if (!host || !window.Sessions) return;
    const act = Sessions.active();
    const mins = Sessions.toUsOpen();
    const openTxt = mins > 0
      ? `US cash opens in ${mins < 60 ? Math.round(mins) + ' min' : (mins / 60).toFixed(1) + ' h'}`
      : `US cash opened ${Math.abs(mins) < 60 ? Math.round(Math.abs(mins)) + ' min' : (Math.abs(mins) / 60).toFixed(1) + ' h'} ago`;
    host.innerHTML =
      `<div class="ses-now">
         <div class="ses-row"><b>${openTxt}</b></div>
         ${act.length
           ? act.map(a => `<div class="ses-row"><i class="ses-dot" style="background:${a.color}"></i>
               <span>${a.label} open</span>
               <span class="ses-count">${Sessions.fmtLocal(a.from)}–${Sessions.fmtLocal(a.to)} your time</span></div>`).join('')
           : '<div class="ses-row ses-count">No major session open right now.</div>'}
         <div class="ses-row ses-count">Times shown in ${Sessions.zoneName()}; the data itself is UTC.</div>
       </div>`;
  }

  // ---- open forecast ---------------------------------------------------
  /**
   * A probability drawn with its interval.
   *
   * The bar shows the range the sample actually supports; the tick is the point
   * estimate and the faint line is the coin toss. When the shaded band straddles
   * 50% there is no claim to make, and the drawing says so without words.
   */
  function ciBar(w) {
    if (!w) return '';
    return `<div class="fc-ci">
      <div class="fc-ci-bar">
        <i style="left:${w.lo.toFixed(1)}%;width:${Math.max(1, w.hi - w.lo).toFixed(1)}%"></i>
        <s style="left:50%"></s>
        <u style="left:${w.p.toFixed(1)}%"></u>
      </div>
      <div class="fc-ci-lab"><span>0%</span>
        <span>${w.lo.toFixed(0)}–${w.hi.toFixed(0)}% likely range · n=${w.n}</span>
        <span>100%</span></div>
    </div>`;
  }

  function miniBar(w) {
    if (!w) return '<span class="fc-mini"></span><span class="fc-mini-n">—</span>';
    return `<span class="fc-mini">
        <i style="left:${w.lo.toFixed(1)}%;width:${Math.max(1, w.hi - w.lo).toFixed(1)}%"></i>
        <s style="left:50%"></s>
      </span><span class="fc-mini-n">${w.p.toFixed(0)}% ±${((w.hi - w.lo) / 2).toFixed(0)}</span>`;
  }

  function renderForecast() {
    const host = $('#lcp-forecast');
    const nEl = $('#lcp-fc-n');
    if (!host || !window.SessionBot || !window.OpenStats) return;

    const c = OpenStats.cache;
    const t = OpenStats.today(window.ChartMgr ? ChartMgr.candles : null);
    const onChart = window.ChartMgr && ChartMgr.symInfo && ChartMgr.symInfo.sym;

    if (onChart !== livePair || c.sym !== livePair || !c.sessions.length || !t) {
      nEl && (nEl.textContent = OpenStats.loading ? 'loading' : '—');
      host.innerHTML = `<div class="fc-head fc-none">${OpenStats.loading
        ? 'Reading the sessions this one has to be compared against…'
        : 'No history loaded for this instrument yet.'}</div>`;
      return;
    }

    const f = SessionBot.forecast(c.sessions, t, livePair);
    if (!f) { host.innerHTML = '<div class="fc-head fc-none">Nothing to compare against.</div>'; return; }

    if (!f.enough) {
      nEl && (nEl.textContent = `n=${f.n}`);
      host.innerHTML =
        `<div class="fc-head"><div class="fc-none">Only <b>${f.n}</b> past session${f.n === 1 ? '' : 's'}
           matched this setup even after loosening the conditions. That is not enough to put a number on,
           so none is given.</div></div>`;
      return;
    }

    nEl && (nEl.textContent = `n=${f.n}`);
    const h = f.headline;
    const news = f.news;

    const newsBlock = news.items.length
      ? `<div class="fc-caveat"><b>${news.items.length} release${news.items.length === 1 ? '' : 's'}
           in the open window</b> — ${news.items.slice(0, 3).map(x => esc(x.title)).join(', ')}.
           ${news.high
             ? 'A high-impact US print at the open is precisely the case history cannot speak to; treat every figure here as suspended until it lands.'
             : 'Nothing top-tier, but the window is not clean.'}</div>`
      : '';

    host.innerHTML =
      `<div class="fc-head">
         <div class="${h.has ? 'fc-claim' : 'fc-none'}">${esc(h.text)}</div>
       </div>
       ${h.has ? `<div class="fc-prob">
           <b class="${h.w.p >= 50 ? 't-up' : 't-down'}">${h.w.p.toFixed(0)}%</b>
           <small>of ${h.w.n} comparable sessions</small>
         </div>${ciBar(h.w)}` : ''}
       ${newsBlock}
       <div class="fc-rows">
         <div class="fc-row"><span>Gap fills during the session</span>${miniBar(f.outcomes.fill)}</div>
         <div class="fc-row"><span>First hour holds the gap direction</span>${miniBar(f.outcomes.hold)}</div>
         <div class="fc-row"><span>Closes in the gap's direction</span>${miniBar(f.outcomes.close)}</div>
         <div class="fc-row"><span>First hour ranges more than 0.35%</span>${miniBar(f.outcomes.expand)}</div>
       </div>
       <div class="fc-rows">
         <div class="fc-row"><span>Typical first hour</span>
           <span class="fc-mini-n">${f.hour.medianMove >= 0 ? '+' : ''}${f.hour.medianMove.toFixed(2)}%</span></div>
         <div class="fc-row"><span>Reach up / down (median)</span>
           <span class="fc-mini-n">+${f.hour.medianUp.toFixed(2)}% / ${f.hour.medianDown.toFixed(2)}%</span></div>
         <div class="fc-row"><span>Stretch case (8 in 10)</span>
           <span class="fc-mini-n">+${f.hour.p80Up.toFixed(2)}% / ${f.hour.p80Down.toFixed(2)}%</span></div>
       </div>
       <div class="fc-used">Matched on ${f.used.join(', ')}${f.dropped.length
         ? `. Dropped to find enough sessions: ${f.dropped.join(', ')}` : ''}.
         The shaded band is the range the sample supports at 95% — with ${f.n} sessions it is wide,
         and that width is the real answer. These are base rates, not a forecast of today.${
           f.n < 15 ? ` Reading further back would narrow it; ${histDays}d is loaded now.` : ''}</div>`;
  }

  // ---- today's call ----------------------------------------------------
  function renderCall() {
    const host = $('#lcp-call');
    const whenEl = $('#lcp-call-when');
    const scoreEl = $('#lcp-call-score');
    if (!host || !window.DailyCall || !window.SessionBot) return;

    const c = OpenStats.cache;
    const onChart = window.ChartMgr && ChartMgr.symInfo && ChartMgr.symInfo.sym;
    // Both the prices and the history have to belong to this instrument. Whilst
    // an instrument switch is in flight the chart flips first and the session
    // history a moment later, and building a call across that gap produced US30
    // levels carrying NASDAQ's base rates.
    if (onChart !== livePair || c.sym !== livePair || !c.sessions.length) {
      whenEl && (whenEl.textContent = OpenStats.loading ? 'loading' : '—');
      host.innerHTML = `<div class="dc-note">${OpenStats.loading
        ? 'Reading the sessions this call has to be measured against…'
        : 'No history loaded for this instrument yet.'}</div>`;
      return;
    }

    // Grade whatever has since played out before writing anything new.
    DailyCall.grade(livePair, c.sessions);

    const t = OpenStats.today(window.ChartMgr ? ChartMgr.candles : null);
    const trends = window.Signals ? Signals.trends : null;
    const fresh = DailyCall.build(livePair, c.sessions, t, trends);
    const call = fresh && fresh.enough ? DailyCall.record(fresh) : fresh;

    const mins = Sessions.toUsOpen();
    whenEl && (whenEl.textContent = mins > 0
      ? `opens in ${mins < 60 ? Math.round(mins) + 'm' : (mins / 60).toFixed(1) + 'h'}`
      : `open ${Math.abs(mins) < 60 ? Math.round(Math.abs(mins)) + 'm' : (Math.abs(mins) / 60).toFixed(1) + 'h'} ago`);

    const sc = DailyCall.scorecard(livePair);
    if (scoreEl) {
      scoreEl.textContent = sc.n
        ? `${sc.right}/${sc.n} graded · ${sc.pct.toFixed(0)}%`
        : 'no record yet';
    }

    if (!call || !call.enough) {
      host.innerHTML =
        `<div class="dc-head"><span class="dc-tier none">no call</span>
           <div class="dc-claim">Not calling this one.</div>
           <div class="dc-sub">${esc(call ? call.reason : 'No comparable sessions.')}
             Reading further back would give it more to work with.</div></div>` + logBlock(sc);
      return;
    }

    const d = (window.findSymbol && findSymbol(livePair)?.digits) ?? 1;
    const px = (v) => Number(v).toLocaleString(undefined,
      { minimumFractionDigits: d, maximumFractionDigits: d });

    const tierLabel = { firm: 'firm read', lean: 'lean only', none: 'no read' }[call.tier];
    const claim = call.claim
      ? esc(call.claim)
      : 'Nothing in the matched sessions separates from a coin toss. No call today.';

    const probLine = call.prob
      ? `<div class="dc-sub"><b>${call.prob.p.toFixed(0)}%</b> of ${call.prob.n} comparable sessions —
           the interval runs ${call.prob.lo.toFixed(0)}–${call.prob.hi.toFixed(0)}%, and that width is
           part of the answer.</div>`
      : '';

    const newsPill = call.news.items.length
      ? `<span class="dc-pill">${call.news.items.length} release${call.news.items.length === 1 ? '' : 's'} at the open${call.news.high ? ' · high impact' : ''}</span>`
      : `<span class="dc-pill">clean news window</span>`;

    host.innerHTML =
      `<div class="dc-head">
         <span class="dc-tier ${call.tier}">${tierLabel}</span>
         <div class="dc-claim">${claim}</div>
         ${probLine}
       </div>
       <div class="dc-levels">
         <div class="dc-lv"><span>Yesterday's close</span><b>${px(call.levels.prevClose)}</b></div>
         <div class="dc-lv"><span>${call.gapPct >= 0 ? 'Gap up' : 'Gap down'}</span>
           <b class="${call.gapPct >= 0 ? 't-up' : 't-down'}">${call.gapPct >= 0 ? '+' : ''}${call.gapPct.toFixed(2)}%</b>
           <small>from ${px(call.levels.ref)}</small></div>
         <div class="dc-lv"><span>First hour, up to</span><b class="t-up">${px(call.levels.reachUp)}</b>
           <small>stretch ${px(call.levels.stretchUp)}</small></div>
         <div class="dc-lv"><span>First hour, down to</span><b class="t-down">${px(call.levels.reachDown)}</b>
           <small>stretch ${px(call.levels.stretchDown)}</small></div>
       </div>
       <div class="dc-ctx">
         ${call.context.trendNote ? `<span class="dc-pill">${esc(call.context.trendNote)} — ${esc(call.context.trendAgrees)}</span>` : ''}
         ${newsPill}
         <span class="dc-pill">matched on ${esc(call.used.join(', '))}</span>
       </div>
       <div class="dc-note">The reach levels are the median of what sessions like this one actually
         did in the first hour, priced for today; the stretch figures are the 8-in-10 case, which is
         what a stop has to survive. Trend and news sit beside the number, not inside it — there is
         no sample behind them, and folding them in would invent precision the data does not have.</div>` +
      logBlock(sc);
  }

  function logBlock(sc) {
    if (!sc || !sc.recent || !sc.recent.length) {
      return `<div class="dc-note">No graded calls yet. Each day's call is written down before the
        open and scored once the session has run, so this fills in on its own.</div>`;
    }
    const rows = sc.recent.map(c => {
      const mark = c.graded ? (c.right ? 'ok' : 'no') : 'pending';
      const glyph = c.graded ? (c.right ? '✓' : '✗') : '·';
      const what = c.claim ? c.claim.replace(/^Sessions like this one tended to /, '') : 'no call';
      return `<div class="dc-log-row">
        <small>${c.day}</small>
        <span class="dc-mark ${mark}">${glyph}</span>
        <span>${esc(what.slice(0, 64))}</span>
        <small>${c.prob ? c.prob.p.toFixed(0) + '%' : '—'}</small>
      </div>`;
    }).join('');
    const tiers = Object.entries(sc.byTier || {})
      .map(([k, v]) => `${k}: ${v.right}/${v.n}`).join(' · ');
    return `<div class="dc-log">
      <div class="dc-note" style="padding:0 0 6px">Its own calls, graded after the fact${tiers ? ` — ${tiers}` : ''}.</div>
      ${rows}</div>`;
  }

  // ---- how violent each open is ----------------------------------------
  let volCache = { sym: null, data: null };
  // How far back to read. More history narrows the confidence intervals, which
  // is usually the difference between the bot having something to say and
  // honestly saying it does not — but below an hour the archive is one file per
  // day, so ninety days is ninety requests.
  let histDays = 30;
  try { histDays = parseInt(localStorage.getItem('bt_hist_days')) || 30; } catch (_e) {}

  function renderVolProfile() {
    const host = $('#lcp-volprofile');
    const nEl = $('#lcp-vol-n');
    if (!host || !window.SessionBot) return;

    const c = OpenStats.cache;
    if (!c.candles || c.sym !== livePair) {
      nEl && (nEl.textContent = OpenStats.loading ? 'loading' : '—');
      host.innerHTML = `<div class="vp-note">${OpenStats.loading
        ? 'Measuring the sessions…' : 'No history loaded yet.'}</div>`;
      return;
    }
    if (volCache.sym !== livePair) {
      volCache = { sym: livePair, data: SessionBot.volatilityProfile(c.candles, 30) };
    }
    const v = volCache.data;
    if (!v) { host.innerHTML = '<div class="vp-note">Not enough history to measure.</div>'; return; }

    nEl && (nEl.textContent = `${v.days} days`);
    const max = Math.max(1.2, ...v.opens.map(o => (o.stats ? o.stats.median : 0)));

    host.innerHTML = v.opens.map(o => {
      if (!o.stats) return `<div class="vp-row"><b>${o.label}</b><span class="vp-note">no data</span><span></span></div>`;
      const w = Math.min(100, (o.stats.median / max) * 100);
      return `<div class="vp-row">
        <b>${o.label}</b>
        <span class="vp-bar"><i style="width:${w.toFixed(0)}%"></i></span>
        <span class="vp-x ${o.stats.median > 1.5 ? 't-up' : ''}">${o.stats.median.toFixed(2)}&times;</span>
      </div>`;
    }).join('') +
      `<div class="vp-note">Range in the 30 minutes after each open, as a multiple of the same day's
        typical 30-minute range. Above 1.0 means the open genuinely moves more than an average
        stretch of that day — measured over ${v.days} sessions, not assumed.</div>`;
  }

  // ---- open statistics -------------------------------------------------
  function renderOpenStats() {
    const host = $('#lcp-openstats');
    if (!host || !window.OpenStats) return;
    const sum = OpenStats.summary(livePair, window.ChartMgr ? ChartMgr.candles : null);
    const nEl = $('#lcp-open-n');

    if (sum.mismatch) {
      nEl && (nEl.textContent = 'no data');
      host.innerHTML = `<div class="os-note">No history loaded for <b>${esc(livePair)}</b> —
        the chart is still showing ${esc(sum.mismatch)}. The Dukascopy archive is refusing
        requests at the moment, so nothing is shown rather than the wrong instrument's numbers.</div>`;
      return;
    }
    if (sum.error) {
      nEl && (nEl.textContent = 'unavailable');
      host.innerHTML = `<div class="os-note">Could not build the history: ${esc(sum.error)}.
        The index archive has been intermittent today; it will fill in when the feed returns.</div>`;
      return;
    }
    if (!sum.today) {
      const pct = Math.round((sum.progress || 0) * 100);
      nEl && (nEl.textContent = sum.loading ? pct + '%' : '—');
      host.innerHTML = sum.loading
        ? `<div class="os-note">Reading a month of sessions from the archive — ${pct}%.
             Below an hour the feed publishes one file per day, so this takes a moment.</div>
           <div class="os-bar" style="margin:0 14px 12px"><i style="width:${pct}%"></i></div>`
        : `<div class="os-note">Waiting for chart data.</div>`;
      return;
    }

    const t = sum.today;
    const st = sum.stats;
    nEl && (nEl.textContent = `${sum.sessions} sessions`);

    const gapCls = t.gapPct >= 0 ? 't-up' : 't-down';
    // The archive publishes after the fact. When its last bar is hours old the
    // figures describe where things stood then, and saying so beats letting
    // them read as current.
    const staleNote = t.stale
      ? `<div class="os-note t-warn">The archive's last bar is ${t.staleMin > 90
           ? (t.staleMin / 60).toFixed(1) + ' hours' : t.staleMin + ' minutes'} old —
           these figures describe that moment, not now.</div>`
      : '';
    const head =
      `<div class="os-head">
         <div class="os-cell"><span>${t.opened ? 'Gap at open' : 'Gap so far'}</span>
           <b class="${gapCls}">${t.gapPct >= 0 ? '+' : ''}${t.gapPct.toFixed(2)}%</b></div>
         <div class="os-cell"><span>Prev close</span><b>${t.prevClose.toFixed(1)}</b></div>
         <div class="os-cell"><span>Overnight range</span>
           <b>${t.onRangePct != null ? t.onRangePct.toFixed(2) + '%' : '—'}</b></div>
         <div class="os-cell"><span>${t.opened ? 'Since open' : 'To open'}</span>
           <b>${t.opened ? 'live' : (t.minsToOpen < 60 ? Math.round(t.minsToOpen) + 'm' : (t.minsToOpen / 60).toFixed(1) + 'h')}</b></div>
       </div>`;

    if (!st) {
      const pct = Math.round((sum.progress || 0) * 100);
      host.innerHTML = head + staleNote + (sum.loading
        ? `<div class="os-note">Reading a month of sessions — ${pct}%.</div>
           <div class="os-bar" style="margin:0 14px 12px"><i style="width:${pct}%"></i></div>`
        : `<div class="os-note">Not enough history to compare against yet.</div>`);
      return;
    }
    if (st.tooFew) {
      host.innerHTML = head + staleNote +
        `<div class="os-note">Only ${st.n} past session${st.n === 1 ? '' : 's'} looked like this one.
         That is too few to quote a rate from, so no rate is quoted.</div>`;
      return;
    }

    const rate = (label, pct) =>
      `<div class="os-rate"><span>${label}</span><b>${pct.toFixed(0)}%</b>
         <span class="os-bar"><i style="width:${pct.toFixed(0)}%"></i></span></div>`;

    host.innerHTML = head + staleNote +
      `<div class="os-rates">
         ${rate('Gap filled during the session', st.filledPct)}
         ${rate('First hour held the gap direction', st.heldPct)}
         ${rate('Closed the session in that direction', st.closedWithPct)}
       </div>
       <div class="os-head">
         <div class="os-cell"><span>Median first hour</span>
           <b class="${st.medianHourPct >= 0 ? 't-up' : 't-down'}">${st.medianHourPct >= 0 ? '+' : ''}${st.medianHourPct.toFixed(2)}%</b></div>
         <div class="os-cell"><span>Avg reach up</span><b class="t-up">+${st.avgUpPct.toFixed(2)}%</b></div>
         <div class="os-cell"><span>Avg reach down</span><b class="t-down">${st.avgDownPct.toFixed(2)}%</b></div>
       </div>
       <div class="os-note">Measured over <b>${st.n}</b> past sessions whose gap was within
         ${st.band.toFixed(2)}% of today's, in the same direction. These are base rates, not a
         forecast — they say what usually followed, not what is about to. With ${st.n} matches
         from one instrument over a few weeks, treat a difference of a few percent as noise.</div>`;
  }


  // ---- chart -------------------------------------------------------------
  let liveTf = '5m';
  try { liveTf = localStorage.getItem('bt_live_tf') || liveTf; } catch (_e) {}
  let chartReady = false;
  let loadSeq = 0;
  let chartError = null;

  // How much history to pull per timeframe: enough context without making the
  // page wait on a download it does not need.
  const SPAN = { '1m': 2, '5m': 7, '15m': 21, '1h': 90, '4h': 300, '1d': 1500 };

  async function loadChart() {
    if (!window.ChartMgr || !$('#lcp-chart')) return;
    if (!chartReady) { ChartMgr.init($('#lcp-chart')); chartReady = true; }

    const seq = ++loadSeq;
    const info = window.findSymbol(livePair);
    const to = Math.floor(Date.now() / 1000);
    const from = to - (SPAN[liveTf] || 30) * 86400;
    try {
      const candles = await DataStore.load(livePair, liveTf, from, to);
      // A slower earlier request must not overwrite a newer selection.
      if (seq !== loadSeq) return;
      if (!candles || candles.length < 5) {
        throw new Error('no candles came back for ' + livePair);
      }
      ChartMgr.setData(candles, info, { fit: false, lastBars: 120 });
      LiveChart.refresh();
      chartError = null;
    } catch (e) {
      console.warn('[live] chart load failed', e);
      chartError = e.message || 'the data feed refused the request';
    }
    syncOverlayButtons();
  }

  // Perps only exist quoted in USDT, so offering a USD filter beside them would
  // silently produce an empty book.
  function syncQuoteButtons() {
    const perpOnly = CryptoHub.market === 'perp';
    $$('#lcp-quote button').forEach(b => {
      const isUsd = b.dataset.quote === 'USD';
      b.disabled = perpOnly && isUsd;
      b.classList.toggle('active', b.dataset.quote === CryptoHub.quote);
    });
    $$('#lcp-market button').forEach(b =>
      b.classList.toggle('active', b.dataset.market === CryptoHub.market));
  }

  // The sizing inputs are the account, so they persist and drive every plan the
  // signal card draws.
  const RISK_FIELDS = { 'rk-balance': 'balance', 'rk-risk': 'riskPct', 'rk-lev': 'leverage', 'rk-hold': 'holdHours' };

  function syncRiskInputs() {
    if (!window.Risk) return;
    const c = Risk.cfg;
    for (const [id, key] of Object.entries(RISK_FIELDS)) {
      const el = $('#' + id);
      if (el && document.activeElement !== el) el.value = c[key];
    }
    const note = $('#lcp-risk-note');
    if (note) note.textContent = `${c.riskPct}% of ${Risk.fmt(c.balance)}`;
  }

  function bindRiskInputs() {
    if (bindRiskInputs._done || !window.Risk) return;
    bindRiskInputs._done = true;
    for (const [id, key] of Object.entries(RISK_FIELDS)) {
      const el = $('#' + id);
      if (!el) continue;
      el.addEventListener('input', () => {
        Risk.set(key, el.value);
        syncRiskInputs();
        window.SignalUI && SignalUI.repaint();
      });
    }
  }

  function syncOverlayButtons() {
    if (!window.MicroPanels) return;
    const st = MicroPanels.status();
    const h = $('#lcp-heat-note');
    if (h) h.textContent = st.cols
      ? `${st.seconds}s of book`
      : 'live only — fills in from now';
    const f = $('#lcp-foot-note');
    if (f) {
      const tickTxt = st.tick ? ` · ${st.tick} rows` : '';
      f.textContent = (st.backfill || (st.bars ? `${st.bars} bars` : 'waiting for prints')) + tickTxt;
    }
    const n = $('#lcp-ovnote');
    if (n) {
      if (chartError) {
        n.textContent = `${livePair}: ${chartError}`;
        n.classList.add('t-down');
      } else {
        n.classList.remove('t-down');
        n.textContent = isIndex()
          ? `${livePair} · archive feed`
          : 'streaming from ' + (CryptoHub.feed ? CryptoHub.feed.liveBooks().length : 0) + ' venues';
      }
    }
  }

  // Page controls, bound once. Kept out of mountLive's branches so an early
  // return on one instrument class cannot leave them unbound for the other.
  function bindControls() {
    if (bindControls._done) return;
    bindControls._done = true;

      $('#lcp-tf').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        liveTf = b.dataset.tf;
        try { localStorage.setItem('bt_live_tf', liveTf); } catch (_e) {}
        $$('#lcp-tf button').forEach(x => x.classList.toggle('active', x === b));
        loadChart();
      });
      $('#lcp-band').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        $$('#lcp-band button').forEach(x => x.classList.toggle('active', x === b));
        MicroPanels.setBand(parseFloat(b.dataset.band));
      });
      $('#lcp-fpbars').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        $$('#lcp-fpbars button').forEach(x => x.classList.toggle('active', x === b));
        MicroPanels.setBars(parseInt(b.dataset.bars));
      });
      $('#lcp-fpmult').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        $$('#lcp-fpmult button').forEach(x => x.classList.toggle('active', x === b));
        MicroPanels.setFpMult(parseInt(b.dataset.mult));
      });
      $('#lcp-hist').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        $$('#lcp-hist button').forEach(x => x.classList.toggle('active', x === b));
        histDays = parseInt(b.dataset.days);
        try { localStorage.setItem('bt_hist_days', String(histDays)); } catch (_e) {}
        volCache = { sym: null, data: null };
        OpenStats.cache.sym = null;                     // force a re-read
        renderOpenStats(); renderForecast(); renderVolProfile();
        OpenStats.load(livePair, histDays)
          .then(() => { renderOpenStats(); renderCall(); renderForecast(); renderVolProfile(); })
          .catch(() => renderOpenStats());
      });
      $('#lcp-class').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        liveClass = b.dataset.class;
        try { localStorage.setItem('bt_live_class', liveClass); } catch (_e) {}
        renderPairs();
        mountLive();
        loadChart();
      });
      $('#lcp-market').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        $$('#lcp-market button').forEach(x => x.classList.toggle('active', x === b));
        CryptoHub.setMarket(b.dataset.market);
        syncQuoteButtons();
        MicroPanels.onMarketChange();
      });
      $('#lcp-quote').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        CryptoHub.setQuote(b.dataset.quote);
        syncQuoteButtons();
        MicroPanels.paint();
      });
      setInterval(() => { if ($('#lcp-ovnote')) syncOverlayButtons(); }, 2000);
  }

  // On a phone the Live Crypto intro was a third of the first screen. It is
  // clamped there and opened on demand rather than cut, so nothing is lost.
  function bindIntroToggle() {
    const head = document.querySelector('.page[data-page="live"] .page-head');
    const p = head && head.querySelector('p');
    if (!head || !p || head.querySelector('.intro-more')) return;
    const btn = document.createElement('button');
    btn.className = 'intro-more';
    btn.textContent = 'more';
    btn.addEventListener('click', () => {
      const open = p.classList.toggle('open');
      btn.textContent = open ? 'less' : 'more';
    });
    head.appendChild(btn);
  }
  bindIntroToggle();

  // Install and alert controls live on the page, not behind a browser menu.
  if (window.PWA) PWA.init('#lcp-pwa');

  function mountLive() {
    if (!window.LiveCrypto || !$('#lcp-book')) return;
    renderPairs();
    $('#lcp-sym') && ($('#lcp-sym').textContent = livePair);
    CryptoHub.setSymbol(livePair);
    LiveCrypto.mount({
      book: $('#lcp-book'), delta: $('#lcp-delta'),
      whales: $('#lcp-whales'), venues: $('#lcp-venues'),
    }, { density: 'page', symbol: livePair });

    if (window.LiveChart) {
      LiveChart.configure({
        symbol: () => livePair, tf: () => liveTf, blocked: () => false,
      });
      LiveChart.init('#lcp-chart-wrap');
    }
    $$('#lcp-tf button').forEach(b => b.classList.toggle('active', b.dataset.tf === liveTf));
    loadChart();
    syncOverlayButtons();

    syncQuoteButtons();
    syncRiskInputs();
    if (window.Sessions) Sessions.mount('#lcp-chart-wrap');

    // Bound before the index branch returns: these controls belong to the page,
    // and wiring them inside a path that only crypto reaches left every button
    // on the index view inert.
    bindControls();
    // Reflect the stored choice before any branch returns — the index view was
    // showing 30d while sixty days were actually loaded.
    $$('#lcp-hist button').forEach(x =>
      x.classList.toggle('active', parseInt(x.dataset.days) === histDays));

    if (isIndex()) {
      window.MicroPanels && MicroPanels.unmount();
      window.LiveCrypto && LiveCrypto.unmount();
      window.SignalUI && SignalUI.unmount();
      renderSessions();
      renderOpenStats();
      renderCall();
      renderForecast();
      renderVolProfile();
      volCache = { sym: null, data: null };
      OpenStats.load(livePair, histDays)
        .then(() => { renderOpenStats(); renderForecast(); renderVolProfile(); })
        .catch(() => renderOpenStats());
      if (!mountLive._idxTimer) {
        mountLive._idxTimer = setInterval(() => {
          if (isIndex() && $('#lcp-openstats')) {
            renderSessionNow(); renderOpenStats(); renderCall();
            renderForecast(); renderVolProfile();
          }
        }, 5000);
      }
      return;
    }

    if (window.MicroPanels) {
      MicroPanels.onSymbolChange();
      MicroPanels.mount({ heat: $('#lcp-heat'), foot: $('#lcp-foot') });
    }

    if (window.SignalUI) {
      SignalUI.onSymbolChange();
      SignalUI.mount({
        symbol: () => livePair,
        trend: '#lcp-trend', signal: '#lcp-signal', state: '#lcp-sig-state',
        news: '#lcp-news', newsCount: '#lcp-news-count',
      });
    }
    bindRiskInputs();
  }

  // ---------------------------------------------------------- mobile drawer
  $('#nav-toggle') && $('#nav-toggle').addEventListener('click', () => {
    $('#sidenav').classList.contains('open') ? closeDrawer() : openDrawer();
  });
  $('#nav-scrim') && $('#nav-scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

  // ---------------------------------------------------------------- markets
  function marketCard(s) {
    return `<button class="market-card" data-sym="${s.sym}">
      <div class="mc-top">
        <div>
          <div class="mc-sym">${s.sym}</div>
          <div class="mc-name">${s.name}</div>
        </div>
        <i class="fa-solid ${CAT_ICON[s.cat] || 'fa-chart-line'}" style="color:var(--t-4);font-size:13px"></i>
      </div>
      <div class="mc-meta">
        <span class="pill">${CAT_LABEL[s.cat] || s.cat}</span>
        <span>${s.source === 'binance' ? 'Binance' : 'Dukascopy'}</span>
      </div>
    </button>`;
  }

  const HOME_PICKS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'NAS100', 'SPX500', 'US30', 'BTCUSDT'];
  $('#home-markets').innerHTML = HOME_PICKS.map(s => marketCard(getSymbol(s))).join('');
  $$('#home-markets .market-card').forEach(c =>
    c.addEventListener('click', () => { location.href = '/terminal?symbol=' + c.dataset.sym; }));

  // Markets table
  function renderMarkets(cat) {
    const rows = SYMBOLS.filter(s => cat === 'all' || s.cat === cat).map(s => `
      <tr>
        <td style="font-weight:650">${s.sym}</td>
        <td style="text-align:left;color:var(--t-2)">${s.name}</td>
        <td style="text-align:left"><span class="pill">${CAT_LABEL[s.cat] || s.cat}</span></td>
        <td style="text-align:left;color:var(--t-3)">${s.source === 'binance' ? 'Binance spot' : 'Dukascopy archive'}</td>
        <td>${s.lotUnits.toLocaleString()}</td>
        <td>${s.pip}</td>
        <td>${s.digits}</td>
      </tr>`).join('');
    $('#mk-rows').innerHTML = rows;
  }
  renderMarkets('all');
  $$('#mk-filters .chip').forEach(c => c.addEventListener('click', () => {
    $$('#mk-filters .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    renderMarkets(c.dataset.cat);
  }));

  // ---- full-catalog search (search-first: results only appear when typing) ----
  (() => {
    const input = $('#mk-search');
    const box = $('#mk-results');
    if (!input || !box || !window.Catalog) return;
    let timer = null, seq = 0;

    function resultRow(s, isCatalog) {
      return `<button class="mkr-row" data-sym="${s.sym}">
        <span class="mkr-ico">${CAT_LABEL[s.cat] || s.cat}</span>
        <span class="mkr-l">
          <b>${s.sym}${s.label && s.label !== s.sym ? ` <small>${s.label}</small>` : ''}</b>
          <small>${s.name}</small>
        </span>
        <span class="mkr-r">
          ${s.since ? `<span class="pill">since ${s.since}</span>` : ''}
          <span class="pill">${s.source === 'binance' ? 'Binance' : 'Dukascopy'}</span>
          <i class="fa-solid fa-arrow-up-right-from-square"></i>
        </span>
      </button>`;
    }

    async function run(q) {
      const my = ++seq;
      if (!q.trim()) { box.classList.add('hidden'); box.innerHTML = ''; return; }
      box.classList.remove('hidden');
      box.innerHTML = `<div class="mkr-hint"><i class="fa-solid fa-circle-notch fa-spin"></i> Searching the catalog…</div>`;
      let res;
      try { res = await Catalog.search(q, 'all', 50); }
      catch (_) { box.innerHTML = `<div class="mkr-hint">Catalog unavailable right now.</div>`; return; }
      if (my !== seq) return;
      const parts = [];
      if (res.curated.length) parts.push(res.curated.map(s => resultRow(s, false)).join(''));
      if (res.catalog.length) {
        parts.push(`<div class="mkr-group">Full Dukascopy catalog</div>`);
        parts.push(res.catalog.map(s => resultRow(s, true)).join(''));
      }
      box.innerHTML = parts.length
        ? parts.join('')
        : `<div class="mkr-hint"><i class="fa-solid fa-magnifying-glass"></i> Nothing matches “${q}”. Try a ticker, a company name or a currency pair.</div>`;
      $$('.mkr-row', box).forEach(r => r.addEventListener('click', async () => {
        const sym = r.dataset.sym;
        // register catalog picks so the terminal can load them by symbol
        if (!window.findSymbol || !window.findSymbol(sym)) await Catalog.findAndRegister(sym);
        location.href = '/terminal?symbol=' + encodeURIComponent(sym);
      }));
    }

    input.addEventListener('input', e => {
      clearTimeout(timer);
      timer = setTimeout(() => run(e.target.value), 200);
    });
  })();

  // ---------------------------------------------------------------- strategy library
  function strategyCard(st, opts = {}) {
    const fam = FAMILY_META[st.family] || { label: st.family, icon: 'fa-code', color: 'var(--t-2)' };
    const lang = LANG_META[st.lang];
    const spec = st.rules ? `
      <dl class="sc-spec">
        <dt>Long</dt><dd>${st.rules.entryLong}</dd>
        <dt>Short</dt><dd>${st.rules.entryShort}</dd>
        <dt>Exit</dt><dd>${st.rules.exit}</dd>
        <dt>Size</dt><dd>${st.rules.sizing}</dd>
      </dl>` : '';
    return `<article class="strat-card ${opts.selectable ? 'selectable' : ''}" data-id="${st.id}"
              ${opts.selectable ? 'style="cursor:pointer"' : ''}>
      <div class="sc-head">
        <h4><i class="fa-solid ${fam.icon}" style="color:${fam.color}"></i> ${st.name}</h4>
        <span class="tag-lang tag-${st.lang}">${lang.tag}</span>
      </div>
      <p class="sc-desc">${st.summary}</p>
      ${spec}
      <div class="sc-foot">
        <span class="pill">${fam.label}</span>
        <span class="pill">${st.tf.join(' · ')}</span>
      </div>
      ${opts.selectable ? '<div class="sc-pick"></div>' : `
      <button class="btn btn-outline btn-sm" data-test="${st.id}"><i class="fa-solid fa-play"></i> Backtest this</button>`}
    </article>`;
  }

  function renderLibrary(fam) {
    const list = fam === 'all' ? STRATEGY_LIBRARY : STRATEGY_LIBRARY.filter(s => s.family === fam);
    $('#lib-grid').innerHTML = list.map(s => strategyCard(s)).join('');
    $$('#lib-grid [data-test]').forEach(b => b.addEventListener('click', () => {
      wiz.strategy = b.dataset.test;
      show('wizard');
      renderWizStrategies();
      goStep(3);
      toast('Strategy selected — set the account next', 'ok');
    }));
  }

  const families = [...new Set(STRATEGY_LIBRARY.map(s => s.family))];
  $('#lib-filters').innerHTML =
    `<button class="chip active" data-fam="all">All <span class="chip-n">${STRATEGY_LIBRARY.length}</span></button>` +
    families.map(f => {
      const m = FAMILY_META[f];
      const n = STRATEGY_LIBRARY.filter(s => s.family === f).length;
      return `<button class="chip" data-fam="${f}"><i class="fa-solid ${m.icon}"></i> ${m.label} <span class="chip-n">${n}</span></button>`;
    }).join('');
  $$('#lib-filters .chip').forEach(c => c.addEventListener('click', () => {
    $$('#lib-filters .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    renderLibrary(c.dataset.fam);
  }));
  renderLibrary('all');
  $('#stat-strats').textContent = STRATEGY_LIBRARY.filter(s => s.family !== 'template').length;

  // ---------------------------------------------------------------- wizard
  const wiz = {
    symbol: 'EURUSD',
    tf: '1h',
    strategy: 'ema-trend-atr',
    prop: 'none',
    step: 1,
  };

  function goStep(n) {
    wiz.step = n;
    $$('.wiz-step').forEach(s => s.classList.toggle('active', +s.dataset.step === n));
    $$('.wiz-node').forEach(nd => {
      const i = +nd.dataset.node;
      nd.classList.toggle('done', i < n);
      nd.classList.toggle('current', i === n);
    });
    $$('.wiz-line').forEach((l, i) => l.classList.toggle('done', i + 1 < n));
    if (n === 4) renderReview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('[data-wiz-next]').forEach(b => b.addEventListener('click', () => goStep(+b.dataset.wizNext)));

  function renderWizMarkets(cat) {
    const list = SYMBOLS.filter(s => s.cat === cat);
    $('#wiz-markets').innerHTML = list.map(s => marketCard(s)).join('');
    $$('#wiz-markets .market-card').forEach(c => {
      if (c.dataset.sym === wiz.symbol) c.style.borderColor = 'var(--brand)';
      c.addEventListener('click', () => {
        wiz.symbol = c.dataset.sym;
        $$('#wiz-markets .market-card').forEach(x => x.style.borderColor = '');
        c.style.borderColor = 'var(--brand)';
      });
    });
  }
  renderWizMarkets('forex');
  $$('#wiz-cats .chip').forEach(c => c.addEventListener('click', () => {
    $$('#wiz-cats .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    renderWizMarkets(c.dataset.cat);
  }));

  function syncTF() {
    $$('#wiz-tfs .opt-card').forEach(o => o.classList.toggle('active', o.dataset.tf === wiz.tf));
  }
  $$('#wiz-tfs .opt-card').forEach(o => o.addEventListener('click', () => { wiz.tf = o.dataset.tf; syncTF(); }));
  syncTF();

  function renderWizStrategies(fam = 'all') {
    const list = (fam === 'all' ? STRATEGY_LIBRARY : STRATEGY_LIBRARY.filter(s => s.family === fam))
      .filter(s => s.family !== 'template');
    $('#wiz-strats').innerHTML = list.map(s => strategyCard(s, { selectable: true })).join('');
    $$('#wiz-strats .strat-card').forEach(c => {
      const on = c.dataset.id === wiz.strategy;
      c.style.borderColor = on ? 'var(--brand)' : '';
      c.addEventListener('click', () => {
        wiz.strategy = c.dataset.id;
        $$('#wiz-strats .strat-card').forEach(x => x.style.borderColor = '');
        c.style.borderColor = 'var(--brand)';
      });
    });
  }
  $('#wiz-fams').innerHTML =
    `<button class="chip active" data-fam="all">All</button>` +
    families.filter(f => f !== 'template').map(f =>
      `<button class="chip" data-fam="${f}"><i class="fa-solid ${FAMILY_META[f].icon}"></i> ${FAMILY_META[f].label}</button>`).join('');
  $$('#wiz-fams .chip').forEach(c => c.addEventListener('click', () => {
    $$('#wiz-fams .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    renderWizStrategies(c.dataset.fam);
  }));
  renderWizStrategies();

  $$('#w-props .opt-card').forEach(o => o.addEventListener('click', () => {
    $$('#w-props .opt-card').forEach(x => x.classList.remove('active'));
    o.classList.add('active');
    wiz.prop = o.dataset.prop;
  }));

  const PROP_LABEL = {
    none: 'Off — plain account',
    ftmo1: 'Evaluation Phase 1 (+10% target, 5% daily, 10% max)',
    ftmo2: 'Evaluation Phase 2 (+5% target, 5% daily, 10% max)',
    funded: 'Funded account (5% daily, 10% max)',
  };
  const TF_LABEL = { '5m': '5 minutes', '15m': '15 minutes', '1h': '1 hour', '4h': '4 hours', '1d': '1 day' };

  function cfg() {
    return {
      symbol: wiz.symbol,
      tf: wiz.tf,
      strategy: wiz.strategy,
      start: $('#w-start').value,
      end: $('#w-end').value,
      balance: +$('#w-balance').value || 100000,
      leverage: +$('#w-leverage').value || 100,
      spread: +$('#w-spread').value || 0,
      commission: +$('#w-commission').value || 0,
      prop: wiz.prop,
    };
  }

  function renderReview() {
    const c = cfg();
    const s = getSymbol(c.symbol);
    const st = getStrategy(c.strategy);
    $('#w-review').innerHTML = `
      <tr><td>Instrument</td><td>${s.sym} — ${s.name}</td></tr>
      <tr><td>Data source</td><td>${s.source === 'binance' ? 'Binance spot klines' : 'Dukascopy archive (BID)'}</td></tr>
      <tr><td>Timeframe</td><td>${TF_LABEL[c.tf] || c.tf}</td></tr>
      <tr><td>Period</td><td>${c.start} → ${c.end}</td></tr>
      <tr><td>Strategy</td><td>${st.name} <span class="tag-lang tag-${st.lang}">${LANG_META[st.lang].tag}</span></td></tr>
      <tr><td>Starting balance</td><td>$${c.balance.toLocaleString()}</td></tr>
      <tr><td>Leverage</td><td>1:${c.leverage}</td></tr>
      <tr><td>Spread</td><td>${c.spread} ${s.cat === 'forex' ? 'pips' : 'points'}</td></tr>
      <tr><td>Commission</td><td>$${c.commission.toFixed(2)} per lot per side</td></tr>
      <tr><td>Prop-firm rules</td><td>${PROP_LABEL[c.prop]}</td></tr>`;
    if (st.rules) {
      $('#w-rules-card').classList.remove('hidden');
      $('#w-rules').innerHTML = `
        <tr><td>Enter long when</td><td style="text-align:left;font-weight:400">${st.rules.entryLong}</td></tr>
        <tr><td>Enter short when</td><td style="text-align:left;font-weight:400">${st.rules.entryShort}</td></tr>
        <tr><td>Exit when</td><td style="text-align:left;font-weight:400">${st.rules.exit}</td></tr>
        <tr><td>Position size</td><td style="text-align:left;font-weight:400">${st.rules.sizing}</td></tr>`;
    } else {
      $('#w-rules-card').classList.add('hidden');
    }
  }

  $('#w-launch').addEventListener('click', () => {
    const c = cfg();
    if (new Date(c.start) >= new Date(c.end)) { toast('Start date must be before the end date', 'err'); return; }
    try { localStorage.setItem('bt_pending', JSON.stringify(c)); } catch (_) {}
    location.href = '/terminal?run=1';
  });

  // ---------------------------------------------------------------- docs
  $('#data-prose').innerHTML = DATA_DOC;
  $('#docs-prose').innerHTML = MANUAL_DOC;

  // Build TOC from h2 headings
  const heads = $$('#docs-prose h2');
  $('#toc').innerHTML = heads.map((h, i) => {
    if (!h.id) h.id = 'sec-' + i;
    return `<a class="toc-link" href="#${h.id}" data-h="${h.id}">${h.textContent}</a>`;
  }).join('');
  $$('#toc .toc-link').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById(a.dataset.h)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  // highlight current section
  if (heads.length && 'IntersectionObserver' in window) {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          $$('#toc .toc-link').forEach(a => a.classList.toggle('active', a.dataset.h === en.target.id));
        }
      });
    }, { rootMargin: '-10% 0px -80% 0px' });
    heads.forEach(h => obs.observe(h));
  }

  // ---------------------------------------------------------------- FAQ
  $('#faq-list').innerHTML = FAQ_ITEMS.map((f, i) => `
    <div class="faq-item" data-i="${i}">
      <button class="faq-q">${f.q}<i class="fa-solid fa-chevron-down"></i></button>
      <div class="faq-a">${f.a}</div>
    </div>`).join('');
  $$('.faq-q').forEach(q => q.addEventListener('click', () => {
    q.parentElement.classList.toggle('open');
  }));

  // ---------------------------------------------------------------- feed status
  async function checkFeeds(verbose) {
    const dot = $('#ds-dot'), txt = $('#ds-text');
    dot.className = 'dot warn'; txt.textContent = 'Checking data feeds…';
    const results = [];
    try {
      const r = await fetch('/api/duka/EURUSD/2024/05/BID_candles_hour_1.bi5');
      results.push(['Dukascopy', r.ok, r.headers.get('X-Duka-Size')]);
    } catch (_) { results.push(['Dukascopy', false, null]); }
    try {
      const r = await fetch('/api/binance/klines?symbol=BTCUSDT&interval=1h&limit=2');
      results.push(['Binance', r.ok, null]);
    } catch (_) { results.push(['Binance', false, null]); }

    const okCount = results.filter(r => r[1]).length;
    dot.className = 'dot ' + (okCount === 2 ? 'live' : okCount === 1 ? 'warn' : 'off');
    txt.textContent = okCount === 2 ? 'Both feeds live' : okCount === 1 ? 'One feed unreachable' : 'Feeds unreachable';

    if (verbose) {
      $('#ds-live').textContent = okCount === 2 ? 'Both live' : okCount + ' of 2';
      $('#ds-live-sub').innerHTML = results.map(r =>
        `${r[0]}: <b class="${r[1] ? 't-up' : 't-down'}">${r[1] ? 'OK' : 'fail'}</b>`).join(' · ');
      toast(okCount === 2 ? 'Both data feeds responded correctly' : 'Some feeds did not respond',
        okCount === 2 ? 'ok' : 'warn');
    }
  }
  $('#ds-test').addEventListener('click', () => checkFeeds(true));
  checkFeeds(false);

  // ============================================================ launcher
  // Type any part of a symbol or its name and jump straight to the chart.
  const LC_MAX = 8;
  let lcSel = -1, lcHits = [];

  function lcSearch(q) {
    q = q.trim().toUpperCase();
    if (!q) return [];
    const exact = [], starts = [], contains = [];
    for (const s of SYMBOLS) {
      const sym = s.sym.toUpperCase();
      const name = (s.name || '').toUpperCase();
      if (sym === q) exact.push(s);
      else if (sym.startsWith(q)) starts.push(s);
      else if (sym.includes(q) || name.includes(q)) contains.push(s);
    }
    return exact.concat(starts, contains).slice(0, LC_MAX);
  }

  function lcRender() {
    const box = $('#lc-results');
    if (!box) return;
    if (!lcHits.length) {
      const q = $('#lc-input').value.trim();
      if (!q) { box.classList.remove('open'); box.innerHTML = ''; return; }
      box.classList.add('open');
      box.innerHTML = '<div class="lc-empty">No instrument matches “' + esc(q) + '”.</div>';
      return;
    }
    box.classList.add('open');
    box.innerHTML = lcHits.map((s, i) => `
      <button class="lc-row${i === lcSel ? ' sel' : ''}" data-lc="${s.sym}">
        <i class="fa-solid ${CAT_ICON[s.cat] || 'fa-chart-line'}" style="color:var(--brand);width:15px"></i>
        <b>${s.sym}</b>
        <span>${esc(s.name || '')}</span>
        <span class="pill">${CAT_LABEL[s.cat] || s.cat}</span>
      </button>`).join('');
    $$('#lc-results .lc-row').forEach(r =>
      r.addEventListener('click', () => lcOpen(r.dataset.lc)));
  }

  function lcOpen(sym) {
    if (!sym) return;
    location.href = '/terminal?symbol=' + encodeURIComponent(sym);
  }

  const lcInput = $('#lc-input');
  if (lcInput) {
    lcInput.addEventListener('input', () => {
      lcHits = lcSearch(lcInput.value);
      lcSel = lcHits.length ? 0 : -1;
      lcRender();
    });
    lcInput.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); lcSel = Math.min(lcSel + 1, lcHits.length - 1); lcRender(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); lcSel = Math.max(lcSel - 1, 0); lcRender(); }
      else if (e.key === 'Enter') { e.preventDefault(); lcOpen(lcHits[lcSel] && lcHits[lcSel].sym); }
      else if (e.key === 'Escape') { lcInput.value = ''; lcHits = []; lcRender(); lcInput.blur(); }
    });
    $('#lc-go') && $('#lc-go').addEventListener('click', () => {
      const hit = lcHits[lcSel] || lcSearch(lcInput.value)[0];
      if (hit) lcOpen(hit.sym);
      else { toast('Type an instrument name first — for example EURUSD', 'warn'); lcInput.focus(); }
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.launcher') && !e.target.closest('#lc-results')) {
        const box = $('#lc-results'); box && box.classList.remove('open');
      }
    });
    // "/" focuses the launcher, like FXReplay and ChatGPT
    document.addEventListener('keydown', e => {
      if (e.key === '/' && document.activeElement !== lcInput &&
          !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        e.preventDefault(); lcInput.focus();
      }
    });
  }

  // ============================================================ coverage
  function renderCoverage() {
    const host = $('#cov-grid');
    if (!host) return;
    const cats = Object.keys(SYMBOLS_BY_CAT);
    const max = Math.max(...cats.map(c => SYMBOLS_BY_CAT[c].length));
    const SUB = {
      forex: 'Majors, crosses and exotics — Dukascopy tick archive',
      indices: 'Cash index CFDs — Dukascopy',
      commodities: 'Metals and energy — Dukascopy',
      stocks: 'US single names — Dukascopy',
      crypto: 'Spot pairs — Binance public API',
    };
    host.innerHTML = cats.map(c => {
      const n = SYMBOLS_BY_CAT[c].length;
      return `<button class="cov" data-cov="${c}">
        <div class="cov-top">
          <b><i class="fa-solid ${CAT_ICON[c] || 'fa-chart-line'}"></i> ${CAT_LABEL[c] || c}</b>
          <span class="cov-n">${n}</span>
        </div>
        <div class="cov-track"><div class="cov-fill" style="width:${Math.round(n / max * 100)}%"></div></div>
        <div class="cov-sub">${SUB[c] || ''}</div>
      </button>`;
    }).join('');
    $$('#cov-grid .cov').forEach(b => b.addEventListener('click', () => {
      show('markets');
      const chip = $(`#mk-filters .chip[data-cat="${b.dataset.cov}"]`);
      chip && chip.click();
    }));
    // #stat-syms stays "~1,500" (full Dukascopy catalog) — do not overwrite
    // with the curated-list length.
  }
  renderCoverage();

  // ============================================================ news
  let hScope = 'upcoming';

  function relTime(sec) {
    const d = sec - Math.floor(Date.now() / 1000);
    const a = Math.abs(d), suffix = d >= 0 ? '' : ' ago';
    if (a < 3600) return (d >= 0 ? 'in ' : '') + Math.max(1, Math.round(a / 60)) + 'm' + suffix;
    if (a < 86400) return (d >= 0 ? 'in ' : '') + Math.round(a / 3600) + 'h' + suffix;
    return (d >= 0 ? 'in ' : '') + Math.round(a / 86400) + 'd' + suffix;
  }

  function nsCard(e) {
    const d = new Date(e.t * 1000);
    const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const val = (lbl, v, cls) => v
      ? `<div><em>${lbl}</em><b class="${cls || ''}">${esc(v)}</b></div>` : '';
    const tone = e.tone === 'better' ? 't-up' : e.tone === 'worse' ? 't-down' : '';
    return `<div class="ns-card i-${e.impact}">
      <div class="ns-bar"></div>
      <div class="ns-when">${time}<small>${day} · ${relTime(e.t)}</small></div>
      <div class="ns-cur">${esc(e.cur || '—')}</div>
      <div class="ns-title">${esc(e.title)}</div>
      <div class="ns-vals">
        ${val('Actual', e.actual, tone)}
        ${val('Forecast', e.forecast)}
        ${val('Previous', e.previous)}
        ${!e.actual && !e.forecast && !e.previous ? '<div><em>&nbsp;</em><b style="color:var(--t-4)">no figures</b></div>' : ''}
      </div>
    </div>`;
  }

  async function renderHomeNews() {
    const host = $('#news-home');
    if (!host || typeof NewsStore === 'undefined') return;
    host.innerHTML = '<div class="ns-empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading the economic calendar…</div>';
    try {
      const raw = hScope === 'upcoming'
        ? await NewsStore.upcoming(21)
        : await NewsStore.recent(10);
      const ev = NewsStore.filter(raw, { impacts: ['high', 'medium'] }).slice(0, 12);
      if (!ev.length) {
        host.innerHTML = `<div class="ns-empty">No high or medium impact releases ${hScope === 'upcoming' ? 'scheduled in the next three weeks' : 'in the last ten days'}.</div>`;
        return;
      }
      host.innerHTML = ev.map(nsCard).join('');
    } catch (err) {
      host.innerHTML = `<div class="ns-empty">
        <i class="fa-solid fa-triangle-exclamation" style="color:var(--warn)"></i>
        The economic calendar is not reachable right now. Backtests still run — news markers are simply omitted.
      </div>`;
    }
  }
  $$('#news-home-scope .chip').forEach(c => c.addEventListener('click', () => {
    $$('#news-home-scope .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    hScope = c.dataset.hscope;
    renderHomeNews();
  }));
  renderHomeNews();

  // ---------------------------------------------------------------- boot
  const hash = location.hash.slice(1);
  if (hash && $(`.page[data-page="${hash}"]`)) show(hash);
})();
