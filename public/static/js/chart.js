// ===========================================================================
// Chart manager — TradingView Lightweight Charts, dark surface theme,
// green/red candles, indicator overlays + sub panes, trade markers.
// ===========================================================================
const ChartMgr = (() => {
  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  const indicatorSeries = new Map();   // defId -> [series...]
  const activeIndicators = new Set();
  let priceLines = [];                 // manual position lines
  let candles = [];                    // currently displayed candles
  let symInfo = null;

  const THEME = {
    layout: { background: { type: 'solid', color: '#0b0d10' }, textColor: '#8b949e', fontSize: 11,
              fontFamily: "'Inter', -apple-system, sans-serif" },
    grid: { vertLines: { color: 'rgba(255,255,255,.035)' }, horzLines: { color: 'rgba(255,255,255,.035)' } },
    crosshair: {
      mode: 0,
      vertLine: { color: 'rgba(77,212,192,.5)', width: 1, style: 3, labelBackgroundColor: '#1c2128' },
      horzLine: { color: 'rgba(77,212,192,.5)', width: 1, style: 3, labelBackgroundColor: '#1c2128' },
    },
    rightPriceScale: { borderColor: 'rgba(255,255,255,.07)' },
    timeScale: { borderColor: 'rgba(255,255,255,.07)', timeVisible: true, secondsVisible: false, rightOffset: 6 },
  };

  function init(container) {
    chart = LightweightCharts.createChart(container, {
      ...THEME,
      autoSize: true,
    });
    candleSeries = chart.addCandlestickSeries({
      upColor: '#26d0a5', downColor: '#f2615c',
      wickUpColor: '#26d0a5', wickDownColor: '#f2615c',
      borderUpColor: '#26d0a5', borderDownColor: '#f2615c',
    });
    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      lastValueVisible: false, priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.22 } });
    return chart;
  }

  function setData(newCandles, info) {
    candles = newCandles;
    symInfo = info;
    const digits = info?.digits ?? 5;
    candleSeries.applyOptions({
      priceFormat: { type: 'price', precision: digits, minMove: Math.pow(10, -digits) },
    });
    candleSeries.setData(candles);
    volumeSeries.setData(candles.map(c => ({
      time: c.time, value: c.volume || 0,
      color: c.close >= c.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)',
    })));
    refreshIndicators();
    chart.timeScale().fitContent();
  }

  // live update (replay)
  function updateBar(bar) {
    candleSeries.update(bar);
    volumeSeries.update({ time: bar.time, value: bar.volume || 0, color: bar.close >= bar.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)' });
  }

  // -------- indicators --------
  function toggleIndicator(defId) {
    if (activeIndicators.has(defId)) { removeIndicator(defId); return false; }
    activeIndicators.add(defId);
    renderIndicator(defId);
    return true;
  }

  function renderIndicator(defId) {
    const def = INDICATOR_DEFS.find(d => d.id === defId);
    if (!def || !candles.length) return;
    removeSeriesFor(defId);
    const lines = def.calc(candles);
    const arr = [];
    for (const ln of lines) {
      let s;
      const paneOpts = def.pane === 'sub'
        ? { priceScaleId: 'sub-' + defId, lastValueVisible: false, priceLineVisible: false }
        : { lastValueVisible: false, priceLineVisible: false };
      if (ln.style === 'histogram') {
        s = chart.addHistogramSeries({ color: ln.color, ...paneOpts });
      } else {
        s = chart.addLineSeries({ color: ln.color, lineWidth: 1.5, ...paneOpts });
      }
      const data = [];
      for (let i = 0; i < candles.length; i++) {
        if (!isNaN(ln.data[i])) data.push({ time: candles[i].time, value: ln.data[i] });
      }
      s.setData(data);
      arr.push(s);
    }
    if (def.pane === 'sub') {
      chart.priceScale('sub-' + defId).applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
      candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.32 } });
    }
    indicatorSeries.set(defId, arr);
  }

  function removeSeriesFor(defId) {
    const arr = indicatorSeries.get(defId);
    if (arr) { arr.forEach(s => { try { chart.removeSeries(s); } catch (e) {} }); indicatorSeries.delete(defId); }
  }

  function removeIndicator(defId) {
    activeIndicators.delete(defId);
    removeSeriesFor(defId);
    if (![...activeIndicators].some(id => INDICATOR_DEFS.find(d => d.id === id)?.pane === 'sub')) {
      candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.22 } });
    }
  }

  function refreshIndicators() {
    for (const id of activeIndicators) renderIndicator(id);
  }

  // -------- trade markers (backtest / manual trades) --------
  // Two independent marker layers — trades and news events — merged on every
  // update so turning news on/off never wipes the trade arrows (and vice versa).
  let tradeMarkers = [];
  let newsMarkers = [];

  function applyMarkers() {
    const all = tradeMarkers.concat(newsMarkers);
    all.sort((a, b) => a.time - b.time);
    candleSeries.setMarkers(all);
  }
  function setMarkers(m) { tradeMarkers = m || []; applyMarkers(); }
  function setTradeMarkers(m) { tradeMarkers = m || []; applyMarkers(); }
  function setNewsMarkers(m) { newsMarkers = m || []; applyMarkers(); }
  function clearNewsMarkers() { newsMarkers = []; applyMarkers(); }
  function getNewsMarkers() { return newsMarkers; }

  function clearPriceLines() {
    priceLines.forEach(pl => { try { candleSeries.removePriceLine(pl); } catch (e) {} });
    priceLines = [];
  }

  function addPriceLine(price, color, title, style = 2) {
    const pl = candleSeries.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
    priceLines.push(pl);
    return pl;
  }

  return {
    init, setData, updateBar, toggleIndicator, removeIndicator, refreshIndicators,
    setMarkers, setTradeMarkers, setNewsMarkers, clearNewsMarkers, getNewsMarkers,
    clearPriceLines, addPriceLine,
    get chart() { return chart; },
    get series() { return candleSeries; },
    get candles() { return candles; },
    get activeIndicators() { return activeIndicators; },
  };
})();

window.ChartMgr = ChartMgr;
