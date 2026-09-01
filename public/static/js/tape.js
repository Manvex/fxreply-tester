// ===========================================================================
// Trade tape — the aggressor side of the market, across every venue.
//
// The order book shows intent; the tape shows what actually traded. Two things
// are read off it here:
//
//   Delta    every print carries the side that crossed the spread. Summing
//            +buy / -sell gives cumulative volume delta: whether the moves are
//            being paid for by buyers lifting offers or sellers hitting bids.
//   Whales   prints above a notional threshold, kept with their venue, so a
//            single large fill is visible instead of being averaged away.
//
// Every venue reports the TAKER side, one way or another:
//   Binance   m=true  means the buyer was the maker -> a sell aggressed
//   Bybit     S: 'Buy' | 'Sell'      is the taker
//   OKX       side: 'buy' | 'sell'   is the taker
//   Kraken    side: 'buy' | 'sell'   is the taker
//   Coinbase  side on market_trades  is the taker
// ===========================================================================

const Tape = (() => {

  const WIRE = {
    binance: (sym) => ({
      url: `wss://stream.binance.com:9443/ws/${sym.toLowerCase()}@aggTrade`,
      sub: null,
      parse: (m) => (m.e === 'aggTrade')
        ? [{ t: m.T, price: +m.p, qty: +m.q, side: m.m ? 'sell' : 'buy' }]
        : null,
    }),
    bybit: (sym) => ({
      url: 'wss://stream.bybit.com/v5/public/spot',
      sub: { op: 'subscribe', args: [`publicTrade.${sym.toUpperCase()}`] },
      parse: (m) => (m.topic && m.topic.startsWith('publicTrade') && Array.isArray(m.data))
        ? m.data.map(d => ({ t: +d.T, price: +d.p, qty: +d.v, side: d.S === 'Buy' ? 'buy' : 'sell' }))
        : null,
    }),
    okx: (sym) => ({
      url: 'wss://ws.okx.com:8443/ws/v5/public',
      sub: { op: 'subscribe', args: [{ channel: 'trades', instId: Exchanges.PAIR.okx(sym) }] },
      parse: (m) => (m.arg && m.arg.channel === 'trades' && Array.isArray(m.data))
        ? m.data.map(d => ({ t: +d.ts, price: +d.px, qty: +d.sz, side: d.side }))
        : null,
    }),
    kraken: (sym) => ({
      url: 'wss://ws.kraken.com/v2',
      sub: { method: 'subscribe', params: { channel: 'trade', symbol: [Exchanges.PAIR.kraken(sym)] } },
      parse: (m) => (m.channel === 'trade' && Array.isArray(m.data))
        ? m.data.map(d => ({ t: Date.parse(d.timestamp), price: +d.price, qty: +d.qty, side: d.side }))
        : null,
    }),
    gate: (sym) => ({
      url: 'wss://api.gateio.ws/ws/v4/',
      sub: { time: Math.floor(Date.now() / 1000), channel: 'spot.trades',
             event: 'subscribe', payload: [Exchanges.PAIR.gate(sym)] },
      parse: (m) => (m.channel === 'spot.trades' && m.result && m.result.price)
        ? [{ t: Math.round(+m.result.create_time_ms), price: +m.result.price,
             qty: +m.result.amount, side: m.result.side }]
        : null,
    }),
    bitget: (sym) => ({
      url: 'wss://ws.bitget.com/v2/ws/public',
      sub: { op: 'subscribe', args: [{ instType: 'SPOT', channel: 'trade', instId: Exchanges.PAIR.bitget(sym) }] },
      parse: (m) => (m.arg && m.arg.channel === 'trade' && Array.isArray(m.data))
        ? m.data.map(d => ({ t: +d.ts, price: +d.price, qty: +d.size, side: d.side }))
        : null,
    }),
    bitstamp: (sym) => ({
      url: 'wss://ws.bitstamp.net',
      sub: { event: 'bts:subscribe', data: { channel: 'live_trades_' + Exchanges.PAIR.bitstamp(sym) } },
      // Bitstamp reports type 0 for a buy and 1 for a sell, taker side.
      parse: (m) => (m.event === 'trade' && m.data)
        ? [{ t: Math.round(+m.data.microtimestamp / 1000), price: +m.data.price,
             qty: +m.data.amount, side: +m.data.type === 1 ? 'sell' : 'buy' }]
        : null,
    }),
    bitfinex: (sym) => ({
      url: 'wss://api-pub.bitfinex.com/ws/2',
      sub: { event: 'subscribe', channel: 'trades', symbol: Exchanges.PAIR.bitfinex(sym) },
      // ['te'|'tu', [id, ms, amount, price]] — a negative amount is a seller
      // crossing the spread.
      parse: (m) => {
        if (!Array.isArray(m) || m[1] !== 'te' || !Array.isArray(m[2])) return null;
        const [, ms, amount, price] = m[2];
        return [{ t: +ms, price: +price, qty: Math.abs(+amount), side: +amount > 0 ? 'buy' : 'sell' }];
      },
    }),
    binancef: (sym) => ({
      // The futures feed carries @trade, not @aggTrade — the aggregated stream
      // is a spot-only channel and silently delivers nothing here.
      url: `wss://fstream.binance.com/ws/${Exchanges.PAIR.binancef(sym).toLowerCase()}@trade`,
      sub: null,
      parse: (m) => (m.e === 'trade')
        ? [{ t: m.T, price: +m.p, qty: +m.q, side: m.m ? 'sell' : 'buy' }]
        : null,
    }),
    bybitp: (sym) => ({
      url: 'wss://stream.bybit.com/v5/public/linear',
      sub: { op: 'subscribe', args: [`publicTrade.${Exchanges.PAIR.bybitp(sym)}`] },
      parse: (m) => (m.topic && m.topic.startsWith('publicTrade') && Array.isArray(m.data))
        ? m.data.map(d => ({ t: +d.T, price: +d.p, qty: +d.v, side: d.S === 'Buy' ? 'buy' : 'sell' }))
        : null,
    }),
    okxp: (sym) => ({
      url: 'wss://ws.okx.com:8443/ws/v5/public',
      sub: { op: 'subscribe', args: [{ channel: 'trades', instId: Exchanges.PAIR.okxp(sym) }] },
      parse: (m) => (m.arg && m.arg.channel === 'trades' && Array.isArray(m.data))
        ? m.data.map(d => ({ t: +d.ts, price: +d.px, qty: +d.sz, side: d.side }))
        : null,
    }),
    coinbase: (sym) => ({
      url: 'wss://advanced-trade-ws.coinbase.com',
      sub: { type: 'subscribe', product_ids: [Exchanges.PAIR.coinbase(sym)], channel: 'market_trades' },
      parse: (m) => {
        if (m.channel !== 'market_trades' || !Array.isArray(m.events)) return null;
        const out = [];
        for (const ev of m.events) {
          for (const tr of (ev.trades || [])) {
            out.push({
              t: Date.parse(tr.time), price: +tr.price, qty: +tr.size,
              side: String(tr.side || '').toLowerCase() === 'buy' ? 'buy' : 'sell',
            });
          }
        }
        return out;
      },
    }),
  };

  const MAX_TRADES = 4000;      // rolling tape, plenty for 15-minute windows
  const MAX_WHALES = 80;

  // Whales do not send one big order — they slice. A live BTC tape has a median
  // print around $50, and filtering for a single large fill shows nothing for
  // minutes at a time. What actually marks size is a burst: many prints, same
  // side, same venue, back to back, as one participant walks the book. Those
  // consecutive prints are folded into a single sweep and it is sweeps, not
  // individual fills, that the whale list reports.
  const SWEEP_GAP = 1200;       // ms of quiet that ends a sweep

  class Feed {
    constructor(symbol, venueIds) {
      this.symbol = symbol;
      this.venues = (venueIds || Exchanges.VENUES.map(v => v.id));
      this.trades = [];          // newest last
      this.whales = [];          // finalised sweeps, newest first
      this.open = new Map();     // `venue:side` -> sweep still being added to
      this.cvd = 0;              // cumulative signed notional since connect
      this.cvdPoints = [];       // {t, cvd} for the sparkline
      this.whaleMin = 100000;    // notional threshold, user adjustable
      this.sockets = new Map();
      this.closing = false;
      this.started = Date.now();
      this.counts = new Map();   // venueId -> prints seen
    }

    // The threshold is a read-time filter, so changing it re-reads the sweeps
    // already collected instead of only affecting future ones. 'auto' adapts to
    // the tape in front of it: a fixed dollar figure that is meaningful for BTC
    // shows nothing on a small alt, and a figure tuned for a busy hour shows
    // nothing at 4am. The auto threshold tracks the 90th percentile of recent
    // sweeps, so the list always holds roughly the biggest tenth of what is
    // actually happening.
    setWhaleMin(v) { this.whaleMin = v; }

    autoThreshold() {
      if (this.whales.length < 8) return 0;
      const sorted = this.whales.map(s => s.notional).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * 0.9)] || 0;
    }

    get effectiveMin() {
      return this.whaleMin === 'auto' ? this.autoThreshold() : this.whaleMin;
    }

    /** Close any sweep that has gone quiet for longer than the gap. */
    _expire(now) {
      for (const [key, sw] of this.open) {
        if (now - sw.tEnd <= SWEEP_GAP) continue;
        this.open.delete(key);
        this.whales.unshift(sw);
        if (this.whales.length > MAX_WHALES) this.whales.pop();
      }
    }

    /** Sweeps at or above the current threshold, newest first. */
    bigSweeps(limit) {
      this._expire(Date.now());
      const min = this.effectiveMin;
      const out = [];
      for (const sw of this.whales) {
        if (sw.notional >= min && this.inView(sw)) out.push(sw);
        if (limit && out.length >= limit) break;
      }
      return out;
    }

    start() {
      for (const id of this.venues) this._connect(id, 0);
      return this;
    }

    _connect(id, attempt) {
      if (this.closing) return;
      const spec = WIRE[id] && WIRE[id](this.symbol);
      if (!spec) return;
      let ws;
      try { ws = new WebSocket(spec.url); } catch (_e) { return this._retry(id, attempt); }
      this.sockets.set(id, ws);

      ws.onopen = () => { if (spec.sub) ws.send(JSON.stringify(spec.sub)); };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (_e) { return; }
        let rows;
        try { rows = spec.parse(m); } catch (_e) { return; }
        if (!rows || !rows.length) return;
        for (const r of rows) this._add(id, r);
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        this.sockets.delete(id);
        if (!this.closing) this._retry(id, attempt + 1);
      };
    }

    _retry(id, attempt) {
      if (this.closing || attempt > 6) return;
      setTimeout(() => this._connect(id, attempt), Math.min(15000, 800 * 2 ** attempt));
    }

    _add(venueId, r) {
      if (!isFinite(r.price) || !isFinite(r.qty) || r.qty <= 0) return;
      const notional = r.price * r.qty;
      const row = { ...r, venueId, notional };

      this.trades.push(row);
      if (this.trades.length > MAX_TRADES) this.trades.splice(0, this.trades.length - MAX_TRADES);

      this.counts.set(venueId, (this.counts.get(venueId) || 0) + 1);
      this.cvd += (r.side === 'buy' ? notional : -notional);

      const now = Date.now();
      const last = this.cvdPoints[this.cvdPoints.length - 1];
      // One point per second is plenty for a sparkline and keeps the array small.
      if (!last || now - last.t > 1000) {
        this.cvdPoints.push({ t: now, cvd: this.cvd });
        if (this.cvdPoints.length > 900) this.cvdPoints.shift();
      } else {
        last.cvd = this.cvd;
      }

      this._expire(now);
      const key = venueId + ':' + r.side;
      const sw = this.open.get(key);
      if (sw && r.t - sw.tEnd <= SWEEP_GAP) {
        sw.tEnd = r.t;
        sw.qty += r.qty;
        sw.notional += notional;
        sw.prints++;
        sw.priceTo = r.price;
        sw.high = Math.max(sw.high, r.price);
        sw.low = Math.min(sw.low, r.price);
      } else {
        if (sw) { this.open.delete(key); this.whales.unshift(sw); if (this.whales.length > MAX_WHALES) this.whales.pop(); }
        this.open.set(key, {
          t: r.t, tEnd: r.t, venueId, side: r.side,
          qty: r.qty, notional, prints: 1,
          priceFrom: r.price, priceTo: r.price, high: r.price, low: r.price,
        });
      }
    }

    /**
     * Whether a print belongs to the market currently being looked at.
     *
     * Spot and perpetual prints are different instruments at different prices;
     * summing them into one delta would be adding up two markets and calling
     * the total a signal.
     */
    inView(t) {
      const want = (window.CryptoHub && CryptoHub.market) || 'all';
      if (want === 'all') return true;
      const v = Exchanges.VENUES.find(x => x.id === t.venueId);
      return !v || v.kind === want;
    }

    /** Buy / sell notional and delta over the last `sec` seconds. */
    window(sec) {
      const cutoff = Date.now() - sec * 1000;
      let buy = 0, sell = 0, n = 0;
      for (let i = this.trades.length - 1; i >= 0; i--) {
        const t = this.trades[i];
        if (t.t < cutoff) break;
        if (!this.inView(t)) continue;
        if (t.side === 'buy') buy += t.notional; else sell += t.notional;
        n++;
      }
      const total = buy + sell;
      return { buy, sell, delta: buy - sell, total, prints: n,
               ratio: total > 0 ? (buy - sell) / total : 0 };
    }

    /** Whale flow split, for the "what are they doing" read. */
    whaleFlow(sec) {
      const cutoff = Date.now() - sec * 1000;
      let buy = 0, sell = 0, nb = 0, ns = 0;
      for (const w of this.bigSweeps()) {
        if (w.t < cutoff) break;
        if (!this.inView(w)) continue;
        if (w.side === 'buy') { buy += w.notional; nb++; } else { sell += w.notional; ns++; }
      }
      const total = buy + sell;
      return { buy, sell, delta: buy - sell, total, buys: nb, sells: ns,
               ratio: total > 0 ? (buy - sell) / total : 0 };
    }

    /** Largest resting levels in a consolidated book — walls, not prints. */
    static walls(consolidated, minNotional) {
      if (!consolidated) return [];
      const out = [];
      for (const side of ['bids', 'asks']) {
        for (const lvl of consolidated[side]) {
          const notional = lvl.qty * lvl.price;
          if (notional >= minNotional) {
            out.push({ side: side === 'bids' ? 'bid' : 'ask', price: lvl.price, qty: lvl.qty, notional, by: lvl.by });
          }
        }
      }
      return out.sort((a, b) => b.notional - a.notional).slice(0, 8);
    }

    get liveVenues() { return [...this.sockets.keys()]; }

    close() {
      this.closing = true;
      for (const ws of this.sockets.values()) {
        ws.onclose = null;
        try { ws.close(); } catch (_e) {}
      }
      this.sockets.clear();
    }
  }

  return { Feed, WIRE };
})();

window.Tape = Tape;
