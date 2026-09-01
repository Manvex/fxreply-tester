// ===========================================================================
// Crypto hub — one set of exchange connections, shared by every panel.
//
// The consolidated book, the rail, the whale list and the delta readout all
// want the same live data. Without a single owner each of them would open its
// own five book sockets and five trade sockets for the same pair, which is
// both wasteful and a good way to get rate-limited.
//
// Consumers acquire the hub by name and release it when they go away; the
// sockets open on the first consumer and close after the last one leaves.
// ===========================================================================

const CryptoHub = (() => {
  let feed = null;          // Exchanges.Feed  — order books
  let tape = null;          // Tape.Feed       — trade prints
  let symbol = null;
  const consumers = new Set();
  const listeners = new Set();
  // A timer, not requestAnimationFrame. rAF is suspended whenever the document
  // is hidden, which would freeze every panel the moment the tab goes to the
  // background — and in some embedded views it never fires at all. The sockets
  // keep delivering either way, so the repaint should too.
  let timer = null;
  const PAINT_MS = 90;

  let disabled = new Set(); // venue ids switched off by the user
  // Spot and perpetuals are different instruments trading at different prices,
  // so a consolidated book only makes sense within one of them. The choice is
  // shared: every panel reads the same market rather than each picking its own.
  let market = 'spot';      // spot | perp | all
  let quote = 'USDT';       // USDT | USD | all
  const LS_KEY = 'bt_hub_venues';
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (Array.isArray(saved)) disabled = new Set(saved);
  } catch (_e) {}

  function enabledIds() {
    return Exchanges.VENUES.map(v => v.id).filter(id => !disabled.has(id));
  }

  function isCrypto(sym) {
    const info = window.findSymbol ? findSymbol(sym) : null;
    return !!info && info.source === 'binance';
  }

  function open() {
    close(true);
    if (!symbol || !isCrypto(symbol)) return;
    const ids = enabledIds();
    feed = new Exchanges.Feed(symbol, ids).start();
    // The 20-level stream is too narrow to show where liquidity really sits;
    // the deep REST snapshot widens it to about a percent either side.
    feed.startDeep(4000);
    tape = new Tape.Feed(symbol, ids).start();
    if (!timer) timer = setInterval(paint, PAINT_MS);
  }

  function close(quiet) {
    if (feed) { feed.close(); feed = null; }
    if (tape) { tape.close(); tape = null; }
    if (!quiet) stopPainting();
  }

  function stopPainting() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function paint() {
    for (const fn of listeners) {
      try { fn(); } catch (e) { console.warn('[hub] listener failed', e); }
    }
  }

  /** Start (or join) the hub. Returns false when the symbol has no crypto feed. */
  function acquire(name, sym) {
    consumers.add(name);
    const target = sym || (window.App ? App.currentSymbol : null);
    if (target && target !== symbol) { symbol = target; open(); }
    else if (!feed && symbol) open();
    return !!feed;
  }

  function release(name) {
    consumers.delete(name);
    if (!consumers.size) close();
  }

  function setSymbol(sym) {
    if (sym === symbol) return;
    symbol = sym;
    if (consumers.size) open();
  }

  function onFrame(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function setVenueEnabled(id, on) {
    if (on) disabled.delete(id); else disabled.add(id);
    try { localStorage.setItem(LS_KEY, JSON.stringify([...disabled])); } catch (_e) {}
    if (consumers.size) open();
  }

  function venueEnabled(id) { return !disabled.has(id); }

  function setMarket(m) {
    market = m;
    // Perps are quoted in USDT only, so a USD filter would empty the book.
    if (m === 'perp' && quote === 'USD') quote = 'USDT';
    try { localStorage.setItem('bt_hub_market', m); } catch (_e) {}
  }
  function setQuote(q) {
    quote = q;
    try { localStorage.setItem('bt_hub_quote', q); } catch (_e) {}
  }
  try {
    market = localStorage.getItem('bt_hub_market') || market;
    quote = localStorage.getItem('bt_hub_quote') || quote;
  } catch (_e) {}

  /** The filter every panel should pass to consolidate(). */
  function view() { return { quote, kind: market }; }

  return {
    acquire, release, setSymbol, onFrame, setVenueEnabled, venueEnabled, isCrypto,
    setMarket, setQuote, view,
    get market() { return market; },
    get quote() { return quote; },
    get feed() { return feed; },
    get tape() { return tape; },
    get symbol() { return symbol; },
    get active() { return !!feed; },
  };
})();

window.CryptoHub = CryptoHub;
