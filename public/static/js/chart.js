// ===========================================================================
// Chart manager — TradingView Lightweight Charts, dark surface theme.
//
// Design notes (these solve the "candles behave weirdly in replay" bugs):
//   * setData() only auto-fits the view when explicitly asked. During a replay
//     session we append bars, and re-fitting on every render made the candles
//     shrink and jump around every few bars.
//   * appendBar() updates the candle, the volume bar and every active indicator
//     incrementally (one .update() per series) instead of rebuilding the whole
//     dataset, so playback stays smooth at 30x.
//   * truncate() (step-back) restores the exact visible logical range.
//   * Price lines are diffed by key, so stepping a bar no longer destroys and
//     recreates every stop/target line (that was the flicker).
// ===========================================================================
const ChartMgr = (() => {
  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  const indicatorSeries = new Map();   // defId -> [series...]
  const activeIndicators = new Set();
  let candles = [];                    // currently displayed candles
  let symInfo = null;
  let lastIndicatorPaint = 0;

  // price lines, diffed by key so we never churn the whole set
  const priceLineMap = new Map();      // key -> { line, spec }

  const VOL_UP = 'rgba(38, 208, 165, 0.30)';
  const VOL_DN = 'rgba(242, 97, 92, 0.30)';

  const THEME = {
    layout: {
      background: { type: 'solid', color: '#0b0d10' }, textColor: '#8b949e', fontSize: 11,
      fontFamily: "'Inter', -apple-system, sans-serif",
    },
    grid: { vertLines: { color: 'rgba(255,255,255,.035)' }, horzLines: { color: 'rgba(255,255,255,.035)' } },
    crosshair: {
      mode: 0,
      vertLine: { color: 'rgba(140,150,165,.55)', width: 1, style: 3, labelBackgroundColor: '#1c2128' },
      horzLine: { color: 'rgba(140,150,165,.55)', width: 1, style: 3, labelBackgroundColor: '#1c2128' },
    },
    rightPriceScale: { borderColor: 'rgba(255,255,255,.07)', scaleMargins: { top: 0.08, bottom: 0.24 } },
    timeScale: {
      borderColor: 'rgba(255,255,255,.07)', timeVisible: true, secondsVisible: false,
      rightOffset: 8, barSpacing: 8, minBarSpacing: 0.5,
      shiftVisibleRangeOnNewBar: true,
    },
    handleScale: { axisPressedMouseMove: { time: true, price: true } },
    localization: { dateFormat: 'yyyy-MM-dd' },
  };

  function init(container) {
    chart = LightweightCharts.createChart(container, { ...THEME, autoSize: true });
    candleSeries = chart.addCandlestickSeries({
      upColor: '#26d0a5', downColor: '#f2615c',
      wickUpColor: '#26d0a5', wickDownColor: '#f2615c',
      borderUpColor: '#26d0a5', borderDownColor: '#f2615c',
      priceLineVisible: true, priceLineWidth: 1, priceLineStyle: 2,
      priceLineColor: 'rgba(164,173,186,.55)',
    });
    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      lastValueVisible: false, priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    applyMainMargins();
    return chart;
  }

  function hasSubPane() {
    return [...activeIndicators].some(id => INDICATOR_DEFS.find(d => d.id === id)?.pane === 'sub');
  }
  function applyMainMargins() {
    candleSeries.priceScale().applyOptions({
      scaleMargins: hasSubPane() ? { top: 0.07, bottom: 0.34 } : { top: 0.07, bottom: 0.24 },
    });
  }

  // ---------------------------------------------------------------- data ----
  function volPoint(c) {
    return { time: c.time, value: c.volume || 0, color: c.close >= c.open ? VOL_UP : VOL_DN };
  }

  /**
   * Replace the whole dataset.
   * @param {object} opts { fit:boolean, keepView:boolean, lastBars:number }
   *   fit       – fit all bars (default when no other view option given)
   *   keepView  – restore the visible logical range that was active before
   *   lastBars  – show only the N most recent bars
   */
  function setData(newCandles, info, opts = {}) {
    const prevRange = chart.timeScale().getVisibleLogicalRange();
    candles = newCandles || [];
    if (info) symInfo = info;
    const digits = symInfo?.digits ?? 5;
    candleSeries.applyOptions({
      priceFormat: { type: 'price', precision: digits, minMove: Math.pow(10, -digits) },
    });
    candleSeries.setData(candles);
    volumeSeries.setData(candles.map(volPoint));
    paintIndicators();

    if (opts.lastBars) setViewLastBars(opts.lastBars);
    else if (opts.keepView && prevRange) {
      try { chart.timeScale().setVisibleLogicalRange(prevRange); } catch (_) {}
    } else if (opts.fit !== false) {
      chart.timeScale().fitContent();
    }
  }

  /** Show only the last N bars, keeping the standard right margin. */
  function setViewLastBars(n) {
    const len = candles.length;
    if (!len) return;
    const from = Math.max(0, len - Math.max(20, n));
    try {
      chart.timeScale().setVisibleLogicalRange({ from, to: len - 1 + 8 });
    } catch (_) {
      chart.timeScale().fitContent();
    }
  }

  /** Is the newest bar currently in view? Used to decide whether to auto-scroll. */
  function isAtRightEdge() {
    const lr = chart.timeScale().getVisibleLogicalRange();
    if (!lr || !candles.length) return true;
    return lr.to >= candles.length - 2;
  }

  /**
   * Append (or update) the newest bar. `candles` must already be the array the
   * bar belongs to — replay pushes into its own array and passes it in.
   * @param {object} opts { indicators:boolean, follow:boolean }
   */
  function appendBar(bar, opts = {}) {
    if (!bar) return;
    const follow = opts.follow !== false && isAtRightEdge();
    const last = candles[candles.length - 1];
    if (!last || bar.time > last.time) candles.push(bar);
    else if (bar.time === last.time) candles[candles.length - 1] = bar;
    else return; // out of order — ignore rather than corrupt the series

    candleSeries.update(bar);
    volumeSeries.update(volPoint(bar));

    if (opts.indicators !== false) paintIndicatorTail();
    if (follow) {
      // Keep a margin of blank space to the right, but scale it to the zoom.
      // A fixed eight bars is fine across a wide view and shoves price into the
      // left edge when you are looking at ten candles.
      try {
        const r = chart.timeScale().getVisibleLogicalRange();
        const span = r ? Math.max(1, r.to - r.from) : 60;
        chart.timeScale().scrollToPosition(Math.max(1, Math.min(8, Math.round(span * 0.12))), false);
      } catch (_) {}
    }
  }

  /**
   * Shrink the dataset to `len` bars (replay step-back) without losing the view.
   */
  function truncate(newCandles) {
    const lr = chart.timeScale().getVisibleLogicalRange();
    candles = newCandles;
    candleSeries.setData(candles);
    volumeSeries.setData(candles.map(volPoint));
    paintIndicators();
    if (lr) {
      try { chart.timeScale().setVisibleLogicalRange(lr); } catch (_) {}
    }
  }

  // ---------------------------------------------------------- indicators ----
  function toggleIndicator(defId) {
    if (activeIndicators.has(defId)) { removeIndicator(defId); return false; }
    activeIndicators.add(defId);
    renderIndicator(defId);
    applyMainMargins();
    return true;
  }

  function seriesOptsFor(def, ln) {
    const base = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
    if (def.pane === 'sub') return { ...base, priceScaleId: 'sub-' + def.id };
    return base;
  }

  function renderIndicator(defId) {
    const def = INDICATOR_DEFS.find(d => d.id === defId);
    if (!def) return;
    removeSeriesFor(defId);
    if (!candles.length) { indicatorSeries.set(defId, []); return; }

    let lines;
    try { lines = def.calc(candles) || []; }
    catch (e) { console.warn('[indicator]', defId, e); return; }

    const arr = [];
    for (const ln of lines) {
      const opts = seriesOptsFor(def, ln);
      const s = ln.style === 'histogram'
        ? chart.addHistogramSeries({ color: ln.color, ...opts })
        : chart.addLineSeries({ color: ln.color, lineWidth: 1.5, ...opts });
      const data = [];
      for (let i = 0; i < candles.length; i++) {
        const v = ln.data[i];
        if (v != null && !isNaN(v)) data.push({ time: candles[i].time, value: v });
      }
      s.setData(data);
      arr.push(s);
    }
    if (def.pane === 'sub') {
      chart.priceScale('sub-' + defId).applyOptions({ scaleMargins: { top: 0.78, bottom: 0.01 } });
    }
    indicatorSeries.set(defId, arr);
  }

  function removeSeriesFor(defId) {
    const arr = indicatorSeries.get(defId);
    if (arr) {
      arr.forEach(s => { try { chart.removeSeries(s); } catch (e) {} });
      indicatorSeries.delete(defId);
    }
  }

  function removeIndicator(defId) {
    activeIndicators.delete(defId);
    removeSeriesFor(defId);
    applyMainMargins();
  }

  function paintIndicators() {
    for (const id of activeIndicators) renderIndicator(id);
    applyMainMargins();
    lastIndicatorPaint = performance.now();
  }

  /**
   * Incremental indicator refresh: recompute the definition and push only the
   * newest point into each series. Orders of magnitude cheaper than setData and
   * it is what keeps 30x playback fluid.
   */
  function paintIndicatorTail() {
    if (!activeIndicators.size || !candles.length) return;
    const i = candles.length - 1;
    for (const id of activeIndicators) {
      const def = INDICATOR_DEFS.find(d => d.id === id);
      const arr = indicatorSeries.get(id);
      if (!def || !arr || !arr.length) { renderIndicator(id); continue; }
      let lines;
      try { lines = def.calc(candles) || []; } catch (_) { continue; }
      for (let k = 0; k < arr.length && k < lines.length; k++) {
        const v = lines[k].data[i];
        if (v != null && !isNaN(v)) {
          try { arr[k].update({ time: candles[i].time, value: v }); } catch (_) {}
        }
      }
    }
    lastIndicatorPaint = performance.now();
  }

  function refreshIndicators() { paintIndicators(); }

  // ------------------------------------------------------------- markers ----
  // Two independent layers — trades and news — merged on every update so
  // toggling one never wipes the other.
  let tradeMarkers = [];
  let newsMarkers = [];
  let markerDirty = false;

  function applyMarkers() {
    const all = tradeMarkers.concat(newsMarkers);
    all.sort((a, b) => a.time - b.time);
    candleSeries.setMarkers(all);
    markerDirty = false;
  }
  function setMarkers(m) { tradeMarkers = m || []; applyMarkers(); }
  function setTradeMarkers(m) { tradeMarkers = m || []; applyMarkers(); }
  function setNewsMarkers(m) { newsMarkers = m || []; applyMarkers(); }
  function clearNewsMarkers() { newsMarkers = []; applyMarkers(); }
  function getNewsMarkers() { return newsMarkers; }

  /** Mark markers dirty without touching the chart (batched by the caller). */
  function queueMarkers(m) { tradeMarkers = m || tradeMarkers; markerDirty = true; }
  function flushMarkers() { if (markerDirty) applyMarkers(); }

  // ---------------------------------------------------------- price lines ----
  /**
   * Declarative price lines. Pass the full desired set; only the differences
   * are applied to the chart.
   * @param {Array<{key,price,color,title,style,width}>} specs
   */
  function syncPriceLines(specs) {
    const wanted = new Map();
    for (const s of specs || []) wanted.set(s.key, s);

    for (const [key, rec] of [...priceLineMap]) {
      if (!wanted.has(key)) {
        try { candleSeries.removePriceLine(rec.line); } catch (_) {}
        priceLineMap.delete(key);
      }
    }
    for (const [key, spec] of wanted) {
      const rec = priceLineMap.get(key);
      const opts = {
        price: spec.price,
        color: spec.color,
        lineWidth: spec.width || 1,
        lineStyle: spec.style == null ? 2 : spec.style,
        axisLabelVisible: spec.axisLabelVisible !== false,
        title: spec.title || '',
      };
      if (!rec) {
        priceLineMap.set(key, { line: candleSeries.createPriceLine(opts), spec });
      } else if (rec.spec.price !== spec.price || rec.spec.title !== spec.title ||
                 rec.spec.color !== spec.color || rec.spec.style !== spec.style) {
        try { rec.line.applyOptions(opts); rec.spec = spec; } catch (_) {}
      }
    }
  }

  function clearPriceLines() {
    for (const [, rec] of priceLineMap) { try { candleSeries.removePriceLine(rec.line); } catch (_) {} }
    priceLineMap.clear();
  }

  // legacy helper kept so older call sites keep working
  function addPriceLine(price, color, title, style = 2) {
    const line = candleSeries.createPriceLine({
      price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title,
    });
    priceLineMap.set('legacy:' + priceLineMap.size, { line, spec: { price, color, title, style } });
    return line;
  }

  // ------------------------------------------------------------ geometry ----
  function timeToX(t) { try { return chart.timeScale().timeToCoordinate(t); } catch (_) { return null; } }
  function priceToY(p) { try { return candleSeries.priceToCoordinate(p); } catch (_) { return null; } }
  function yToPrice(y) { try { return candleSeries.coordinateToPrice(y); } catch (_) { return null; } }
  function xToTime(x) { try { return chart.timeScale().coordinateToTime(x); } catch (_) { return null; } }

  return {
    init, setData, appendBar, truncate, setViewLastBars, isAtRightEdge,
    toggleIndicator, removeIndicator, refreshIndicators, paintIndicatorTail,
    setMarkers, setTradeMarkers, setNewsMarkers, clearNewsMarkers, getNewsMarkers,
    queueMarkers, flushMarkers,
    syncPriceLines, clearPriceLines, addPriceLine,
    timeToX, priceToY, yToPrice, xToTime,
    get chart() { return chart; },
    get series() { return candleSeries; },
    get candles() { return candles; },
    get symInfo() { return symInfo; },
    get activeIndicators() { return activeIndicators; },
  };
})();

window.ChartMgr = ChartMgr;
