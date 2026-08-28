/**
 * End-to-end check of the Backtesting Session flow.
 *
 * Drives a real browser against the local worker and asserts the things the
 * user reported as broken:
 *   1. no console errors on load
 *   2. the session actually starts and reveals bars from the chosen date
 *   3. the starting balance you type in is the balance the broker uses
 *   4. the play button plays, the pause button pauses, and bars advance by
 *      exactly one per tick (no skipping, no stacking)
 *   5. step-back rewinds both the chart and the account
 *   6. buying opens a position with the SL/TP from the ticket, the on-chart
 *      overlay draws, and closing books the P/L
 *   7. nothing disappears: legend, ticket, replay bar and account panel all
 *      stay populated through the whole session
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:3000';
const results = [];
let failed = 0;

function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  if (!cond) failed++;
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  console.log('\n== load ==');
  await page.goto(BASE + '/terminal', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.App && window.Replay && window.ChartMgr && window.TradeOverlay, null, { timeout: 60000 });
  // wait for the initial chart download to settle
  await page.waitForFunction(() => document.querySelector('#chart-loading').classList.contains('hidden'), null, { timeout: 120000 });
  check('page loads with no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('initial candles are on the chart', await page.evaluate(() => ChartMgr.candles.length > 50),
    'bars=' + await page.evaluate(() => ChartMgr.candles.length));

  console.log('\n== shared component styles reach the terminal page ==');
  await page.click('.dock-tab[data-tab="news"]');
  await page.waitForTimeout(150);
  const styled = await page.evaluate(() => {
    const el = document.querySelector('#ss-note');
    const cs = getComputedStyle(el);
    const sw = document.querySelector('#news-only-sym').closest('.switch');
    const swSpan = getComputedStyle(sw.querySelector('span'));
    return {
      calloutFlex: cs.display, calloutPad: cs.paddingLeft,
      switchLabelVisible: swSpan.display !== 'none' && sw.querySelector('span').offsetWidth > 40,
      gridCols: getComputedStyle(document.querySelector('#dlg-session .form-grid')).gridTemplateColumns,
    };
  });
  check('.callout is laid out (not unstyled)', styled.calloutFlex === 'flex' && parseFloat(styled.calloutPad) > 5,
    JSON.stringify(styled.calloutPad));
  check('.switch labels are readable', styled.switchLabelVisible);
  check('.form-grid produces two columns', styled.gridCols.split(' ').length === 2, styled.gridCols);

  console.log('\n== start a session ==');
  const BAL = 25000;
  await page.click('#btn-session');
  await page.waitForSelector('#dlg-session:not(.hidden)');
  await page.fill('#ss-start', '2024-03-01');
  await page.selectOption('#ss-tf', '1h');
  await page.fill('#ss-balance', String(BAL));
  await page.selectOption('#ss-leverage', '100');
  await page.click('#ss-start-btn');

  await page.waitForFunction(() => window.Replay.isActive(), null, { timeout: 180000 });
  check('session is active', await page.evaluate(() => Replay.isActive()));
  check('replay bar is visible', await page.isVisible('#replay-bar'));
  check('order ticket is visible', await page.isVisible('#ticket'));
  check('trade overlay canvas exists', await page.evaluate(() => !!document.querySelector('#trade-canvas')));

  const cfg = await page.evaluate(() => Replay.config());
  check('broker uses the balance I typed', cfg.balance === BAL, `cfg.balance=${cfg.balance}`);
  check('broker equity starts at that balance',
    await page.evaluate(() => Math.round(Replay.broker().equity(Replay.currentBar().close))) === BAL);
  const railBal = await page.textContent('#ar-balance');
  check('account rail shows that balance', railBal.replace(/[^0-9]/g, '').startsWith('25000'), railBal);

  const startBarTime = await page.evaluate(() => Replay.currentBar().time);
  check('session starts at/after the chosen date',
    startBarTime >= Date.UTC(2024, 2, 1) / 1000 - 86400 * 3,
    new Date(startBarTime * 1000).toISOString());

  console.log('\n== candles: future is hidden, stepping reveals exactly one bar ==');
  const beforeVisible = await page.evaluate(() => ChartMgr.candles.length);
  const total = await page.evaluate(() => Replay.allCandles().length);
  check('future bars are hidden', beforeVisible < total, `${beforeVisible} of ${total}`);

  await page.click('#rp-fwd');
  const afterOne = await page.evaluate(() => ChartMgr.candles.length);
  check('one step reveals exactly one candle', afterOne === beforeVisible + 1, `${beforeVisible} -> ${afterOne}`);

  const t1 = await page.evaluate(() => ChartMgr.candles[ChartMgr.candles.length - 1].time);
  const t2 = await page.evaluate(() => ChartMgr.candles[ChartMgr.candles.length - 2].time);
  check('candle times are strictly increasing', t1 > t2, `${t2} -> ${t1}`);
  check('no duplicate candle times', await page.evaluate(() => {
    const c = ChartMgr.candles;
    for (let i = 1; i < c.length; i++) if (c[i].time <= c[i - 1].time) return false;
    return true;
  }));

  console.log('\n== zoom is preserved while stepping (the "candles go weird" bug) ==');
  await page.evaluate(() => ChartMgr.chart.timeScale().setVisibleLogicalRange({ from: ChartMgr.candles.length - 60, to: ChartMgr.candles.length + 5 }));
  await page.waitForTimeout(250);   // let the time scale apply the new range
  const spanBefore = await page.evaluate(() => {
    const r = ChartMgr.chart.timeScale().getVisibleLogicalRange();
    return r.to - r.from;
  });
  for (let i = 0; i < 5; i++) await page.click('#rp-fwd');
  const spanAfter = await page.evaluate(() => {
    const r = ChartMgr.chart.timeScale().getVisibleLogicalRange();
    return r.to - r.from;
  });
  check('visible bar count does not jump when stepping',
    Math.abs(spanAfter - spanBefore) < 3, `${spanBefore.toFixed(1)} -> ${spanAfter.toFixed(1)}`);

  console.log('\n== play / pause ==');
  await page.selectOption('#rp-speed', '60');
  const idxBeforePlay = await page.evaluate(() => Replay.currentIndex());
  await page.click('#rp-play');
  check('play sets the playing state', await page.evaluate(() => Replay.isPlaying()));
  check('play button shows a pause icon',
    await page.evaluate(() => document.querySelector('#rp-play i').className.includes('pause')));
  await page.waitForTimeout(1200);
  const idxDuring = await page.evaluate(() => Replay.currentIndex());
  check('bars advance while playing', idxDuring > idxBeforePlay + 3, `${idxBeforePlay} -> ${idxDuring}`);

  await page.click('#rp-play');
  check('clicking again pauses', await page.evaluate(() => !Replay.isPlaying()));
  const idxPaused = await page.evaluate(() => Replay.currentIndex());
  await page.waitForTimeout(700);
  check('nothing advances while paused',
    await page.evaluate(() => Replay.currentIndex()) === idxPaused);
  check('play button shows a play icon again',
    await page.evaluate(() => document.querySelector('#rp-play i').className.includes('fa-play')));

  // and it must be restartable — the old setInterval version could wedge
  await page.click('#rp-play');
  await page.waitForTimeout(500);
  check('play works again after a pause', await page.evaluate(() => Replay.currentIndex()) > idxPaused);
  await page.click('#rp-play');
  await page.waitForTimeout(200);

  console.log('\n== chart and account stay in sync with the visible bar ==');
  check('chart bar count matches the replay index',
    await page.evaluate(() => ChartMgr.candles.length === Replay.currentIndex() + 1));
  check('clock label is populated', (await page.textContent('#rp-time')).includes('UTC'));
  check('bid/ask quotes are populated',
    (await page.textContent('#tk-bid')) !== '—' && (await page.textContent('#tk-ask')) !== '—');

  console.log('\n== place a trade with SL and TP from the ticket ==');
  const px = await page.evaluate(() => {
    const q = Replay.quote();
    return { bid: q.bid, ask: q.ask, dg: App.currentSymbolInfo.digits };
  });
  const sl = (px.ask * 0.995).toFixed(px.dg);
  const tp = (px.ask * 1.01).toFixed(px.dg);
  await page.fill('#tk-size', '1');
  await page.fill('#tk-sl', sl);
  await page.fill('#tk-tp', tp);

  const rrText = await page.textContent('#tk-rr');
  check('ticket computes reward:risk before you trade', /\d/.test(rrText), rrText);
  check('ticket shows the cash risk', (await page.textContent('#tk-risk-cash')).includes('$'));
  check('ticket shows the cash reward', (await page.textContent('#tk-reward-cash')).includes('$'));

  await page.click('#tk-buy');
  const pos = await page.evaluate(() => Replay.broker().positions.map(p => ({ ...p })));
  check('buy opens exactly one position', pos.length === 1, 'n=' + pos.length);
  check('position carries the SL from the ticket', pos[0] && Math.abs(pos[0].sl - parseFloat(sl)) < 1e-6);
  check('position carries the TP from the ticket', pos[0] && Math.abs(pos[0].tp - parseFloat(tp)) < 1e-6);
  check('position is long', pos[0] && pos[0].dir === 1);
  check('ticket clears its brackets after the fill',
    (await page.inputValue('#tk-sl')) === '' && (await page.inputValue('#tk-tp')) === '');

  console.log('\n== the position is drawn on the chart (TradingView style) ==');
  const lines = await page.evaluate(() => {
    // entry + sl + tp price lines should exist
    const specs = [];
    Replay.syncPositionLines();
    return { positions: Replay.broker().positions.length };
  });
  const overlayPainted = await page.evaluate(() => {
    const c = document.querySelector('#trade-canvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let nonEmpty = 0;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) nonEmpty++;
    return nonEmpty;
  });
  check('trade overlay actually paints pixels', overlayPainted > 20, 'samples=' + overlayPainted);

  console.log('\n== positions table + risk numbers ==');
  await page.click('.dock-tab[data-tab="positions"]');
  const tableText = await page.textContent('#open-pos-host');
  check('positions table lists the trade', tableText.includes('LONG'));
  check('positions table shows a pip figure', /[+-]\d+\.\d/.test(tableText));
  check('positions table has a Close button', await page.isVisible('#open-pos-host [data-close]'));
  check('positions table has a break-even button', await page.isVisible('#open-pos-host [data-be]'));

  console.log('\n== drag SL on the chart == ');
  const dragged = await page.evaluate(() => {
    const p = Replay.broker().positions[0];
    const before = p.sl;
    const target = p.dir > 0 ? p.entry * 0.99 : p.entry * 1.01;
    Replay.modifyPosition(p.id, { sl: target });
    return { before, after: Replay.broker().positions[0].sl, target };
  });
  check('stop can be moved programmatically (drag path)',
    Math.abs(dragged.after - dragged.target) < 1e-9, JSON.stringify(dragged));
  const rejected = await page.evaluate(() => {
    const p = Replay.broker().positions[0];
    // a long stop above entry must be refused
    return Replay.modifyPosition(p.id, { sl: p.entry * 1.05 });
  });
  check('an invalid stop is refused', rejected === false);

  console.log('\n== break-even helper ==');
  await page.evaluate(() => Replay.breakEven(Replay.broker().positions[0].id));
  check('break-even puts the stop at the entry',
    await page.evaluate(() => {
      const p = Replay.broker().positions[0];
      return Math.abs(p.sl - p.entry) < 1e-9;
    }));

  console.log('\n== step-back rewinds chart AND account ==');
  const snapBefore = await page.evaluate(() => ({
    idx: Replay.currentIndex(), bal: Replay.broker().balance,
    bars: ChartMgr.candles.length, open: Replay.broker().positions.length,
  }));
  await page.click('#rp-fwd');
  await page.click('#rp-back');
  const snapAfter = await page.evaluate(() => ({
    idx: Replay.currentIndex(), bal: Replay.broker().balance,
    bars: ChartMgr.candles.length, open: Replay.broker().positions.length,
  }));
  check('step-back restores the bar index', snapAfter.idx === snapBefore.idx, JSON.stringify([snapBefore.idx, snapAfter.idx]));
  check('step-back restores the chart length', snapAfter.bars === snapBefore.bars);
  check('step-back restores the balance', Math.abs(snapAfter.bal - snapBefore.bal) < 1e-6);
  check('step-back restores open positions', snapAfter.open === snapBefore.open);

  console.log('\n== close the position ==');
  const balBeforeClose = await page.evaluate(() => Replay.broker().balance);
  await page.evaluate(() => Replay.closeOne(Replay.broker().positions[0].id));
  const afterClose = await page.evaluate(() => ({
    open: Replay.broker().positions.length,
    closed: Replay.broker().closed.length,
    bal: Replay.broker().balance,
  }));
  check('position is gone from open', afterClose.open === 0);
  check('trade is booked as closed', afterClose.closed === 1);
  check('balance moved on close', Math.abs(afterClose.bal - balBeforeClose) > 0);
  check('closed trades table is populated',
    (await page.textContent('#closed-trades-host')).includes('Manual'));
  check('session stats strip appears', await page.isVisible('#session-stats'));

  console.log('\n== nothing disappeared ==');
  const alive = await page.evaluate(() => ({
    legend: (document.querySelector('#chart-legend').textContent || '').length > 10,
    replayBar: !document.querySelector('#replay-bar').classList.contains('hidden'),
    ticket: !document.querySelector('#ticket').classList.contains('hidden'),
    balance: (document.querySelector('#ar-balance').textContent || '').includes('$'),
    equity: (document.querySelector('#chip-equity').textContent || '').includes('$'),
    clock: (document.querySelector('#rp-time').textContent || '').includes('UTC'),
    progress: parseFloat(document.querySelector('#rp-progress-fill').style.width) >= 0,
    candles: ChartMgr.candles.length,
  }));
  Object.entries(alive).forEach(([k, v]) =>
    check(`still present after trading: ${k}`, k === 'candles' ? v > 50 : v === true, String(v)));

  console.log('\n== settings persistence ==');
  await page.click('#btn-settings');
  await page.waitForSelector('#dlg-account:not(.hidden)');
  check('settings dialog is pre-filled with the session balance',
    (await page.inputValue('#am-balance')) === String(BAL),
    await page.inputValue('#am-balance'));
  check('a live-session note is shown', await page.isVisible('#am-live-note'));
  await page.fill('#am-balance', '77000');
  await page.click('#am-apply');
  check('running session keeps its own balance after a settings change',
    await page.evaluate(() => Replay.config().balance) === BAL);
  check('the new value is stored for next time',
    await page.evaluate(() => JSON.parse(localStorage.getItem('bt_manual_settings')).balance) === 77000);

  console.log('\n== leaving the session ==');
  await page.evaluate(() => { window.confirm = () => true; });
  await page.click('#rp-exit');
  check('session ended', await page.evaluate(() => !Replay.isActive()));
  check('replay bar hidden', await page.evaluate(() => document.querySelector('#replay-bar').classList.contains('hidden')));
  check('ticket hidden', await page.evaluate(() => document.querySelector('#ticket').classList.contains('hidden')));
  check('full history is back on the chart',
    await page.evaluate(() => ChartMgr.candles.length === Replay.allCandles().length));
  check('trade overlay is off', await page.evaluate(() => {
    const c = document.querySelector('#trade-canvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4 * 331) if (d[i] > 0) return false;
    return true;
  }));

  console.log('\n== indicators during a session ==');
  await page.evaluate(() => ChartMgr.toggleIndicator('ema20'));
  check('indicator added', await page.evaluate(() => ChartMgr.activeIndicators.has('ema20')));
  await page.evaluate(() => { ChartMgr.paintIndicatorTail(); });
  check('indicator tail paint does not throw', true);
  await page.evaluate(() => ChartMgr.toggleIndicator('ema20'));
  check('indicator removed', await page.evaluate(() => !ChartMgr.activeIndicators.has('ema20')));

  console.log('\n== final console error check ==');
  check('no console errors during the whole run', errors.length === 0, errors.slice(0, 5).join(' | '));

  await browser.close();

  console.log(`\n${'='.repeat(64)}`);
  console.log(`${results.length - failed} / ${results.length} checks passed`);
  if (failed) {
    console.log('\nFailures:');
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.name}  ${r.detail}`));
  }
  console.log('='.repeat(64));
  process.exit(failed ? 1 : 0);
};

run().catch(e => { console.error('\nTEST HARNESS ERROR:', e); process.exit(2); });
