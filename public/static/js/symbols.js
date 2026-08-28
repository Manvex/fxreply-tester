// Symbol universe. source: 'duka' (Dukascopy bi5) or 'binance' (klines REST).
// factor: divisor for Dukascopy integer prices. pip: pip/point size for spread & stats.
// lotUnits: units per 1.0 lot (forex 100k, others 1..100) — used for PnL & margin.
const SYMBOLS = [
  // ---------- FOREX (Dukascopy, factor 1e5 except JPY crosses 1e3) ----------
  { sym: 'EURUSD', name: 'Euro / U.S. Dollar', cat: 'forex', source: 'duka', factor: 1e5, pip: 0.0001, lotUnits: 100000, digits: 5 },
  { sym: 'GBPUSD', name: 'British Pound / U.S. Dollar', cat: 'forex', source: 'duka', factor: 1e5, pip: 0.0001, lotUnits: 100000, digits: 5 },
  { sym: 'USDJPY', name: 'U.S. Dollar / Japanese Yen', cat: 'forex', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 100000, digits: 3, quoteJPY: true },
  { sym: 'USDCHF', name: 'U.S. Dollar / Swiss Franc', cat: 'forex', source: 'duka', factor: 1e5, pip: 0.0001, lotUnits: 100000, digits: 5 },
  { sym: 'AUDUSD', name: 'Australian Dollar / U.S. Dollar', cat: 'forex', source: 'duka', factor: 1e5, pip: 0.0001, lotUnits: 100000, digits: 5 },
  { sym: 'USDCAD', name: 'U.S. Dollar / Canadian Dollar', cat: 'forex', source: 'duka', factor: 1e5, pip: 0.0001, lotUnits: 100000, digits: 5 },
  { sym: 'NZDUSD', name: 'New Zealand Dollar / U.S. Dollar', cat: 'forex', source: 'duka', factor: 1e5, pip: 0.0001, lotUnits: 100000, digits: 5 },
  { sym: 'EURGBP', name: 'Euro / British Pound', cat: 'forex', source: 'duka', factor: 1e5, pip: 0.0001, lotUnits: 100000, digits: 5 },
  { sym: 'EURJPY', name: 'Euro / Japanese Yen', cat: 'forex', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 100000, digits: 3, quoteJPY: true },
  { sym: 'GBPJPY', name: 'British Pound / Japanese Yen', cat: 'forex', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 100000, digits: 3, quoteJPY: true },
  { sym: 'AUDJPY', name: 'Australian Dollar / Japanese Yen', cat: 'forex', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 100000, digits: 3, quoteJPY: true },
  { sym: 'EURCHF', name: 'Euro / Swiss Franc', cat: 'forex', source: 'duka', factor: 1e5, pip: 0.0001, lotUnits: 100000, digits: 5 },
  { sym: 'EURAUD', name: 'Euro / Australian Dollar', cat: 'forex', source: 'duka', factor: 1e5, pip: 0.0001, lotUnits: 100000, digits: 5 },
  { sym: 'GBPCHF', name: 'British Pound / Swiss Franc', cat: 'forex', source: 'duka', factor: 1e5, pip: 0.0001, lotUnits: 100000, digits: 5 },
  { sym: 'CADJPY', name: 'Canadian Dollar / Japanese Yen', cat: 'forex', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 100000, digits: 3, quoteJPY: true },
  { sym: 'CHFJPY', name: 'Swiss Franc / Japanese Yen', cat: 'forex', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 100000, digits: 3, quoteJPY: true },

  // ---------- INDICES (Dukascopy CFD, factor 1e3) ----------
  { sym: 'US30', duka: 'USA30IDXUSD', name: 'Dow Jones 30 Index', cat: 'indices', source: 'duka', factor: 1e3, pip: 1, lotUnits: 1, digits: 1 },
  { sym: 'NAS100', duka: 'USATECHIDXUSD', name: 'Nasdaq 100 Index', cat: 'indices', source: 'duka', factor: 1e3, pip: 1, lotUnits: 1, digits: 1 },
  { sym: 'SPX500', duka: 'USA500IDXUSD', name: 'S&P 500 Index', cat: 'indices', source: 'duka', factor: 1e3, pip: 0.1, lotUnits: 1, digits: 2 },
  { sym: 'US2000', duka: 'USSC2000IDXUSD', name: 'Russell 2000 Index', cat: 'indices', source: 'duka', factor: 1e3, pip: 0.1, lotUnits: 1, digits: 2 },
  { sym: 'GER40', duka: 'DEUIDXEUR', name: 'DAX 40 Index (EUR)', cat: 'indices', source: 'duka', factor: 1e3, pip: 1, lotUnits: 1, digits: 1 },
  { sym: 'UK100', duka: 'GBRIDXGBP', name: 'FTSE 100 Index (GBP)', cat: 'indices', source: 'duka', factor: 1e3, pip: 1, lotUnits: 1, digits: 1 },
  { sym: 'JPN225', duka: 'JPNIDXJPY', name: 'Nikkei 225 Index (JPY)', cat: 'indices', source: 'duka', factor: 1e3, pip: 1, lotUnits: 1, digits: 0 },
  { sym: 'EU50', duka: 'EUSIDXEUR', name: 'Euro Stoxx 50 (EUR)', cat: 'indices', source: 'duka', factor: 1e3, pip: 1, lotUnits: 1, digits: 1 },
  { sym: 'HK50', duka: 'HKGIDXHKD', name: 'Hang Seng Index (HKD)', cat: 'indices', source: 'duka', factor: 1e3, pip: 1, lotUnits: 1, digits: 0 },

  // ---------- STOCKS (Dukascopy CFD, factor 1e3) ----------
  { sym: 'AAPL', duka: 'AAPLUSUSD', name: 'Apple Inc.', cat: 'stocks', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 100, digits: 2 },
  { sym: 'MSFT', duka: 'MSFTUSUSD', name: 'Microsoft Corp.', cat: 'stocks', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 100, digits: 2 },
  { sym: 'GOOGL', duka: 'GOOGLUSUSD', name: 'Alphabet Inc.', cat: 'stocks', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 100, digits: 2 },
  { sym: 'AMZN', duka: 'AMZNUSUSD', name: 'Amazon.com Inc.', cat: 'stocks', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 100, digits: 2 },
  { sym: 'NVDA', duka: 'NVDAUSUSD', name: 'NVIDIA Corp.', cat: 'stocks', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 100, digits: 2 },
  { sym: 'TSLA', duka: 'TSLAUSUSD', name: 'Tesla Inc.', cat: 'stocks', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 100, digits: 2 },
  { sym: 'META', duka: 'FBUSUSD', name: 'Meta Platforms Inc.', cat: 'stocks', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 100, digits: 2 },
  { sym: 'BA', duka: 'BAUSUSD', name: 'Boeing Co.', cat: 'stocks', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 100, digits: 2 },
  { sym: 'DIS', duka: 'DISUSUSD', name: 'Walt Disney Co.', cat: 'stocks', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 100, digits: 2 },

  // ---------- COMMODITIES (Dukascopy) ----------
  { sym: 'XAUUSD', duka: 'XAUUSD', name: 'Gold / U.S. Dollar', cat: 'commodities', source: 'duka', factor: 1e3, pip: 0.1, lotUnits: 100, digits: 2 },
  { sym: 'XAGUSD', duka: 'XAGUSD', name: 'Silver / U.S. Dollar', cat: 'commodities', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 5000, digits: 3 },
  { sym: 'USOIL', duka: 'LIGHTCMDUSD', name: 'WTI Crude Oil', cat: 'commodities', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 1000, digits: 3 },
  { sym: 'UKOIL', duka: 'BRENTCMDUSD', name: 'Brent Crude Oil', cat: 'commodities', source: 'duka', factor: 1e3, pip: 0.01, lotUnits: 1000, digits: 3 },

  // ---------- CRYPTO (Binance) ----------
  { sym: 'BTCUSDT', name: 'Bitcoin / TetherUS', cat: 'crypto', source: 'binance', pip: 1, lotUnits: 1, digits: 2 },
  { sym: 'ETHUSDT', name: 'Ethereum / TetherUS', cat: 'crypto', source: 'binance', pip: 0.1, lotUnits: 1, digits: 2 },
  { sym: 'BNBUSDT', name: 'BNB / TetherUS', cat: 'crypto', source: 'binance', pip: 0.1, lotUnits: 1, digits: 2 },
  { sym: 'SOLUSDT', name: 'Solana / TetherUS', cat: 'crypto', source: 'binance', pip: 0.01, lotUnits: 1, digits: 3 },
  { sym: 'XRPUSDT', name: 'XRP / TetherUS', cat: 'crypto', source: 'binance', pip: 0.0001, lotUnits: 1, digits: 4 },
  { sym: 'ADAUSDT', name: 'Cardano / TetherUS', cat: 'crypto', source: 'binance', pip: 0.0001, lotUnits: 1, digits: 4 },
  { sym: 'DOGEUSDT', name: 'Dogecoin / TetherUS', cat: 'crypto', source: 'binance', pip: 0.00001, lotUnits: 1, digits: 5 },
  { sym: 'LTCUSDT', name: 'Litecoin / TetherUS', cat: 'crypto', source: 'binance', pip: 0.01, lotUnits: 1, digits: 2 },
  { sym: 'LINKUSDT', name: 'Chainlink / TetherUS', cat: 'crypto', source: 'binance', pip: 0.001, lotUnits: 1, digits: 3 },
  { sym: 'AVAXUSDT', name: 'Avalanche / TetherUS', cat: 'crypto', source: 'binance', pip: 0.001, lotUnits: 1, digits: 3 },
];

function getSymbol(sym) { return SYMBOLS.find(s => s.sym === sym); }
window.SYMBOLS = SYMBOLS;
window.getSymbol = getSymbol;
