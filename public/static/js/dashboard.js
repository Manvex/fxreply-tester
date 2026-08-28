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
  function show(page) {
    $$('.page').forEach(p => p.classList.toggle('active', p.dataset.page === page));
    $$('.nav-item[data-nav]').forEach(n => n.classList.toggle('active', n.dataset.nav === page));
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (location.hash.slice(1) !== page) history.replaceState(null, '', '#' + page);
  }
  $$('.nav-item[data-nav]').forEach(n => n.addEventListener('click', () => show(n.dataset.nav)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => show(b.dataset.goto)));

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

  // ---------------------------------------------------------------- boot
  const hash = location.hash.slice(1);
  if (hash && $(`.page[data-page="${hash}"]`)) show(hash);
})();
