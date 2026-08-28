// ===========================================================================
// Trade overlay — the TradingView / FXReplay style position visual.
//
// For every open position it draws, directly on the chart:
//   * an entry line with side + size + live profit in cash, pips and R
//   * a red risk zone down to the stop loss, labelled with the cash at risk
//   * a green reward zone up to the take profit, labelled with the cash reward
//   * draggable edges — grab the SL or TP line and move it, the broker order is
//     modified live (exactly like dragging a bracket on TradingView)
//   * a close (x) button on the entry label
//
// It also renders a *pending* preview while the order ticket is being filled in
// so you can see the risk before you click BUY / SELL, and supports "click the
// chart to place SL / TP" pick mode.
//
// Drawing happens on its own canvas above the chart. Pointer handling is
// attached to the chart wrapper in the capture phase, so when the cursor is on
// one of our handles we swallow the event and the chart does not pan.
// ===========================================================================
const TradeOverlay = (() => {
  let canvas, ctx, wrap;
  let enabled = false;
  let hover = null;          // {kind:'sl'|'tp'|'entry'|'close', id}
  let drag = null;           // {kind, id, startPrice}
  let pick = null;           // {kind:'sl'|'tp', onPick(price)}
  let preview = null;        // {dir, lots, entry, sl, tp}  (ticket preview)
  let raf = null;
  let mouse = { x: -1, y: -1, inside: false };

  const HANDLE_H = 9;        // grab tolerance in px
  const LABEL_F = '11px Inter, sans-serif';
  const SMALL_F = '10px Inter, sans-serif';

  const C = {
    risk: 'rgba(242, 97, 92, 0.13)',
    riskLine: '#f2615c',
    reward: 'rgba(38, 208, 165, 0.13)',
    rewardLine: '#26d0a5',
    longLine: '#26d0a5',
    shortLine: '#f2615c',
    text: '#eef1f6',
    dim: 'rgba(238,241,246,.72)',
    plate: 'rgba(11,13,16,.86)',
  };

  // ------------------------------------------------------------------ setup
  function init(canvasEl, wrapEl) {
    canvas = canvasEl; ctx = canvas.getContext('2d'); wrap = wrapEl;
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    resize();

    // capture phase so we get first refusal before Lightweight Charts
    wrap.addEventListener('mousemove', onMove, true);
    wrap.addEventListener('mousedown', onDown, true);
    window.addEventListener('mouseup', onUp, true);
    wrap.addEventListener('mouseleave', () => { mouse.inside = false; hover = null; setCursor(''); });

    loop();
  }

  function resize() {
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(r.height * devicePixelRatio));
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!enabled) { hover = null; drag = null; pick = null; preview = null; clear(); }
  }

  function setPreview(p) { preview = p; }
  function clearPreview() { preview = null; }

  function startPick(kind, cb) {
    pick = { kind, cb };
    wrap.classList.add('picking');
    window.App && window.App.toast(
      `Click the chart to place the ${kind === 'sl' ? 'stop loss' : 'take profit'}`, 'info');
  }
  function cancelPick() { pick = null; wrap.classList.remove('picking'); }
  function isPicking() { return !!pick; }

  // ------------------------------------------------------------- geometry
  function positions() {
    if (!enabled || !window.Replay || !Replay.isActive()) return [];
    const b = Replay.broker && Replay.broker();
    return b ? b.positions : [];
  }

  function priceY(p) { return ChartMgr.priceToY(p); }
  function timeX(t) { return ChartMgr.timeToX(t); }

  /** Right-hand edge of the plot area (before the price scale). */
  function plotRight() {
    return canvas.clientWidth;
  }

  /** Layout for one position: x span + y for entry/sl/tp. */
  function layout(p) {
    const yE = priceY(p.entry);
    if (yE == null) return null;
    let x0 = timeX(p.openTime);
    if (x0 == null) x0 = 0;
    x0 = Math.max(0, Math.min(x0, plotRight() - 120));
    const x1 = plotRight();
    return {
      x0, x1, yE,
      ySL: p.sl != null ? priceY(p.sl) : null,
      yTP: p.tp != null ? priceY(p.tp) : null,
    };
  }

  // ---------------------------------------------------------------- hit test
  function hitTest(x, y) {
    const ps = positions();
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      const L = layout(p);
      if (!L) continue;
      if (x < L.x0 - 6) continue;
      // close button sits at the right end of the entry label
      if (closeBtnHit(p, L, x, y)) return { kind: 'close', id: p.id };
      if (L.ySL != null && Math.abs(y - L.ySL) <= HANDLE_H) return { kind: 'sl', id: p.id };
      if (L.yTP != null && Math.abs(y - L.yTP) <= HANDLE_H) return { kind: 'tp', id: p.id };
      if (Math.abs(y - L.yE) <= HANDLE_H) return { kind: 'entry', id: p.id };
    }
    return null;
  }

  function closeBtnRect(p, L) {
    const size = 15;
    return { x: L.x1 - size - 6, y: L.yE - size / 2, w: size, h: size };
  }
  function closeBtnHit(p, L, x, y) {
    const r = closeBtnRect(p, L);
    return x >= r.x - 2 && x <= r.x + r.w + 2 && y >= r.y - 2 && y <= r.y + r.h + 2;
  }

  function setCursor(c) { if (wrap) wrap.style.cursor = c; }

  // ------------------------------------------------------------- pointer
  function localPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onMove(e) {
    const { x, y } = localPos(e);
    mouse = { x, y, inside: true };
    if (!enabled) return;

    if (drag) {
      const price = ChartMgr.yToPrice(y);
      if (price == null) return;
      applyDrag(price);
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (pick) { setCursor('crosshair'); return; }

    const h = hitTest(x, y);
    hover = h;
    if (h) {
      setCursor(h.kind === 'close' ? 'pointer' : 'ns-resize');
      // Stop the chart from showing a pan cursor underneath.
      e.stopPropagation();
    } else if (!Draw || Draw.tool === 'cursor') {
      setCursor('');
    }
  }

  function onDown(e) {
    if (!enabled || e.button !== 0) return;
    const { x, y } = localPos(e);

    if (pick) {
      const price = ChartMgr.yToPrice(y);
      const cb = pick.cb;
      cancelPick();
      if (price != null && cb) cb(price);
      e.stopPropagation(); e.preventDefault();
      return;
    }

    const h = hitTest(x, y);
    if (!h) return;

    if (h.kind === 'close') {
      e.stopPropagation(); e.preventDefault();
      Replay.closeOne(h.id);
      return;
    }
    if (h.kind === 'entry') return; // entry price is not draggable
    drag = { kind: h.kind, id: h.id };
    setCursor('ns-resize');
    e.stopPropagation(); e.preventDefault();
  }

  function onUp(e) {
    if (!drag) { if (pick) return; return; }
    const d = drag;
    drag = null;
    const b = Replay.broker && Replay.broker();
    const p = b && b.positions.find(x => x.id === d.id);
    if (p) {
      const dg = (ChartMgr.symInfo || {}).digits ?? 5;
      window.App && window.App.toast(
        `${d.kind === 'sl' ? 'Stop loss' : 'Take profit'} moved to ${(d.kind === 'sl' ? p.sl : p.tp).toFixed(dg)}`, 'ok');
    }
    window.App && window.App.refreshSessionUI && window.App.refreshSessionUI();
  }

  /** Move the dragged bracket, keeping it on the valid side of the entry. */
  function applyDrag(price) {
    const b = Replay.broker && Replay.broker();
    if (!b) return;
    const p = b.positions.find(x => x.id === drag.id);
    if (!p) { drag = null; return; }
    const tick = Math.pow(10, -((ChartMgr.symInfo || {}).digits ?? 5));
    if (drag.kind === 'sl') {
      // long: stop must sit below entry; short: above
      p.sl = p.dir > 0 ? Math.min(price, p.entry - tick) : Math.max(price, p.entry + tick);
    } else {
      p.tp = p.dir > 0 ? Math.max(price, p.entry + tick) : Math.min(price, p.entry - tick);
    }
  }

  // -------------------------------------------------------------- painting
  function loop() {
    raf = requestAnimationFrame(loop);
    render();
  }

  function clear() {
    if (ctx) ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  }

  function money(v) {
    const n = Number(v) || 0, a = Math.abs(n);
    const s = n < 0 ? '-' : '';
    if (a >= 1000) return s + '$' + a.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return s + '$' + a.toFixed(a < 10 ? 2 : 1);
  }

  function plate(x, y, text, opts = {}) {
    ctx.font = opts.font || LABEL_F;
    const padX = opts.padX ?? 7, h = opts.h ?? 18;
    const w = ctx.measureText(text).width + padX * 2;
    const align = opts.align || 'left';
    const px = align === 'right' ? x - w : x;
    ctx.fillStyle = opts.bg || C.plate;
    roundRect(px, y - h / 2, w, h, 4);
    ctx.fill();
    if (opts.border) { ctx.strokeStyle = opts.border; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.fillStyle = opts.fg || C.text;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px + padX, y + 0.5);
    return { x: px, y: y - h / 2, w, h };
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function dashed(x0, x1, y, color, width) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = color; ctx.lineWidth = width || 1;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.restore();
  }

  function render() {
    if (!ctx || !enabled || !ChartMgr.chart) { clear(); return; }
    clear();

    const b = Replay.broker && Replay.broker();
    const bar = Replay.currentBar && Replay.currentBar();
    if (!b || !bar) return;
    const info = ChartMgr.symInfo || {};
    const dg = info.digits ?? 5;
    const pip = info.pip || 0.0001;
    const units = info.lotUnits || 100000;

    // ---- pending order preview (from the ticket) ----
    if (preview) drawPreview(preview, dg, pip, units);

    // ---- live positions ----
    for (const p of b.positions) {
      const L = layout(p);
      if (!L) continue;
      const isLong = p.dir > 0;
      const pnl = b.posPnl(p, bar.close);
      const pips = (isLong ? (bar.close - p.entry) : (p.entry - (bar.close + b.spreadPrice))) / pip;

      const riskCash = p.sl != null ? Math.abs(p.entry - p.sl) * p.lots * units : null;
      const rewardCash = p.tp != null ? Math.abs(p.tp - p.entry) * p.lots * units : null;
      const rr = (riskCash && rewardCash) ? rewardCash / riskCash : null;
      const rMult = riskCash ? pnl / riskCash : null;

      const hovered = hover && hover.id === p.id;

      // zones
      if (L.ySL != null) {
        ctx.fillStyle = C.risk;
        ctx.fillRect(L.x0, Math.min(L.yE, L.ySL), L.x1 - L.x0, Math.abs(L.ySL - L.yE));
      }
      if (L.yTP != null) {
        ctx.fillStyle = C.reward;
        ctx.fillRect(L.x0, Math.min(L.yE, L.yTP), L.x1 - L.x0, Math.abs(L.yTP - L.yE));
      }

      // entry line
      ctx.save();
      ctx.strokeStyle = isLong ? C.longLine : C.shortLine;
      ctx.lineWidth = hovered && hover.kind === 'entry' ? 2 : 1.4;
      ctx.beginPath(); ctx.moveTo(L.x0, L.yE); ctx.lineTo(L.x1, L.yE); ctx.stroke();
      ctx.restore();

      // stop / target lines + handles
      if (L.ySL != null) {
        const on = hovered && hover.kind === 'sl';
        dashed(L.x0, L.x1, L.ySL, C.riskLine, on || (drag && drag.id === p.id && drag.kind === 'sl') ? 2 : 1.2);
        drawGrip(L.x1 - 30, L.ySL, C.riskLine, on);
      }
      if (L.yTP != null) {
        const on = hovered && hover.kind === 'tp';
        dashed(L.x0, L.x1, L.yTP, C.rewardLine, on || (drag && drag.id === p.id && drag.kind === 'tp') ? 2 : 1.2);
        drawGrip(L.x1 - 30, L.yTP, C.rewardLine, on);
      }

      // ---- labels ----
      // entry label on the left: side, lots, live P/L
      const sideTxt = `${isLong ? 'LONG' : 'SHORT'} ${p.lots}`;
      const pnlTxt = `${pnl >= 0 ? '+' : ''}${money(pnl)}`;
      const extra = `${pips >= 0 ? '+' : ''}${pips.toFixed(pip >= 1 ? 1 : 1)} pips` +
        (rMult != null && isFinite(rMult) ? `  ·  ${rMult >= 0 ? '+' : ''}${rMult.toFixed(2)}R` : '');

      ctx.font = LABEL_F;
      const sideW = ctx.measureText(sideTxt).width;
      const pnlW = ctx.measureText(pnlTxt).width;
      const boxW = sideW + pnlW + 30;
      const boxH = 34;
      const bx = L.x0 + 4, by = L.yE - boxH - 4;
      ctx.fillStyle = 'rgba(11,13,16,.9)';
      roundRect(bx, by, boxW, boxH, 5); ctx.fill();
      ctx.strokeStyle = isLong ? 'rgba(38,208,165,.5)' : 'rgba(242,97,92,.5)';
      ctx.lineWidth = 1; ctx.stroke();
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isLong ? C.longLine : C.shortLine;
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText(sideTxt, bx + 8, by + 11);
      ctx.fillStyle = pnl >= 0 ? C.rewardLine : C.riskLine;
      ctx.fillText(pnlTxt, bx + 8 + sideW + 12, by + 11);
      ctx.fillStyle = C.dim;
      ctx.font = SMALL_F;
      ctx.fillText(extra, bx + 8, by + 24);

      // price plates on the right
      plate(L.x1 - 26, L.yE, p.entry.toFixed(dg), {
        align: 'right', bg: isLong ? 'rgba(38,208,165,.9)' : 'rgba(242,97,92,.9)',
        fg: '#07110f',
      });
      if (L.ySL != null) {
        plate(L.x1 - 44, L.ySL, `SL ${p.sl.toFixed(dg)}${riskCash != null ? '  −' + money(riskCash) : ''}`,
          { align: 'right', bg: 'rgba(242,97,92,.92)', fg: '#2a0908' });
      }
      if (L.yTP != null) {
        plate(L.x1 - 44, L.yTP, `TP ${p.tp.toFixed(dg)}${rewardCash != null ? '  +' + money(rewardCash) : ''}` +
          (rr ? `  ·  ${rr.toFixed(2)}R` : ''),
          { align: 'right', bg: 'rgba(38,208,165,.92)', fg: '#04231b' });
      }

      // close button
      const r = closeBtnRect(p, L);
      const hoverClose = hovered && hover.kind === 'close';
      ctx.fillStyle = hoverClose ? 'rgba(242,97,92,.95)' : 'rgba(35,40,48,.95)';
      roundRect(r.x, r.y, r.w, r.h, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.strokeStyle = hoverClose ? '#fff' : C.dim; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(r.x + 4.5, r.y + 4.5); ctx.lineTo(r.x + r.w - 4.5, r.y + r.h - 4.5);
      ctx.moveTo(r.x + r.w - 4.5, r.y + 4.5); ctx.lineTo(r.x + 4.5, r.y + r.h - 4.5);
      ctx.stroke();
    }
  }

  function drawGrip(x, y, color, on) {
    ctx.save();
    ctx.fillStyle = on ? color : 'rgba(11,13,16,.9)';
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    roundRect(x - 9, y - 4, 18, 8, 3);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = on ? '#0b0d10' : color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 1.5); ctx.lineTo(x + 3, y - 1.5);
    ctx.moveTo(x - 3, y + 1.5); ctx.lineTo(x + 3, y + 1.5);
    ctx.stroke();
    ctx.restore();
  }

  function drawPreview(pv, dg, pip, units) {
    const yE = priceY(pv.entry);
    if (yE == null) return;
    const x1 = plotRight();
    const x0 = Math.max(0, x1 - 260);
    const isLong = pv.dir > 0;
    const ySL = pv.sl != null ? priceY(pv.sl) : null;
    const yTP = pv.tp != null ? priceY(pv.tp) : null;

    ctx.save();
    ctx.globalAlpha = 0.85;
    if (ySL != null) {
      ctx.fillStyle = 'rgba(242, 97, 92, 0.09)';
      ctx.fillRect(x0, Math.min(yE, ySL), x1 - x0, Math.abs(ySL - yE));
      dashed(x0, x1, ySL, 'rgba(242,97,92,.7)', 1);
      const risk = Math.abs(pv.entry - pv.sl) * pv.lots * units;
      plate(x1 - 44, ySL, `SL ${pv.sl.toFixed(dg)}  −${money(risk)}`,
        { align: 'right', bg: 'rgba(242,97,92,.75)', fg: '#2a0908', h: 17 });
    }
    if (yTP != null) {
      ctx.fillStyle = 'rgba(38, 208, 165, 0.09)';
      ctx.fillRect(x0, Math.min(yE, yTP), x1 - x0, Math.abs(yTP - yE));
      dashed(x0, x1, yTP, 'rgba(38,208,165,.7)', 1);
      const rw = Math.abs(pv.tp - pv.entry) * pv.lots * units;
      plate(x1 - 44, yTP, `TP ${pv.tp.toFixed(dg)}  +${money(rw)}`,
        { align: 'right', bg: 'rgba(38,208,165,.75)', fg: '#04231b', h: 17 });
    }
    dashed(x0, x1, yE, isLong ? 'rgba(38,208,165,.8)' : 'rgba(242,97,92,.8)', 1.3);
    plate(x0 + 4, yE - 12, `PENDING ${isLong ? 'BUY' : 'SELL'} ${pv.lots}`,
      { bg: 'rgba(11,13,16,.85)', fg: C.dim, font: SMALL_F, h: 16 });
    ctx.restore();
  }

  return {
    init, setEnabled, setPreview, clearPreview,
    startPick, cancelPick, isPicking,
    get dragging() { return !!drag; },
  };
})();

window.TradeOverlay = TradeOverlay;
