// ===========================================================================
// Drawing tools — overlay canvas synced to Lightweight Charts coordinates.
// Tools: trendline, ray, hline, vline, rect, fib, brush, text, ruler,
//        long/short position. Drawings anchored in (time, price) space.
// Select / drag / delete. Persisted per symbol+tf in localStorage.
// ===========================================================================
const Draw = (() => {
  let canvas, ctx, chartWrap;
  let tool = 'cursor';
  let drawings = [];          // {type, points:[{t,p}], text?, color}
  let pending = null;         // in-progress drawing
  let selected = -1;
  let dragging = null;        // {idx, pointIdx | 'all', startT, startP, orig}
  let magnet = false;
  let storeKey = 'draw:EURUSD:1h';

  const COLOR = '#ffffff';
  const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

  function init(canvasEl, wrapEl) {
    canvas = canvasEl; ctx = canvas.getContext('2d'); chartWrap = wrapEl;
    const ro = new ResizeObserver(resize); ro.observe(chartWrap);
    resize();

    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onUp);
    canvas.addEventListener('dblclick', onDbl);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected >= 0 && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
          drawings.splice(selected, 1); selected = -1; save(); render();
        }
      }
      if (e.key === 'Escape') { pending = null; setTool('cursor'); render(); }
    });

    // re-render when chart pans/zooms
    const loop = () => { render(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  function resize() {
    const r = chartWrap.getBoundingClientRect();
    canvas.width = r.width * devicePixelRatio;
    canvas.height = r.height * devicePixelRatio;
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function setStoreKey(k) {
    storeKey = 'draw:' + k;
    try { drawings = JSON.parse(localStorage.getItem(storeKey) || '[]'); } catch (e) { drawings = []; }
    selected = -1; pending = null;
    render();
  }
  function save() { try { localStorage.setItem(storeKey, JSON.stringify(drawings)); } catch (e) {} }

  function setTool(t) {
    tool = t;
    pending = null;
    canvas.classList.toggle('drawing', t !== 'cursor');
    document.querySelectorAll('.draw-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  }

  function toggleMagnet() { magnet = !magnet; return magnet; }

  // ---------- coordinate transforms ----------
  function t2x(t) { return ChartMgr.chart.timeScale().timeToCoordinate(t); }
  function p2y(p) { return ChartMgr.series.priceToCoordinate(p); }
  function x2t(x) {
    const ts = ChartMgr.chart.timeScale();
    const t = ts.coordinateToTime(x);
    if (t !== null) return t;
    // beyond data edge: extrapolate using visible logical range
    const lr = ts.getVisibleLogicalRange();
    if (!lr) return null;
    const c = ChartMgr.candles;
    if (c.length < 2) return null;
    const barW = canvas.clientWidth / (lr.to - lr.from);
    const logical = lr.from + x / barW;
    const tfSec = c[1].time - c[0].time;
    return c[0].time + Math.round(logical) * tfSec;
  }
  function y2p(y) { return ChartMgr.series.coordinateToPrice(y); }

  function snap(t, p) {
    if (!magnet) return { t, p };
    const c = ChartMgr.candles;
    if (!c.length) return { t, p };
    // find nearest candle by time
    let lo = 0, hi = c.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (c[mid].time < t) lo = mid + 1; else hi = mid; }
    const cd = c[Math.max(0, Math.min(lo, c.length - 1))];
    const vals = [cd.open, cd.high, cd.low, cd.close];
    let best = vals[0];
    for (const v of vals) if (Math.abs(v - p) < Math.abs(best - p)) best = v;
    return { t: cd.time, p: best };
  }

  // ---------- mouse handlers ----------
  function evPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onDown(e) {
    const { x, y } = evPos(e);
    const t = x2t(x), p = y2p(y);
    if (t === null || p === null) return;

    if (tool === 'cursor') return; // canvas has pointer-events none in cursor mode anyway

    if (tool === 'select') {
      return;
    }

    const s = snap(t, p);

    if (tool === 'hline') { drawings.push({ type: 'hline', points: [{ t: s.t, p: s.p }], color: COLOR }); save(); setTool('cursor'); return; }
    if (tool === 'vline') { drawings.push({ type: 'vline', points: [{ t: s.t, p: s.p }], color: COLOR }); save(); setTool('cursor'); return; }
    if (tool === 'text') {
      const txt = prompt('Text:');
      if (txt) { drawings.push({ type: 'text', points: [{ t: s.t, p: s.p }], text: txt, color: COLOR }); save(); }
      setTool('cursor'); return;
    }
    if (tool === 'brush') {
      pending = { type: 'brush', points: [{ t: s.t, p: s.p }], color: COLOR };
      return;
    }
    if (tool === 'longpos' || tool === 'shortpos') {
      // one click: entry at click, SL/TP auto at ±1R (visual), draggable afterwards conceptually
      const c = ChartMgr.candles;
      const atrApprox = c.length > 15 ? Math.abs(c[c.length - 1].close - c[c.length - 15].close) / 3 || p * 0.005 : p * 0.005;
      const dir = tool === 'longpos' ? 1 : -1;
      drawings.push({ type: tool, points: [{ t: s.t, p: s.p }, { t: s.t, p: s.p - dir * atrApprox }, { t: s.t, p: s.p + dir * atrApprox * 2 }], color: COLOR });
      save(); setTool('cursor'); return;
    }

    // two-point tools
    if (!pending) {
      pending = { type: tool, points: [{ t: s.t, p: s.p }, { t: s.t, p: s.p }], color: COLOR };
    }
  }

  function onMove(e) {
    const { x, y } = evPos(e);
    if (pending) {
      const t = x2t(x), p = y2p(y);
      if (t === null || p === null) return;
      const s = snap(t, p);
      if (pending.type === 'brush') pending.points.push({ t: s.t, p: s.p });
      else pending.points[1] = { t: s.t, p: s.p };
    }
  }

  function onUp(e) {
    if (!pending) return;
    const { x, y } = evPos(e);
    const t = x2t(x), p = y2p(y);
    if (pending.type === 'brush') {
      drawings.push(pending); pending = null; save(); setTool('cursor'); return;
    }
    if (t !== null && p !== null) {
      const s = snap(t, p);
      pending.points[1] = { t: s.t, p: s.p };
      // ignore zero-length drags
      if (pending.points[0].t !== pending.points[1].t || pending.points[0].p !== pending.points[1].p) {
        drawings.push(pending); save();
      }
    }
    pending = null;
    if (tool !== 'brush') setTool('cursor');
  }

  function onDbl(e) {
    // double-click near a drawing selects & offers delete
    const { x, y } = evPos(e);
    const idx = hitTest(x, y);
    if (idx >= 0) { selected = idx; render(); }
  }

  function hitTest(x, y) {
    for (let i = drawings.length - 1; i >= 0; i--) {
      const d = drawings[i];
      const pts = d.points.map(pt => ({ x: t2x(pt.t), y: p2y(pt.p) }));
      if (pts.some(pt => pt.x === null || pt.y === null)) continue;
      if (d.type === 'hline' && Math.abs(y - pts[0].y) < 6) return i;
      if (d.type === 'vline' && Math.abs(x - pts[0].x) < 6) return i;
      if ((d.type === 'trendline' || d.type === 'ray' || d.type === 'ruler') && pts.length === 2) {
        if (distToSeg(x, y, pts[0], pts[1]) < 6) return i;
      }
      if (d.type === 'rect' && pts.length === 2) {
        const x0 = Math.min(pts[0].x, pts[1].x), x1 = Math.max(pts[0].x, pts[1].x);
        const y0 = Math.min(pts[0].y, pts[1].y), y1 = Math.max(pts[0].y, pts[1].y);
        if (x >= x0 - 4 && x <= x1 + 4 && y >= y0 - 4 && y <= y1 + 4) return i;
      }
      if (d.type === 'text' && Math.abs(x - pts[0].x) < 40 && Math.abs(y - pts[0].y) < 12) return i;
      if (d.type === 'fib' && pts.length === 2) {
        const x0 = Math.min(pts[0].x, pts[1].x), x1 = Math.max(pts[0].x, pts[1].x);
        if (x >= x0 && x <= x1 && y >= Math.min(pts[0].y, pts[1].y) - 6 && y <= Math.max(pts[0].y, pts[1].y) + 6) return i;
      }
    }
    return -1;
  }

  function distToSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }

  // ---------- rendering ----------
  function render() {
    if (!ctx || !ChartMgr.chart) return;
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    const all = pending ? [...drawings, pending] : drawings;
    all.forEach((d, i) => drawOne(d, i === selected));
  }

  function drawOne(d, isSel) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const pts = d.points.map(pt => ({ x: t2x(pt.t), y: p2y(pt.p) }));
    ctx.strokeStyle = d.color; ctx.fillStyle = d.color;
    ctx.lineWidth = isSel ? 2 : 1.2;
    ctx.setLineDash([]);

    const P0 = pts[0], P1 = pts[1];

    switch (d.type) {
      case 'hline': {
        if (P0.y === null) return;
        ctx.beginPath(); ctx.moveTo(0, P0.y); ctx.lineTo(w, P0.y); ctx.stroke();
        ctx.font = '10px sans-serif';
        ctx.fillText(fmtPrice(d.points[0].p), 6, P0.y - 4);
        break;
      }
      case 'vline': {
        if (P0.x === null) return;
        ctx.beginPath(); ctx.moveTo(P0.x, 0); ctx.lineTo(P0.x, h); ctx.stroke();
        break;
      }
      case 'trendline': {
        if (!valid(pts)) return;
        line(P0, P1);
        handles(pts, isSel);
        break;
      }
      case 'ray': {
        if (!valid(pts)) return;
        const dx = P1.x - P0.x, dy = P1.y - P0.y;
        const scale = dx !== 0 ? (w - P0.x) / dx : 0;
        const ex = dx !== 0 ? w : P0.x, ey = dx !== 0 ? P0.y + dy * scale : (dy > 0 ? h : 0);
        line(P0, { x: ex, y: ey });
        handles([P0], isSel);
        break;
      }
      case 'rect': {
        if (!valid(pts)) return;
        const x0 = Math.min(P0.x, P1.x), y0 = Math.min(P0.y, P1.y);
        ctx.globalAlpha = 0.12;
        ctx.fillRect(x0, y0, Math.abs(P1.x - P0.x), Math.abs(P1.y - P0.y));
        ctx.globalAlpha = 1;
        ctx.strokeRect(x0, y0, Math.abs(P1.x - P0.x), Math.abs(P1.y - P0.y));
        handles(pts, isSel);
        break;
      }
      case 'fib': {
        if (!valid(pts)) return;
        const x0 = Math.min(P0.x, P1.x), x1 = Math.max(P0.x, P1.x);
        const pA = d.points[0].p, pB = d.points[1].p;
        ctx.font = '10px sans-serif';
        for (const lv of FIB_LEVELS) {
          const price = pA + (pB - pA) * lv;
          const yy = p2y(price);
          if (yy === null) continue;
          ctx.globalAlpha = lv === 0 || lv === 1 ? 0.9 : 0.55;
          ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke();
          ctx.fillText(lv.toFixed(3) + '  ' + fmtPrice(price), x1 + 4, yy + 3);
        }
        ctx.globalAlpha = 1;
        handles(pts, isSel);
        break;
      }
      case 'brush': {
        ctx.beginPath();
        let started = false;
        for (const pt of pts) {
          if (pt.x === null || pt.y === null) continue;
          if (!started) { ctx.moveTo(pt.x, pt.y); started = true; }
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
        break;
      }
      case 'text': {
        if (P0.x === null || P0.y === null) return;
        ctx.font = '13px sans-serif';
        ctx.fillText(d.text || '', P0.x, P0.y);
        if (isSel) { ctx.strokeStyle = '#888'; ctx.strokeRect(P0.x - 3, P0.y - 14, ctx.measureText(d.text || '').width + 6, 18); }
        break;
      }
      case 'ruler': {
        if (!valid(pts)) return;
        ctx.setLineDash([4, 3]);
        line(P0, P1);
        ctx.setLineDash([]);
        const dp = d.points[1].p - d.points[0].p;
        const pct = (dp / d.points[0].p * 100).toFixed(2);
        const bars = Math.round((d.points[1].t - d.points[0].t) / barSec());
        const midX = (P0.x + P1.x) / 2, midY = (P0.y + P1.y) / 2;
        const label = `${fmtPrice(dp)} (${pct}%)  ${bars} bars`;
        ctx.font = '11px sans-serif';
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = dp >= 0 ? 'rgba(38,166,154,.85)' : 'rgba(239,83,80,.85)';
        ctx.fillRect(midX - tw / 2 - 6, midY - 10, tw + 12, 20);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, midX - tw / 2, midY + 4);
        break;
      }
      case 'longpos': case 'shortpos': {
        // points: [entry, stop, target]
        const [E, S, T] = pts;
        if (!E || E.x === null) return;
        const x0 = E.x, x1 = Math.min(E.x + 140, w);
        const eP = d.points[0].p, sP = d.points[1].p, tP = d.points[2].p;
        const yE = E.y, yS = p2y(sP), yT = p2y(tP);
        if (yE === null || yS === null || yT === null) return;
        // risk zone (red), reward zone (green)
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = '#ef5350';
        ctx.fillRect(x0, Math.min(yE, yS), x1 - x0, Math.abs(yS - yE));
        ctx.fillStyle = '#26a69a';
        ctx.fillRect(x0, Math.min(yE, yT), x1 - x0, Math.abs(yT - yE));
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#aaaaaa';
        ctx.strokeRect(x0, Math.min(yE, yS), x1 - x0, Math.abs(yS - yE));
        ctx.strokeRect(x0, Math.min(yE, yT), x1 - x0, Math.abs(yT - yE));
        const rr = Math.abs(tP - eP) / Math.abs(eP - sP || 1);
        ctx.fillStyle = '#fff'; ctx.font = '10.5px sans-serif';
        ctx.fillText(`${d.type === 'longpos' ? 'LONG' : 'SHORT'}  RR ${rr.toFixed(2)}`, x0 + 4, yE - 4);
        break;
      }
    }
  }

  function valid(pts) { return pts.every(pt => pt.x !== null && pt.y !== null); }
  function line(a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  function handles(pts, isSel) {
    if (!isSel) return;
    ctx.fillStyle = '#fff';
    for (const pt of pts) { ctx.beginPath(); ctx.arc(pt.x, pt.y, 4, 0, 7); ctx.fill(); }
  }
  function barSec() {
    const c = ChartMgr.candles;
    return c.length > 1 ? c[1].time - c[0].time : 60;
  }
  function fmtPrice(p) {
    const d = window.App?.currentSymbolInfo?.digits ?? 5;
    return Number(p).toFixed(Math.min(d, 6));
  }

  function deleteSelected() { if (selected >= 0) { drawings.splice(selected, 1); selected = -1; save(); } }
  function deleteAll() { drawings = []; selected = -1; save(); render(); }

  return { init, setTool, setStoreKey, toggleMagnet, deleteSelected, deleteAll, get tool() { return tool; } };
})();

window.Draw = Draw;
