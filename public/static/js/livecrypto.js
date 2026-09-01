// ===========================================================================
// Live crypto panels: order book, whales, delta.
//
// One set of renderers, two densities. The terminal rail is narrow and takes
// the place of the watchlist while a crypto pair is open; the dashboard's Live
// Crypto page gets the same panels with room to breathe. Both read from
// CryptoHub, so however many panels are on screen there is still one set of
// exchange connections behind them.
// ===========================================================================

const LiveCrypto = (() => {
  const $ = (s, r = document) => r.querySelector(s);

  // Grouping ladder, built the way an exchange builds it: start at the pair's
  // own tick and step up 1 / 10 / 100 …, so BTC offers 0.01, 0.1, 1, 10, 50, 100.
  const GROUP_STEPS = [1, 10, 100, 1000, 5000, 10000];

  let group = 'auto';
  let whaleMin = 'auto';
  let deltaWin = 300;          // seconds
  let hosts = {};              // {book, whales, delta}
  let density = 'rail';
  let unsub = null;

  // ---- formatting -------------------------------------------------------
  function dp(tick) {
    if (tick >= 1) return 0;
    return Math.min(8, Math.max(0, Math.round(-Math.log10(tick))));
  }
  const fmtP = (x, d) => Number(x).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  function fmtQ(q) {
    if (q >= 10000) return (q / 1000).toFixed(1) + 'k';
    if (q >= 1) return q.toFixed(3);
    return q.toFixed(4);
  }
  function fmtN(n) {
    const a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(0) + 'k';
    return s + '$' + a.toFixed(0);
  }
  const clock = (t) => new Date(t).toTimeString().slice(0, 8);
  const venueOf = (id) => Exchanges.VENUES.find(v => v.id === id) || { label: id, color: '#888' };

  function baseTick() {
    const info = window.findSymbol ? findSymbol(CryptoHub.symbol || '') : null;
    return (info && info.pip) || 0.01;
  }
  function groupOptions() {
    const b = baseTick();
    return GROUP_STEPS.map(m => +(b * m).toPrecision(8));
  }
  function activeTick() {
    if (group !== 'auto') return parseFloat(group);
    const f = CryptoHub.feed;
    const live = f && f.liveBooks()[0];
    return Exchanges.autoTick(live ? live.bestBid : 1000);
  }

  // ---- order book -------------------------------------------------------
  function renderBook(host) {
    const feed = CryptoHub.feed;
    if (!feed) { host.innerHTML = idle('Order book'); return; }

    const tick = activeTick();
    const depth = density === 'rail' ? 9 : 16;
    const c = feed.consolidate({ tick, depth, ...CryptoHub.view() });
    if (!c) { host.innerHTML = idle('Order book'); return; }

    const d = dp(tick);
    // Cumulative size from the touch outwards — the "Sum" column, and the bar
    // behind each row. Reading it tells you what a market order would eat.
    const cum = (rows) => { let s = 0; return rows.map(r => ({ ...r, sum: (s += r.qty) })); };
    const bids = cum(c.bids), asks = cum(c.asks);
    const maxSum = Math.max(bids.length ? bids[bids.length - 1].sum : 0,
                            asks.length ? asks[asks.length - 1].sum : 0) || 1;

    const row = (l, side) => {
      const w = Math.min(100, l.sum / maxSum * 100);
      const who = Object.entries(l.by).sort((a, b) => b[1] - a[1])
        .map(([id, q]) => `${venueOf(id).label} ${fmtQ(q)}`).join(' · ');
      return `<div class="lb-row lb-${side}" title="${who}">
        <span class="lb-fill" style="width:${w.toFixed(1)}%"></span>
        <span class="lb-p">${fmtP(l.price, d)}</span>
        <span class="lb-q">${fmtQ(l.qty)}</span>
        <span class="lb-s">${fmtQ(l.sum)}</span>
      </div>`;
    };

    const opts = groupOptions()
      .map(v => `<option value="${v}" ${String(v) === group ? 'selected' : ''}>${v >= 1 ? v.toLocaleString() : v}</option>`)
      .join('');

    const spreadBps = c.mid && c.spread != null ? Math.abs(c.spread / c.mid) * 10000 : null;

    host.innerHTML =
      `<div class="lb-tools">
         <select class="lb-group" data-role="group">
           <option value="auto" ${group === 'auto' ? 'selected' : ''}>Auto</option>${opts}
         </select>
         <span class="lb-venues">${c.venues.length} venues</span>
       </div>
       <div class="lb-cols"><span>Price</span><span>Size</span><span>Sum</span></div>
       <div class="lb-side">${asks.slice().reverse().map(l => row(l, 'ask')).join('')}</div>
       <div class="lb-mid ${c.crossed ? 'crossed' : ''}">
         <b>${c.mid != null ? fmtP(c.mid, d) : '—'}</b>
         <small>${c.crossed ? 'crossed ' : ''}${spreadBps != null ? spreadBps.toFixed(spreadBps < 1 ? 2 : 1) + ' bps' : ''}</small>
       </div>
       <div class="lb-side">${bids.map(l => row(l, 'bid')).join('')}</div>`;

    const sel = host.querySelector('[data-role=group]');
    if (sel) sel.onchange = (e) => { group = e.target.value; };
  }

  // ---- whales -----------------------------------------------------------
  function renderWhales(host) {
    const tape = CryptoHub.tape;
    if (!tape) { host.innerHTML = idle('Whales'); return; }
    if (tape.whaleMin !== whaleMin) tape.setWhaleMin(whaleMin);
    const eff = tape.effectiveMin;

    const flow = tape.whaleFlow(900);
    const walls = Tape.Feed.walls(
      CryptoHub.feed && CryptoHub.feed.consolidate({ tick: activeTick(), depth: 22, ...CryptoHub.view() }),
      whaleMin);

    const lean = flow.total > 0
      ? (flow.ratio > 0.15 ? ['accumulating', 'up'] :
         flow.ratio < -0.15 ? ['distributing', 'down'] : ['two-way', 'flat'])
      : ['quiet', 'flat'];

    const list = tape.bigSweeps(density === 'rail' ? 9 : 22);
    const rows = list.length ? list.map(w => {
      const v = venueOf(w.venueId);
      const moved = Math.abs(w.priceTo - w.priceFrom);
      const detail = `${v.label} · ${w.prints} print${w.prints === 1 ? '' : 's'}` +
        (moved > 0 ? ` · moved ${moved.toPrecision(3)}` : '');
      return `<div class="wh-row wh-${w.side}" title="${detail}">
        <span class="wh-dot" style="background:${v.color}"></span>
        <span class="wh-time">${clock(w.t)}</span>
        <span class="wh-side">${w.side === 'buy' ? 'BUY' : 'SELL'}</span>
        <span class="wh-qty">${fmtQ(w.qty)}<em>&times;${w.prints}</em></span>
        <span class="wh-not">${fmtN(w.notional)}</span>
      </div>`;
    }).join('') : `<div class="wh-none">${eff ? `Nothing above ${fmtN(eff)} yet.` : 'Listening to the tape…'}
      Size arrives in bursts, not evenly.</div>`;

    const wallRows = walls.length ? walls.slice(0, density === 'rail' ? 3 : 6).map(w => {
      return `<div class="wh-wall wh-${w.side === 'bid' ? 'buy' : 'sell'}">
        <span class="wh-side">${w.side === 'bid' ? 'BID WALL' : 'ASK WALL'}</span>
        <span class="wh-qty">${fmtQ(w.qty)}</span>
        <span class="wh-not">${fmtN(w.notional)}</span>
      </div>`;
    }).join('') : '';

    const thresholds = [10000, 25000, 50000, 100000, 250000, 1000000];

    host.innerHTML =
      `<div class="wh-tools">
         <select class="lb-group" data-role="whalemin">
           <option value="auto" ${whaleMin === 'auto' ? 'selected' : ''}>Auto${eff ? ' &ge; ' + fmtN(eff) : ''}</option>
           ${thresholds.map(t => `<option value="${t}" ${t === whaleMin ? 'selected' : ''}>&ge; ${fmtN(t)}</option>`).join('')}
         </select>
         <span class="wh-lean t-${lean[1]}">${lean[0]}</span>
       </div>
       <div class="wh-flow">
         <div class="wh-fbar">
           <i class="buy" style="width:${flow.total ? (flow.buy / flow.total * 100).toFixed(1) : 50}%"></i>
           <i class="sell" style="width:${flow.total ? (flow.sell / flow.total * 100).toFixed(1) : 50}%"></i>
         </div>
         <div class="wh-fnums">
           <span class="t-up">${fmtN(flow.buy)} bought</span>
           <span class="t-down">${fmtN(flow.sell)} sold</span>
         </div>
         <div class="wh-fnet">Net <b class="${flow.delta >= 0 ? 't-up' : 't-down'}">${fmtN(flow.delta)}</b>
           <small>${flow.buys}&nbsp;buys / ${flow.sells}&nbsp;sells &middot; last 15m</small></div>
       </div>
       ${wallRows ? `<div class="wh-sec">Resting walls</div>${wallRows}` : ''}
       <div class="wh-sec">Aggressive sweeps</div>
       <div class="wh-list">${rows}</div>`;

    const sel = host.querySelector('[data-role=whalemin]');
    if (sel) sel.onchange = (e) => { whaleMin = e.target.value === 'auto' ? 'auto' : +e.target.value; };
  }

  // ---- delta ------------------------------------------------------------
  function renderDelta(host) {
    const tape = CryptoHub.tape;
    if (!tape) { host.innerHTML = idle('Delta'); return; }

    const w = tape.window(deltaWin);
    const pts = tape.cvdPoints;

    // Sparkline of cumulative delta since the feed connected.
    let spark = '';
    if (pts.length > 1) {
      // Downsampled: a 900-point path rebuilt on every repaint is a lot of
      // string for a line 100 units wide, and nothing under a pixel shows.
      const STEP = Math.max(1, Math.ceil(pts.length / 120));
      const use = [];
      for (let i = 0; i < pts.length; i += STEP) use.push(pts[i]);
      if (use[use.length - 1] !== pts[pts.length - 1]) use.push(pts[pts.length - 1]);

      let lo = 0, hi = 0;
      for (const p of use) { if (p.cvd < lo) lo = p.cvd; if (p.cvd > hi) hi = p.cvd; }
      const span = (hi - lo) || 1;
      const W = 100, H = 30;
      const d = use.map((p, i) => {
        const x = (i / (use.length - 1)) * W;
        const y = H - ((p.cvd - lo) / span) * H;
        return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
      }).join(' ');
      const zeroY = H - ((0 - lo) / span) * H;
      const up = tape.cvd >= 0;
      spark =
        `<svg class="dl-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
           <line x1="0" y1="${zeroY.toFixed(2)}" x2="${W}" y2="${zeroY.toFixed(2)}"
                 stroke="currentColor" stroke-opacity=".22" stroke-width=".5"/>
           <path d="${d}" fill="none" stroke="${up ? 'var(--up)' : 'var(--down)'}"
                 stroke-width="1.4" vector-effect="non-scaling-stroke"/>
         </svg>`;
    }

    const wins = [[60, '1m'], [300, '5m'], [900, '15m']];
    const pct = w.total ? (w.buy / w.total * 100) : 50;

    host.innerHTML =
      `<div class="dl-tools">
         <div class="seg seg-xs" data-role="dwin">
           ${wins.map(([s, l]) => `<button class="${s === deltaWin ? 'active' : ''}" data-w="${s}">${l}</button>`).join('')}
         </div>
       </div>
       <div class="dl-main">
         <span class="dl-lab">Delta &middot; ${wins.find(x => x[0] === deltaWin)[1]}</span>
         <b class="dl-val ${w.delta >= 0 ? 't-up' : 't-down'}">${fmtN(w.delta)}</b>
         <span class="dl-sub">${w.prints.toLocaleString()} prints &middot; ${fmtN(w.total)} traded</span>
       </div>
       <div class="dl-bar"><i class="buy" style="width:${pct.toFixed(1)}%"></i><i class="sell" style="width:${(100 - pct).toFixed(1)}%"></i></div>
       <div class="dl-split"><span class="t-up">${fmtN(w.buy)}</span><span class="t-down">${fmtN(w.sell)}</span></div>
       <div class="dl-cvd">
         <span class="dl-lab">Cumulative delta since connect</span>
         <b class="${tape.cvd >= 0 ? 't-up' : 't-down'}">${fmtN(tape.cvd)}</b>
         ${spark}
       </div>`;

    const seg = host.querySelector('[data-role=dwin]');
    if (seg) seg.onclick = (e) => {
      const b = e.target.closest('button');
      if (b) deltaWin = +b.dataset.w;
    };
  }

  function idle(what) {
    const sym = CryptoHub.symbol || (window.App ? App.currentSymbol : '');
    if (sym && !CryptoHub.isCrypto(sym)) {
      return `<div class="lc-idle">${what} is a crypto feed. ${sym} comes from Dukascopy,
              which publishes top of book only.</div>`;
    }
    return `<div class="lc-idle">Connecting to exchanges…</div>`;
  }

  // ---- venue chips (shared) --------------------------------------------
  function renderVenues(host) {
    host.innerHTML = Exchanges.VENUES.map(v => {
      const on = CryptoHub.venueEnabled(v.id);
      const live = CryptoHub.feed && CryptoHub.feed.liveBooks().some(b => b.venue.id === v.id);
      return `<button class="lc-chip ${on ? '' : 'off'} ${live ? 'live' : ''}"
                data-venue="${v.id}" style="--vc:${v.color}"
                data-tip="${v.label} — quotes in ${v.quote}">
                <span class="cb-dot"></span>${v.label}</button>`;
    }).join('');
    host.onclick = (e) => {
      const c = e.target.closest('.lc-chip');
      if (!c) return;
      CryptoHub.setVenueEnabled(c.dataset.venue, !CryptoHub.venueEnabled(c.dataset.venue));
      renderVenues(host);
    };
  }

  // ---- mount ------------------------------------------------------------
  /**
   * Attach panels. `map` names the hosts to paint into; any subset is fine.
   * Re-mounting replaces the previous attachment rather than stacking.
   */
  function mount(map, opts = {}) {
    unmount();
    hosts = map;
    density = opts.density || 'rail';
    if (opts.whaleMin) whaleMin = opts.whaleMin;

    CryptoHub.acquire('livecrypto', opts.symbol);
    if (hosts.venues) renderVenues(hosts.venues);

    unsub = CryptoHub.onFrame(paint);
    paint();
  }

  // The ladder is the only panel that rewards a fast repaint; whales and delta
  // are read, not watched, and rebuilding their markup eleven times a second
  // costs far more than it shows.
  let lastSlow = 0;
  const SLOW_MS = 400;

  function paint() {
    if (hosts.book) renderBook(hosts.book);
    const now = performance.now();
    if (now - lastSlow < SLOW_MS) return;
    lastSlow = now;
    if (hosts.whales) renderWhales(hosts.whales);
    if (hosts.delta) renderDelta(hosts.delta);
  }

  function unmount() {
    if (unsub) { unsub(); unsub = null; }
    if (Object.keys(hosts).length) CryptoHub.release('livecrypto');
    hosts = {};
  }

  return { mount, unmount, paint, renderVenues, get density() { return density; } };
})();

window.LiveCrypto = LiveCrypto;
