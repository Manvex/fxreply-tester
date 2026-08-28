// ===========================================================================
// Catalog — the FULL Dukascopy instrument universe (~1,500 instruments),
// loaded lazily the first time the user searches. Nothing is rendered until
// the user types: search-first UX, like FXReplay.
//
// Data file: /static/data/duka-catalog.json, generated from the official
// Dukascopy instrument metadata (pipValue + priceScale per instrument), so
// every entry decodes with the correct integer divisor.
// ===========================================================================
const Catalog = (() => {
  let loadPromise = null;
  let items = [];               // normalized entries
  const registered = new Set(); // syms already pushed into window.SYMBOLS

  const CAT_LABEL = {
    forex: 'Forex', indices: 'Indices', stocks: 'Stocks', etf: 'ETFs',
    commodities: 'Commodities', crypto: 'Crypto', bonds: 'Bonds', funds: 'Funds',
  };

  function curatedDukaIds() {
    const set = new Set();
    for (const s of (window.SYMBOLS || [])) {
      if (s.source === 'duka') set.add(s.duka || s.sym);
    }
    return set;
  }

  function ensure() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const r = await fetch('/static/data/duka-catalog.json');
      if (!r.ok) throw new Error('catalog fetch failed: ' + r.status);
      const { fields, rows } = await r.json();
      const ix = Object.fromEntries(fields.map((f, i) => [f, i]));
      const skip = curatedDukaIds();
      const seenSym = new Set((window.SYMBOLS || []).map(s => s.sym));
      const out = [];
      for (const row of rows) {
        const id = row[ix.id];
        if (skip.has(id)) continue;              // already in the curated list
        let sym = row[ix.sym];
        if (seenSym.has(sym)) sym = id;          // avoid ticker collisions
        seenSym.add(sym);
        out.push({
          sym,
          duka: id,
          label: row[ix.label],                  // e.g. "AAPL.US/USD"
          name: row[ix.name],
          cat: row[ix.cat],
          source: 'duka',
          pip: row[ix.pip],
          factor: row[ix.factor],
          digits: row[ix.digits],
          lotUnits: row[ix.lotUnits],
          since: row[ix.since] || '',
          country: row[ix.country] || '',
          fromCatalog: true,
        });
      }
      items = out;
      return items;
    })();
    return loadPromise;
  }

  // Search across BOTH the curated list and the full catalog.
  // Returns { curated: [...], catalog: [...] } capped at `limit` total.
  async function search(query, cat = 'all', limit = 60) {
    const q = (query || '').trim().toUpperCase();
    const matchCat = (c) => cat === 'all' || c === cat;

    const curated = (window.SYMBOLS || []).filter(s =>
      matchCat(s.cat) &&
      (!q || s.sym.toUpperCase().includes(q) || s.name.toUpperCase().includes(q)));

    if (!q) return { curated, catalog: [], total: curated.length };

    await ensure();
    const catalog = [];
    for (const it of items) {
      if (!matchCat(it.cat)) continue;
      if (it.sym.toUpperCase().includes(q) ||
          it.label.toUpperCase().includes(q) ||
          it.name.toUpperCase().includes(q)) {
        catalog.push(it);
        if (curated.length + catalog.length >= limit) break;
      }
    }
    return { curated, catalog, total: curated.length + catalog.length };
  }

  // Make a catalog instrument usable everywhere (getSymbol, DataStore, engine).
  function register(entry) {
    if (!entry || registered.has(entry.sym)) return entry && getSymbol(entry.sym);
    const existing = (window.SYMBOLS || []).find(s => s.sym === entry.sym);
    if (existing) return existing;
    const info = {
      sym: entry.sym, duka: entry.duka, name: entry.name, cat: entry.cat,
      source: 'duka', factor: entry.factor, pip: entry.pip,
      lotUnits: entry.lotUnits, digits: Math.min(entry.digits, 8),
      fromCatalog: true, label: entry.label,
    };
    window.SYMBOLS.push(info);
    (window.SYMBOLS_BY_CAT[info.cat] ||= []).push(info);
    registered.add(entry.sym);
    try {
      const saved = JSON.parse(localStorage.getItem('bt_catalog_syms') || '[]');
      if (!saved.find(s => s.sym === entry.sym)) {
        saved.push(entry);
        localStorage.setItem('bt_catalog_syms', JSON.stringify(saved.slice(-80)));
      }
    } catch (_) {}
    return info;
  }

  // Restore instruments the user picked in previous visits, so deep links
  // (/terminal?symbol=…) and the watchlist keep working after a reload.
  function restoreSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem('bt_catalog_syms') || '[]');
      for (const e of saved) register(e);
    } catch (_) {}
  }

  async function findAndRegister(sym) {
    if (window.findSymbol && window.findSymbol(sym)) return window.findSymbol(sym);
    await ensure();
    const hit = items.find(i => i.sym === sym || i.duka === sym);
    return hit ? register(hit) : null;
  }

  function count() { return items.length; }

  return { ensure, search, register, restoreSaved, findAndRegister, count, CAT_LABEL };
})();

Catalog.restoreSaved();
window.Catalog = Catalog;
