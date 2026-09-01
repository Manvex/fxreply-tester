// ===========================================================================
// Consolidated order book panel.
//
// Streams the live book from every major venue at once and merges them into a
// single ladder, so you see the market rather than one exchange's view of it.
// Each price row shows who is resting the size, the header shows where the true
// best bid and offer sit, and a crossed consolidated book — one venue bidding
// above another's offer — is called out when it happens.
//
// Live only. No venue archives per-level book state, so none of this feeds a
// backtest; the Microstructure tab covers what history can actually support.
// ===========================================================================

const ConsolidatedBook = (() => {
  const $ = (s) => document.querySelector(s);

  // The books come from CryptoHub, which the rail and the dashboard also read.
  // This panel used to open its own five sockets on top of theirs — the same
  // data, twice, with a second paint loop driving it.
  let running = false;
  let quote = 'USDT';
  let tickMode = 'auto';
  let unsub = null;

  const DEPTH = 13;
  const feedOf = () => CryptoHub.feed;

  // ---- formatting -------------------------------------------------------
  function fmtPrice(x, dg) {
    return Number(x).toLocaleString(undefined, { minimumFractionDigits: dg, maximumFractionDigits: dg });
  }
  function fmtQty(q) {
    if (q >= 1000) return (q / 1000).toFixed(1) + 'k';
    if (q >= 1) return q.toFixed(3);
    return q.toFixed(4);
  }
  function fmtUsd(n) {
    const a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'k';
    return '$' + n.toFixed(0);
  }
  function digitsFor(tick) {
    if (tick >= 1) return 0;
    return Math.min(8, Math.max(0, Math.ceil(-Math.log10(tick))));
  }

  // ---- venue chips ------------------------------------------------------
  function renderVenueChips() {
    const host = $('#cb-venues');
    if (!host) return;
    host.innerHTML = Exchanges.VENUES.map(v => {
      const off = !CryptoHub.venueEnabled(v.id);
      return `<button class="cb-chip ${off ? 'off' : ''}" data-venue="${v.id}"
                style="--vc:${v.color}" data-tip="${v.label} · quotes in ${v.quote}">
                <span class="cb-dot"></span>${v.label}
                <span class="cb-chip-q">${v.quote}</span>
              </button>`;
    }).join('');
  }

  function renderStatus() {
    const host = $('#cb-status');
    if (!host) return;
    const feed = feedOf();
    if (!feed) {
      host.innerHTML = '<span class="cb-idle">Not connected.</span>';
      return;
    }
    const h = feed.health();
    $('#cnt-venues') && ($('#cnt-venues').textContent =
      String(h.filter(x => x.status === 'live').length));

    host.innerHTML = h.map(x => {
      const cls = x.status === 'live' ? 'ok' : x.status === 'connecting' ? 'wait' : 'bad';
      const detail = x.status === 'live'
        ? `${x.levels} levels`
        : (x.status === 'stale' ? 'no data' : x.status);
      return `<span class="cb-hs ${cls}" style="--vc:${x.venue.color}">
                <span class="cb-dot"></span>${x.venue.label}
                <small>${detail}</small></span>`;
    }).join('');
  }

  // ---- the ladder -------------------------------------------------------
  function renderBook() {
    const host = $('#cb-body');
    if (!host) return;
    const feed = feedOf();
    if (!feed) {
      host.innerHTML =
        `<div class="cb-empty">
           <h4>See the whole market, not one exchange</h4>
           <p>Connects to Binance, Bybit, OKX, Kraken and Coinbase at once and merges
              their live books into a single ladder. Every row shows which venues are
              resting the size, and the header shows where the real best bid and offer
              are — often on different exchanges.</p>
           <p class="t-faint">Live only. No venue publishes historical per-level book
              state, so this cannot feed a backtest. What history does support is in the
              <b>Microstructure</b> tab of a backtest report.</p>
         </div>`;
      return;
    }

    const sym = window.App ? window.App.currentSymbol : 'BTCUSDT';
    const info = window.findSymbol ? findSymbol(sym) : null;
    if (!info || info.source !== 'binance') {
      host.innerHTML =
        `<div class="cb-empty">
           <h4>${sym} is not a crypto pair</h4>
           <p>Consolidated depth is built from crypto exchange feeds. Forex, indices,
              commodities and share CFDs come from Dukascopy, which publishes top of
              book only — there is no per-level ladder to merge.</p>
           <p class="t-faint">Switch to a crypto symbol to use this panel.</p>
         </div>`;
      return;
    }

    const anyLive = feed.liveBooks();
    if (!anyLive.length) {
      host.innerHTML = '<div class="cb-empty"><h4>Waiting for the first book…</h4>' +
        '<p class="t-faint">Venues connect independently; the ladder appears as soon as one arrives.</p></div>';
      return;
    }

    const refBook = anyLive[0];
    const refPrice = refBook.bestBid || 1000;
    fillTicks(refPrice);
    const tick = tickMode === 'auto' ? Exchanges.autoTick(refPrice) : parseFloat(tickMode);
    const c = feed.consolidate({ tick, depth: DEPTH, quote, kind: CryptoHub.market });

    if (!c) {
      host.innerHTML = '<div class="cb-empty"><h4>No venues in this currency</h4>' +
        '<p class="t-faint">Switch the currency filter, or re-enable a venue above.</p></div>';
      return;
    }

    const dg = digitsFor(tick);
    const peak = Math.max(...c.bids.map(l => l.qty), ...c.asks.map(l => l.qty), 0) || 1;

    // Each row's bar is split into per-venue segments, so you can see at a
    // glance that a wall is one exchange rather than the market as a whole.
    const row = (lvl, side) => {
      const total = lvl.qty;
      const w = Math.min(100, total / peak * 100);
      const segs = Object.entries(lvl.by)
        .sort((a, b) => b[1] - a[1])
        .map(([id, q]) => {
          const v = Exchanges.VENUES.find(x => x.id === id);
          return `<i style="width:${(q / total * 100).toFixed(2)}%;background:${v ? v.color : '#888'}"></i>`;
        }).join('');
      const names = Object.entries(lvl.by).sort((a, b) => b[1] - a[1])
        .map(([id, q]) => {
          const v = Exchanges.VENUES.find(x => x.id === id);
          return `${v ? v.label : id} ${fmtQty(q)}`;
        }).join(' · ');
      return `<div class="cb-row cb-${side}" title="${names}">
        <span class="cb-barwrap" style="width:${w.toFixed(1)}%">${segs}</span>
        <span class="cb-price">${fmtPrice(lvl.price, dg)}</span>
        <span class="cb-qty">${fmtQty(total)}</span>
        <span class="cb-val">${fmtUsd(total * lvl.price)}</span>
      </div>`;
    };

    const bidV = c.bestBidVenue, askV = c.bestAskVenue;
    const spreadBps = c.mid && c.spread != null ? (c.spread / c.mid) * 10000 : null;

    const crossNote = c.crossed
      ? `<div class="cb-cross"><i class="fa-solid fa-bolt"></i>
           <b>Crossed book</b> — ${bidV ? bidV.label : '?'} is bidding
           ${fmtPrice(c.bestBid, dg)} while ${askV ? askV.label : '?'} offers
           ${fmtPrice(c.bestAsk, dg)}. Real, and usually gone before you could touch it.</div>`
      : '';

    host.innerHTML =
      `<div class="cb-head">
         <div class="cb-bbo">
           <span class="cb-bbo-lab">Best bid</span>
           <b class="t-up">${fmtPrice(c.bestBid, dg)}</b>
           <small style="--vc:${bidV ? bidV.color : '#888'}"><span class="cb-dot"></span>${bidV ? bidV.label : '—'}</small>
         </div>
         <div class="cb-bbo cb-spread">
           <span class="cb-bbo-lab">${c.crossed ? 'Crossed by' : 'Spread'}</span>
           <b class="${c.crossed ? 't-warn' : ''}">${c.spread != null ? fmtPrice(Math.abs(c.spread), dg + 2) : '—'}</b>
           <small>${spreadBps != null ? Math.abs(spreadBps).toFixed(Math.abs(spreadBps) < 1 ? 3 : 2) + ' bps' : ''}</small>
         </div>
         <div class="cb-bbo">
           <span class="cb-bbo-lab">Best offer</span>
           <b class="t-down">${fmtPrice(c.bestAsk, dg)}</b>
           <small style="--vc:${askV ? askV.color : '#888'}"><span class="cb-dot"></span>${askV ? askV.label : '—'}</small>
         </div>
         <div class="cb-bbo">
           <span class="cb-bbo-lab">Resting bid / offer</span>
           <b>${fmtUsd(c.notionalBid)} / ${fmtUsd(c.notionalAsk)}</b>
           <small class="${c.imbalance >= 0 ? 't-up' : 't-down'}">
             ${(c.imbalance * 100).toFixed(0)}% imbalance</small>
         </div>
         <div class="cb-bbo">
           <span class="cb-bbo-lab">Grouping</span>
           <b>${fmtPrice(tick, dg)}</b>
           <small>${c.venues.length} venue${c.venues.length === 1 ? '' : 's'} merged</small>
         </div>
       </div>
       ${crossNote}
       <div class="cb-ladder">
         <div class="cb-cols"><span></span><span>Price</span><span>Size</span><span>Value</span></div>
         <div class="cb-side">${c.asks.slice().reverse().map(l => row(l, 'ask')).join('')}</div>
         <div class="cb-mid">
           <span>${c.mid != null ? fmtPrice(c.mid, dg) : '—'}</span>
           <small>consolidated mid across ${c.venues.map(v => v.label).join(', ')}</small>
         </div>
         <div class="cb-side">${c.bids.map(l => row(l, 'bid')).join('')}</div>
       </div>`;
  }

  // ---- control ----------------------------------------------------------
  function paint() { renderBook(); renderStatus(); }

  function start() {
    if (window.App) CryptoHub.setSymbol(App.currentSymbol);
    CryptoHub.acquire('cbook');
    running = true;
    if (!unsub) unsub = CryptoHub.onFrame(paint);
    syncButton();
    paint();
  }

  function stop(quiet) {
    running = false;
    if (unsub) { unsub(); unsub = null; }
    CryptoHub.release('cbook');
    if (!quiet) { syncButton(); renderBook(); renderStatus(); }
  }

  function syncButton() {
    const b = $('#cb-toggle');
    if (!b) return;
    b.innerHTML = running
      ? '<i class="fa-solid fa-stop"></i> Disconnect'
      : '<i class="fa-solid fa-play"></i> Connect';
    b.classList.toggle('btn-primary', !running);
  }

  // ---- wiring -----------------------------------------------------------
  function init() {
    if (!$('#cb-body')) return;
    renderVenueChips();
    renderBook();
    renderStatus();
    syncButton();

    $('#cb-toggle').addEventListener('click', () => (running ? stop() : start()));

    $('#cb-venues').addEventListener('click', (e) => {
      const chip = e.target.closest('.cb-chip');
      if (!chip) return;
      const id = chip.dataset.venue;
      CryptoHub.setVenueEnabled(id, !CryptoHub.venueEnabled(id));
      renderVenueChips();
    });

    $('#cb-quote').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      quote = b.dataset.quote;
      [...$('#cb-quote').children].forEach(x => x.classList.toggle('active', x === b));
      renderBook();
    });

    // Grouping options depend on the instrument's price, so they are filled in
    // the first time a book arrives rather than hard-coded.
    $('#cb-tick').addEventListener('change', (e) => { tickMode = e.target.value; renderBook(); });

    window.addEventListener('beforeunload', () => stop(true));
  }

  /** Called when the user switches instrument. */
  function onSymbolChange() {
    const sel = $('#cb-tick');
    if (sel) { sel.innerHTML = '<option value="auto" selected>Auto</option>'; tickMode = 'auto'; }
    if (running && window.App) CryptoHub.setSymbol(App.currentSymbol);
    renderBook();
  }

  /** Fill the grouping dropdown once we know the price scale. */
  function fillTicks(price) {
    const sel = $('#cb-tick');
    if (!sel || sel.dataset.filled === String(Math.round(price))) return;
    const base = Exchanges.autoTick(price);
    const opts = [base / 2, base, base * 2, base * 5, base * 10, base * 25]
      .filter(t => t > 0)
      .map(t => `<option value="${t}">${t >= 1 ? t.toLocaleString() : t.toPrecision(2)}</option>`)
      .join('');
    sel.innerHTML = '<option value="auto" selected>Auto</option>' + opts;
    sel.value = tickMode;
    sel.dataset.filled = String(Math.round(price));
  }

  return { init, start, stop, onSymbolChange, fillTicks, get running() { return running; } };
})();

window.ConsolidatedBook = ConsolidatedBook;
