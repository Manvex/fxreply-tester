// ===========================================================================
// Exchange order-book adapters.
//
// Five venues, five different wire formats, one normalised book. Every stream
// below is a public endpoint that a browser may open directly — no key, no
// proxy, no CORS problem (WebSockets are not subject to it).
//
//   Binance   depth20@100ms      full snapshot every frame
//   Bybit     orderbook.50       snapshot then deltas, qty "0" removes a level
//   OKX       books5             full 5-level snapshot every frame
//   Kraken    book (v2)          snapshot then updates, qty 0 removes
//   Coinbase  level2             snapshot then updates, quantity 0 removes
//
// A caveat worth stating rather than hiding: Binance, Bybit and OKX quote in
// USDT while Kraken and Coinbase quote in USD. Those are different assets and
// they trade at slightly different prices. Levels from both are shown, tagged
// with their quote currency, and the basis between them is real information —
// but a consolidated "best bid" that mixes them is comparing two things, so the
// UI reports the USD venues separately rather than pretending otherwise.
// ===========================================================================

const Exchanges = (() => {

  // ---- venue registry ---------------------------------------------------
  const VENUES = [
    // `window` is how many levels per side the venue actually publishes. For
    // delta feeds it matters: a level that scrolls out of the window is simply
    // never mentioned again rather than being zeroed, so without trimming the
    // book fills up with stale prices and the best bid/offer drifts away from
    // the real one. Snapshot feeds replace wholesale and need no window.
    // `kind` separates spot from perpetuals. They are different instruments and
    // trade at different prices, so consolidating across them would be quietly
    // comparing two things; the panels filter on it.
    { id: 'binance',  label: 'Binance',  quote: 'USDT', kind: 'spot', color: '#f0b45e', window: 0 },
    { id: 'bybit',    label: 'Bybit',    quote: 'USDT', kind: 'spot', color: '#f7a600', window: 50 },
    { id: 'okx',      label: 'OKX',      quote: 'USDT', kind: 'spot', color: '#7d8cf5', window: 0 },
    { id: 'gate',     label: 'Gate.io',  quote: 'USDT', kind: 'spot', color: '#5ec9a7', window: 0 },
    { id: 'bitget',   label: 'Bitget',   quote: 'USDT', kind: 'spot', color: '#57c3ff', window: 0 },
    { id: 'kraken',   label: 'Kraken',   quote: 'USD',  kind: 'spot', color: '#8b5cf6', window: 25 },
    { id: 'coinbase', label: 'Coinbase', quote: 'USD',  kind: 'spot', color: '#4a8ff5', window: 0 },
    { id: 'bitstamp', label: 'Bitstamp', quote: 'USD',  kind: 'spot', color: '#4ad07a', window: 0 },
    { id: 'bitfinex', label: 'Bitfinex', quote: 'USD',  kind: 'spot', color: '#98c93c', window: 25 },
    // Perpetuals — the market a CFD or futures position actually tracks.
    { id: 'binancef', label: 'Binance Perp', quote: 'USDT', kind: 'perp', color: '#f5d76e', window: 0 },
    { id: 'bybitp',   label: 'Bybit Perp',   quote: 'USDT', kind: 'perp', color: '#ffb454', window: 50 },
    { id: 'okxp',     label: 'OKX Perp',     quote: 'USDT', kind: 'perp', color: '#9aa5ff', window: 0 },
  ];

  /** App symbols are Binance-style (BTCUSDT). Everything else is derived. */
  function baseOf(sym) { return String(sym).replace(/USDT$/i, '').toUpperCase(); }

  const PAIR = {
    binance:  s => s.toUpperCase(),
    bybit:    s => s.toUpperCase(),
    okx:      s => baseOf(s) + '-USDT',
    gate:     s => baseOf(s) + '_USDT',
    bitget:   s => s.toUpperCase(),
    kraken:   s => baseOf(s) + '/USD',
    coinbase: s => baseOf(s) + '-USD',
    bitstamp: s => baseOf(s).toLowerCase() + 'usd',
    bitfinex: s => 't' + baseOf(s) + 'USD',
    binancef: s => s.toUpperCase(),
    bybitp:   s => s.toUpperCase(),
    okxp:     s => baseOf(s) + '-USDT-SWAP',
  };

  /**
   * OKX quotes swap size in contracts, not coins.
   *
   * For the USDT-margined swaps this app touches, one contract is a fixed
   * fraction of the base asset — 0.01 BTC, 0.1 ETH, and so on. Leaving the raw
   * figure in would put OKX's perp book orders of magnitude above everyone
   * else's and quietly wreck the consolidated depth.
   */
  const OKX_CT = { BTC: 0.01, ETH: 0.1, SOL: 1, XRP: 100, DOGE: 1000, LTC: 1, BNB: 0.1,
                   ADA: 100, AVAX: 1, LINK: 1, DOT: 1, TRX: 1000, SUI: 1, UNI: 1 };
  const okxCt = (sym) => OKX_CT[baseOf(sym)] || 1;

  // ---- a single venue's book -------------------------------------------
  // Levels live in a Map<price, qty>. Snapshot replaces, delta merges, a zero
  // quantity deletes. Sorting happens only when the book is read.
  class VenueBook {
    constructor(venue) {
      this.venue = venue;
      this.bids = new Map();
      this.asks = new Map();
      // A separate, much deeper snapshot for venues that expose one over REST.
      // The websocket book stays authoritative for the touch; this only widens
      // the picture for anything that wants to see past the top few levels.
      this.deepBids = null;
      this.deepAsks = null;
      this.deepAt = 0;
      this.status = 'idle';     // idle | connecting | live | error | closed
      this.lastMsg = 0;
      this.error = null;
      this.ws = null;
      this.retries = 0;
      this.timer = null;
      this.closing = false;
    }

    applySnapshot(bids, asks) {
      this.bids = new Map(bids);
      this.asks = new Map(asks);
      this.trim();
      this.mark();
    }

    applyDelta(bids, asks) {
      for (const [p, q] of bids) { if (q > 0) this.bids.set(p, q); else this.bids.delete(p); }
      for (const [p, q] of asks) { if (q > 0) this.asks.set(p, q); else this.asks.delete(p); }
      this.trim();
      this.mark();
    }

    /** Drop anything that has fallen outside the venue's published window. */
    trim() {
      const n = this.venue.window;
      if (!n) return;
      if (this.bids.size > n) {
        const keep = [...this.bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, n);
        this.bids = new Map(keep);
      }
      if (this.asks.size > n) {
        const keep = [...this.asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, n);
        this.asks = new Map(keep);
      }
    }

    mark() { this.lastMsg = Date.now(); this.status = 'live'; this.retries = 0; }

    /** Sorted top levels: bids high→low, asks low→high. */
    top(n) {
      const bids = [...this.bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, n);
      const asks = [...this.asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, n);
      return { bids, asks };
    }

    get bestBid() { let m = -Infinity; for (const p of this.bids.keys()) if (p > m) m = p; return m === -Infinity ? null : m; }
    get bestAsk() { let m = Infinity; for (const p of this.asks.keys()) if (p < m) m = p; return m === Infinity ? null : m; }

    close() {
      this.closing = true;
      if (this.deepTimer) { clearInterval(this.deepTimer); this.deepTimer = null; }
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch (_e) {} this.ws = null; }
      this.status = 'closed';
    }
  }

  // ---- per-venue wire handling -----------------------------------------
  // Each entry returns {url, sub, onMessage(book, parsed)}. Parsing is kept
  // deliberately defensive: a venue that changes shape should degrade to "no
  // data from this venue", never take the whole panel down.
  const num = (x) => +x;
  const pairs = (arr, pi = 0, qi = 1) => arr.map(l => [num(l[pi]), num(l[qi])]);

  const WIRE = {
    binance: (sym) => ({
      url: `wss://stream.binance.com:9443/ws/${PAIR.binance(sym).toLowerCase()}@depth20@100ms`,
      sub: null,
      handle(book, m) {
        if (!m.bids || !m.asks) return;
        book.applySnapshot(pairs(m.bids), pairs(m.asks));
      },
    }),

    bybit: (sym) => ({
      url: 'wss://stream.bybit.com/v5/public/spot',
      sub: { op: 'subscribe', args: [`orderbook.50.${PAIR.bybit(sym)}`] },
      handle(book, m) {
        if (!m.data || !m.topic) return;
        const b = pairs(m.data.b || []), a = pairs(m.data.a || []);
        if (m.type === 'snapshot') book.applySnapshot(b, a);
        else book.applyDelta(b, a);
      },
    }),

    okx: (sym) => ({
      url: 'wss://ws.okx.com:8443/ws/v5/public',
      sub: { op: 'subscribe', args: [{ channel: 'books5', instId: PAIR.okx(sym) }] },
      handle(book, m) {
        const d = m.data && m.data[0];
        if (!d) return;
        book.applySnapshot(pairs(d.bids || []), pairs(d.asks || []));
      },
    }),

    kraken: (sym) => ({
      url: 'wss://ws.kraken.com/v2',
      sub: { method: 'subscribe', params: { channel: 'book', symbol: [PAIR.kraken(sym)], depth: 25 } },
      handle(book, m) {
        if (m.channel !== 'book' || !Array.isArray(m.data)) return;
        const d = m.data[0];
        if (!d) return;
        const b = (d.bids || []).map(l => [num(l.price), num(l.qty)]);
        const a = (d.asks || []).map(l => [num(l.price), num(l.qty)]);
        if (m.type === 'snapshot') book.applySnapshot(b, a);
        else book.applyDelta(b, a);
      },
    }),

    gate: (sym) => ({
      url: 'wss://api.gateio.ws/ws/v4/',
      sub: { time: Math.floor(Date.now() / 1000), channel: 'spot.order_book',
             event: 'subscribe', payload: [PAIR.gate(sym), '20', '100ms'] },
      handle(book, m) {
        const r = m.result;
        if (!r || !r.bids || !r.asks) return;
        book.applySnapshot(pairs(r.bids), pairs(r.asks));
      },
    }),

    bitget: (sym) => ({
      url: 'wss://ws.bitget.com/v2/ws/public',
      sub: { op: 'subscribe', args: [{ instType: 'SPOT', channel: 'books15', instId: PAIR.bitget(sym) }] },
      handle(book, m) {
        const d = m.data && m.data[0];
        if (!d || !d.bids || !d.asks) return;
        book.applySnapshot(pairs(d.bids), pairs(d.asks));
      },
    }),

    bitstamp: (sym) => ({
      url: 'wss://ws.bitstamp.net',
      sub: { event: 'bts:subscribe', data: { channel: 'order_book_' + PAIR.bitstamp(sym) } },
      handle(book, m) {
        const d = m.data;
        if (!d || !d.bids || !d.asks) return;
        book.applySnapshot(pairs(d.bids), pairs(d.asks));
      },
    }),

    bitfinex: (sym) => ({
      url: 'wss://api-pub.bitfinex.com/ws/2',
      sub: { event: 'subscribe', channel: 'book', symbol: PAIR.bitfinex(sym), prec: 'P0', len: '25' },
      // Bitfinex speaks arrays, and signs the amount rather than naming a side:
      // positive is a bid, negative an ask, and a zero count removes the level.
      handle(book, m) {
        if (!Array.isArray(m) || m[1] === 'hb') return;
        const payload = m[1];
        if (!Array.isArray(payload)) return;
        const rows = Array.isArray(payload[0]) ? payload : [payload];
        const b = [], a = [];
        for (const r of rows) {
          if (!Array.isArray(r) || r.length < 3) continue;
          const price = +r[0], count = +r[1], amount = +r[2];
          const qty = count === 0 ? 0 : Math.abs(amount);
          (amount > 0 || (count === 0 && amount === 1) ? b : a).push([price, qty]);
        }
        if (Array.isArray(payload[0])) book.applySnapshot(b, a);
        else book.applyDelta(b, a);
      },
    }),

    binancef: (sym) => ({
      url: `wss://fstream.binance.com/ws/${PAIR.binancef(sym).toLowerCase()}@depth20@100ms`,
      sub: null,
      // The futures partial-depth stream is labelled depthUpdate but carries the
      // top N levels in full, so it replaces rather than merges.
      handle(book, m) {
        if (!m.b || !m.a) return;
        book.applySnapshot(pairs(m.b), pairs(m.a));
      },
    }),

    bybitp: (sym) => ({
      url: 'wss://stream.bybit.com/v5/public/linear',
      sub: { op: 'subscribe', args: [`orderbook.50.${PAIR.bybitp(sym)}`] },
      handle(book, m) {
        if (!m.data || !m.topic) return;
        const b = pairs(m.data.b || []), a = pairs(m.data.a || []);
        if (m.type === 'snapshot') book.applySnapshot(b, a);
        else book.applyDelta(b, a);
      },
    }),

    okxp: (sym) => {
      const ct = okxCt(sym);
      return {
        url: 'wss://ws.okx.com:8443/ws/v5/public',
        sub: { op: 'subscribe', args: [{ channel: 'books5', instId: PAIR.okxp(sym) }] },
        handle(book, m) {
          const d = m.data && m.data[0];
          if (!d) return;
          const conv = (arr) => arr.map(l => [+l[0], +l[1] * ct]);
          book.applySnapshot(conv(d.bids || []), conv(d.asks || []));
        },
      };
    },

    coinbase: (sym) => ({
      url: 'wss://advanced-trade-ws.coinbase.com',
      sub: { type: 'subscribe', product_ids: [PAIR.coinbase(sym)], channel: 'level2' },
      handle(book, m) {
        if (m.channel !== 'l2_data' || !Array.isArray(m.events)) return;
        for (const ev of m.events) {
          const b = [], a = [];
          for (const u of (ev.updates || [])) {
            const lvl = [num(u.price_level), num(u.new_quantity)];
            (u.side === 'bid' ? b : a).push(lvl);
          }
          if (ev.type === 'snapshot') book.applySnapshot(b, a);
          else book.applyDelta(b, a);
        }
      },
    }),
  };

  // ---- the aggregate feed ----------------------------------------------
  class Feed {
    constructor(symbol, enabledIds) {
      this.symbol = symbol;
      this.books = new Map();
      this.onUpdate = null;
      for (const v of VENUES) {
        if (enabledIds && !enabledIds.includes(v.id)) continue;
        this.books.set(v.id, new VenueBook(v));
      }
    }

    start() {
      for (const [id, book] of this.books) this._connect(id, book);
      return this;
    }

    /**
     * Poll the deep REST book for venues that publish one.
     *
     * Only Binance does, at 5,000 levels a side. Weight is 250 per call against
     * a 6,000-a-minute budget, so a few seconds between polls is comfortable.
     */
    startDeep(intervalMs = 4000) {
      const book = this.books.get('binance');
      if (!book || book.deepTimer) return this;
      const pull = async () => {
        if (book.closing) return;
        try {
          const r = await fetch(`/api/binance/depth?symbol=${PAIR.binance(this.symbol)}&limit=5000`);
          if (!r.ok) return;
          const j = await r.json();
          if (!j.bids || !j.asks) return;
          book.deepBids = new Map(j.bids.map(l => [+l[0], +l[1]]));
          book.deepAsks = new Map(j.asks.map(l => [+l[0], +l[1]]));
          book.deepAt = Date.now();
        } catch (_e) { /* keep the last good snapshot */ }
      };
      pull();
      book.deepTimer = setInterval(pull, intervalMs);
      return this;
    }

    get deepAge() {
      const b = this.books.get('binance');
      return b && b.deepAt ? Date.now() - b.deepAt : null;
    }

    _connect(id, book) {
      if (book.closing) return;
      const spec = WIRE[id](this.symbol);
      book.status = 'connecting';
      let ws;
      try {
        ws = new WebSocket(spec.url);
      } catch (e) {
        book.status = 'error'; book.error = e.message;
        return this._retry(id, book);
      }
      book.ws = ws;

      ws.onopen = () => { if (spec.sub) ws.send(JSON.stringify(spec.sub)); };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (_e) { return; }
        try { spec.handle(book, m); } catch (e) { book.error = e.message; }
      };
      ws.onerror = () => { book.error = 'socket error'; };
      ws.onclose = () => {
        book.ws = null;
        if (book.closing) return;
        book.status = 'error';
        this._retry(id, book);
      };
    }

    _retry(id, book) {
      if (book.closing || book.retries > 6) { book.status = 'error'; return; }
      const wait = Math.min(15000, 800 * 2 ** book.retries++);
      book.timer = setTimeout(() => this._connect(id, book), wait);
    }

    close() {
      for (const b of this.books.values()) b.close();
      this.books.clear();
    }

    /** Venues that have produced a book in the last few seconds. */
    liveBooks() {
      const cutoff = Date.now() - 8000;
      return [...this.books.values()].filter(b => b.status === 'live' && b.lastMsg > cutoff && b.bids.size);
    }

    /**
     * Consolidate every venue into one ladder.
     *
     * Levels are bucketed to `tick` because venues quote on different price
     * grids — without bucketing the ladder becomes a thousand one-cent rows and
     * shows nothing. Each bucket keeps its per-venue split so the panel can
     * show who is actually resting the size.
     *
     * `quote` selects which venues take part ('USDT', 'USD', or 'all'); mixing
     * currencies in one consolidated price is meaningless, so the default is to
     * consolidate within a currency and report the other side alongside.
     */
    consolidate({ tick, depth = 14, quote = 'USDT', kind = 'spot', deep = false } = {}) {
      const books = this.liveBooks().filter(b =>
        (quote === 'all' || b.venue.quote === quote) &&
        (kind === 'all' || b.venue.kind === kind));
      if (!books.length) return null;

      const bidMap = new Map();   // bucketPrice -> {qty, by:{venueId:qty}}
      const askMap = new Map();
      const add = (map, price, qty, id, side) => {
        // Bids round down, asks round up: a bucket never claims size at a
        // better price than the size actually rests at.
        const b = side === 'bid'
          ? Math.floor(price / tick) * tick
          : Math.ceil(price / tick) * tick;
        const key = +b.toFixed(10);
        let e = map.get(key);
        if (!e) { e = { price: key, qty: 0, by: {} }; map.set(key, e); }
        e.qty += qty;
        e.by[id] = (e.by[id] || 0) + qty;
      };

      let bestBid = null, bestAsk = null, bestBidVenue = null, bestAskVenue = null;
      for (const bk of books) {
        const bb = bk.bestBid, ba = bk.bestAsk;
        if (bb != null && (bestBid == null || bb > bestBid)) { bestBid = bb; bestBidVenue = bk.venue; }
        if (ba != null && (bestAsk == null || ba < bestAsk)) { bestAsk = ba; bestAskVenue = bk.venue; }
      }

      // Only levels near the touch are worth consolidating. Coinbase streams
      // its entire book — tens of thousands of levels, most of them miles from
      // the market — and walking all of it every frame would cost far more than
      // the ladder is worth. The band is generous next to the depth we display.
      const anchor = (bestBid != null && bestAsk != null) ? (bestBid + bestAsk) / 2 : null;
      const band = anchor != null ? Math.max(anchor * 0.01, tick * depth * 4) : Infinity;
      const lo = anchor != null ? anchor - band : -Infinity;
      const hi = anchor != null ? anchor + band : Infinity;

      for (const bk of books) {
        // Prefer the deep snapshot when one was asked for and exists; it is the
        // same venue's book, just further out.
        const bids = (deep && bk.deepBids) ? bk.deepBids : bk.bids;
        const asks = (deep && bk.deepAsks) ? bk.deepAsks : bk.asks;
        for (const [p, q] of bids) if (p >= lo) add(bidMap, p, q, bk.venue.id, 'bid');
        for (const [p, q] of asks) if (p <= hi) add(askMap, p, q, bk.venue.id, 'ask');
      }

      const bids = [...bidMap.values()].sort((a, b) => b.price - a.price).slice(0, depth);
      const asks = [...askMap.values()].sort((a, b) => a.price - b.price).slice(0, depth);

      const mid = (bestBid != null && bestAsk != null) ? (bestBid + bestAsk) / 2 : null;
      const cumBid = bids.reduce((s, l) => s + l.qty * l.price, 0);
      const cumAsk = asks.reduce((s, l) => s + l.qty * l.price, 0);

      return {
        bids, asks, bestBid, bestAsk, bestBidVenue, bestAskVenue, mid, tick,
        spread: (bestBid != null && bestAsk != null) ? bestAsk - bestBid : null,
        // A crossed consolidated book means one venue's bid is above another's
        // ask: real, and usually gone before you could touch it.
        crossed: (bestBid != null && bestAsk != null) && bestBid >= bestAsk,
        imbalance: (cumBid + cumAsk) > 0 ? (cumBid - cumAsk) / (cumBid + cumAsk) : 0,
        notionalBid: cumBid, notionalAsk: cumAsk,
        venues: books.map(b => b.venue),
      };
    }

    /** Per-venue status for the connection strip. */
    health() {
      const cutoff = Date.now() - 8000;
      return [...this.books.values()].map(b => ({
        venue: b.venue,
        status: b.status === 'live' && b.lastMsg < cutoff ? 'stale' : b.status,
        levels: b.bids.size + b.asks.size,
        bestBid: b.bestBid, bestAsk: b.bestAsk,
        error: b.error,
      }));
    }
  }

  /** A sensible bucket size for a given price, rounded to a 1/2/5 step. */
  function autoTick(price) {
    if (!price || !isFinite(price)) return 0.01;
    const target = price * 0.00002;           // ~0.2 bp per row
    const mag = Math.pow(10, Math.floor(Math.log10(target)));
    const n = target / mag;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
  }

  return { VENUES, Feed, autoTick, baseOf, PAIR };
})();

window.Exchanges = Exchanges;
