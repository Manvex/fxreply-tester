// ===========================================================================
// Backtesting Session — the FXReplay-style flow. One popup holds everything:
// market (searchable across the whole Dukascopy universe), timeframe, start
// date, balance, leverage, costs and optional prop rules. Confirming downloads
// the data around the start date and drops straight into manual bar replay.
//
// Fixes: the account you type in is the account you get (settings are read at
// launch, persisted to localStorage and handed straight to Replay.start), the
// dialog re-opens with what you last used, and a running session is never
// silently thrown away — you get asked.
// ===========================================================================
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const CAT_LABEL = { forex: 'FX', indices: 'IDX', stocks: 'EQ', etf: 'ETF', commodities: 'CMD', crypto: 'CRY', bonds: 'BND', funds: 'FND' };
  const LS_KEY = 'bt_session_cfg';

  // Data window per TF: [warm-up before start, tradeable window after start]
  const WINDOW = {
    '1m':  [3 * 86400,    14 * 86400],
    '5m':  [7 * 86400,    45 * 86400],
    '15m': [14 * 86400,   90 * 86400],
    '30m': [21 * 86400,   150 * 86400],
    '1h':  [45 * 86400,   365 * 86400],
    '4h':  [120 * 86400,  2 * 365 * 86400],
    '1d':  [400 * 86400,  8 * 365 * 86400],
  };

  let selected = null;   // symbol info chosen in the dialog
  let searchTimer = null;

  // ---------------- persisted config ----------------
  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (_) { return null; }
  }
  function saveCfg(c) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch (_) {}
  }

  function readForm() {
    return {
      sym: (selected || window.App.currentSymbolInfo).sym,
      tf: $('#ss-tf').value,
      start: $('#ss-start').value,
      balance: parseFloat($('#ss-balance').value) || 100000,
      leverage: parseInt($('#ss-leverage').value) || 100,
      spread: parseFloat($('#ss-spread').value) || 0,
      commission: parseFloat($('#ss-commission').value) || 0,
      propMode: $('#ss-prop').value,
    };
  }

  function fmtSel(info) {
    if (!info) return;
    $('#ss-cur-ico').textContent = CAT_LABEL[info.cat] || '?';
    $('#ss-cur-sym').textContent = info.sym;
    $('#ss-cur-name').textContent = info.name + (info.source === 'binance' ? ' · Binance' : ' · Dukascopy');
  }

  function openSession() {
    if (Replay.isActive()) {
      const ok = confirm('A session is already running. Start a new one? The current session and its trades will be discarded.');
      if (!ok) return;
      Replay.exit();
    }

    const saved = loadCfg() || {};
    selected = (saved.sym && window.findSymbol(saved.sym)) || window.App.currentSymbolInfo;
    fmtSel(selected);
    closeSearch();
    $('#ss-progress').classList.add('hidden');
    $('#ss-error').classList.add('hidden');

    // start date: what was used last, else ~6 months back
    if (saved.start) $('#ss-start').value = saved.start;
    if (!$('#ss-start').value) {
      const d = new Date(Date.now() - 180 * 86400000);
      $('#ss-start').value = d.toISOString().slice(0, 10);
    }
    // keep the picker honest: nothing later than yesterday
    $('#ss-start').max = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

    if (saved.tf) $('#ss-tf').value = saved.tf;
    $('#ss-balance').value = saved.balance ?? window.App.manualSettings.balance;
    $('#ss-leverage').value = String(saved.leverage ?? window.App.manualSettings.leverage);
    $('#ss-spread').value = saved.spread ?? window.App.manualSettings.spread;
    $('#ss-commission').value = saved.commission ?? window.App.manualSettings.commission;
    $('#ss-prop').value = saved.propMode || window.App.manualSettings.propMode || 'none';

    window.App.openDialog('#dlg-session');
    updateNote();
  }

  function updateNote() {
    const tf = $('#ss-tf').value;
    const [warm, span] = WINDOW[tf] || WINDOW['1h'];
    const days = Math.round(span / 86400);
    const human = days >= 365
      ? (days / 365).toFixed(days % 365 ? 1 : 0) + ' year' + (days >= 730 ? 's' : '')
      : days + ' days';
    $('#ss-note-text').innerHTML =
      `On <b>${tf.toUpperCase()}</b> the session downloads about <b>${human}</b> of real data from your start date forward, plus ${Math.round(warm / 86400)} days of warm-up history so indicators have something to chew on. You can jump to another date inside that window without reloading.`;
  }

  function showError(msg) {
    const box = $('#ss-error');
    if (!box) { window.App.toast(msg, 'err'); return; }
    box.classList.remove('hidden');
    $('#ss-error-text').textContent = msg;
  }
  function clearError() { $('#ss-error') && $('#ss-error').classList.add('hidden'); }

  // ---------------- market search inside the dialog ----------------
  function openSearch() {
    $('#ss-sym-current').classList.add('hidden');
    $('#ss-search-wrap').classList.remove('hidden');
    $('#ss-search').value = '';
    $('#ss-results').innerHTML =
      `<div class="ss-hint"><i class="fa-solid fa-keyboard"></i> Start typing to search ~1,500 Dukascopy markets and Binance crypto — try “gold”, “tesla”, “dax”, “eurusd”…</div>`;
    setTimeout(() => $('#ss-search').focus(), 30);
  }
  function closeSearch() {
    $('#ss-sym-current').classList.remove('hidden');
    $('#ss-search-wrap').classList.add('hidden');
  }

  function rowHTML(s, isCatalog) {
    return `<div class="sym-row" data-sym="${s.sym}" data-catalog="${isCatalog ? 1 : 0}">
      <span class="sr-ico">${CAT_LABEL[s.cat] || '?'}</span>
      <span class="sr-l">
        <div class="sr-sym">${s.sym}${s.label && s.label !== s.sym ? ` <small style="color:var(--t-4);font-weight:400">${s.label}</small>` : ''}</div>
        <div class="sr-name">${s.name}</div>
      </span>
      <span class="sr-r">
        ${s.since ? `<span class="pill">since ${s.since}</span>` : ''}
        <span class="pill">${s.source === 'binance' ? 'Binance' : 'Dukascopy'}</span>
      </span>
    </div>`;
  }

  async function runSearch(q) {
    const host = $('#ss-results');
    if (!q.trim()) {
      host.innerHTML = `<div class="ss-hint"><i class="fa-solid fa-keyboard"></i> Start typing to search ~1,500 markets…</div>`;
      return;
    }
    host.innerHTML = `<div class="ss-hint"><i class="fa-solid fa-circle-notch spin"></i> Searching…</div>`;
    let res;
    try { res = await Catalog.search(q, 'all', 40); }
    catch (e) {
      host.innerHTML = `<div class="ss-hint"><i class="fa-solid fa-triangle-exclamation"></i> Catalog unavailable — showing built-in markets only.</div>`;
      return;
    }
    if ($('#ss-search').value.trim() !== q.trim()) return; // stale
    const parts = [];
    if (res.curated.length) parts.push(res.curated.map(s => rowHTML(s, false)).join(''));
    if (res.catalog.length) {
      parts.push(`<div class="ss-group">Full Dukascopy catalog</div>`);
      parts.push(res.catalog.map(s => rowHTML(s, true)).join(''));
    }
    host.innerHTML = parts.length ? parts.join('')
      : `<div class="ss-hint"><i class="fa-solid fa-magnifying-glass"></i> Nothing matches “${q}”. Try a ticker (AAPL), a name (gold, Tencent) or a pair (EURUSD).</div>`;

    $$('#ss-results .sym-row').forEach(r => r.addEventListener('click', async () => {
      const sym = r.dataset.sym;
      let info = window.findSymbol(sym);
      if (!info) info = await Catalog.findAndRegister(sym);
      if (!info) { window.App.toast('Could not register that instrument', 'err'); return; }
      selected = info;
      fmtSel(info);
      closeSearch();
      clearError();
    }));
  }

  // ---------------- launch ----------------
  function setProgress(on, pct, text) {
    const box = $('#ss-progress');
    if (!on) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    if (text) $('#ss-progress-text').textContent = text;
    const p = Math.round((pct || 0) * 100);
    $('#ss-progress-pct').textContent = p + '%';
    $('#ss-progress-fill').style.width = p + '%';
  }

  async function startSession() {
    clearError();
    const dateStr = $('#ss-start').value;
    if (!dateStr) { showError('Pick a start date first.'); return; }
    const tf = $('#ss-tf').value;
    const parts = dateStr.split('-').map(Number);
    const startSec = Date.UTC(parts[0], parts[1] - 1, parts[2]) / 1000;
    const now = Math.floor(Date.now() / 1000);
    if (!isFinite(startSec)) { showError('That start date is not valid.'); return; }
    if (startSec >= now - 2 * 86400) { showError('The start date must be at least two days in the past — there has to be future data left to reveal.'); return; }

    const info = selected || window.App.currentSymbolInfo;
    if (info.since) {
      const sinceSec = Date.UTC(Number(info.since), 0, 1) / 1000;
      if (startSec < sinceSec) {
        showError(`${info.sym} history only starts in ${info.since}. Pick a later start date.`);
        return;
      }
    }

    const [warm, span] = WINDOW[tf] || WINDOW['1h'];
    const from = startSec - warm;
    const to = Math.min(now, startSec + span);

    // The account for this session. Persist it and mirror it into App so the
    // settings dialog and the account rail agree with what the session uses.
    const cfgForm = readForm();
    const settings = {
      balance: cfgForm.balance, leverage: cfgForm.leverage,
      spread: cfgForm.spread, commission: cfgForm.commission,
      propMode: cfgForm.propMode,
    };
    window.App.setManualSettings(settings, { silent: true });
    saveCfg(cfgForm);

    const btn = $('#ss-start-btn');
    btn.disabled = true;
    setProgress(true, 0, `Downloading ${info.sym} ${tf.toUpperCase()} data…`);
    try {
      const candles = await DataStore.load(info.sym, tf, from, to,
        (p) => setProgress(true, p, `Downloading ${info.sym} ${tf.toUpperCase()} data…`));

      // Bars strictly before the start date are warm-up; there must be enough
      // of both halves for the session to make sense.
      const before = candles.filter(c => c.time < startSec).length;
      const after = candles.length - before;

      if (candles.length < 60 || after < 20) {
        setProgress(false);
        btn.disabled = false;
        showError(after < 20 && candles.length >= 60
          ? `Only ${after} bars exist after ${dateStr} for ${info.sym} on ${tf.toUpperCase()} — pick an earlier start date.`
          : `Only ${candles.length} bars came back for ${info.sym} ${tf.toUpperCase()} around ${dateStr}. That market may not have traded then — try a later start date, a higher timeframe, or another instrument.`);
        return;
      }

      // hand over to the app: set symbol/tf state + chart
      window.App.applySessionData(info, tf, candles, { from, to });
      window.App.closeModals();
      const ok = Replay.start(startSec, {
        settings, sym: info.sym, tf, startDate: dateStr,
      });
      if (ok) {
        window.App.toast(
          `Session live — ${info.sym} ${tf.toUpperCase()} from ${dateStr}. → next bar · Space play · B buy · S sell`, 'ok');
        window.App.openTab('positions');
      }
    } catch (e) {
      console.error(e);
      showError('Could not load data: ' + (e.message || e));
    } finally {
      setProgress(false);
      btn.disabled = false;
    }
  }

  // ---------------- wire up ----------------
  $('#btn-session').addEventListener('click', openSession);
  $('#ss-change').addEventListener('click', openSearch);
  $('#ss-tf').addEventListener('change', updateNote);
  $('#ss-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value;
    searchTimer = setTimeout(() => runSearch(q), 180);
  });
  $('#ss-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = $('#ss-results .sym-row');
      if (first) first.click();
    }
    if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); }
  });
  $('#ss-start-btn').addEventListener('click', startSession);

  window.Session = { open: openSession };
})();
