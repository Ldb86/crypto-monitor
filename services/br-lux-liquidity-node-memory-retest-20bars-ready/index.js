'use strict';

/**
 * BR NATIVO + LUXALGO TL + MULTI-EXCHANGE LIQUIDITY ENGINE
 * Runtime: Node.js / Express / Railway / Visual Studio Code
 *
 * Obiettivo:
 * - mantenere il BR Range Box a 20 candele che gia' funzionava;
 * - usare Range Box, rottura Trendline e liquidity come 3 pilastri indipendenti;
 * - notificare solo quando la liquidity conferma e almeno un pilastro tecnico (Range o TL) concorda;
 * - impedire reinvii dello stesso setup quando la liquidity oscilla durante la stessa candela;
 * - nessuna dipendenza da TradingView / Pine Script.
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { EMA, MACD } = require('technicalindicators');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = intEnv('PORT', 3000);
const TELEGRAM_TOKENS = listEnv('BOT_TOKENS');
const TELEGRAM_CHAT_IDS = listEnv('CHAT_IDS');

const DEFAULT_COINS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT',
  'BNBUSDT', 'UNIUSDT', 'XRPUSDT',
  'LTCUSDT', 'AAVEUSDT', 'SUIUSDT', 'ENAUSDT',
  'ONDOUSDT', 'DOGEUSDT', 'PEPEUSDT',
  'DOTUSDT', 'ATOMUSDT', 'HBARUSDT',
  'TIAUSDT', 'SHIBUSDT', 'ICPUSDT', 'BCHUSDT',
  'LINKUSDT', 'AVAXUSDT', 'TONUSDT'
];

const coins = listEnv('COINS', DEFAULT_COINS);
const intervals = listEnv('INTERVALS', ['15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w']);

const coinEmojis = {
  BTCUSDT: '🟠', ETHUSDT: '⚫', SOLUSDT: '🌞', BNBUSDT: '🌈', UNIUSDT: '🟣',
  XRPUSDT: '🔵', LTCUSDT: '⚪', AAVEUSDT: '🔷', SUIUSDT: '🔹', ENAUSDT: '🟪',
  ONDOUSDT: '🟤', DOGEUSDT: '🐶', DOTUSDT: '⚪', ATOMUSDT: '🌌', HBARUSDT: '🚀',
  TIAUSDT: '🟡', SHIBUSDT: '🐕', PEPEUSDT: '🐸', ICPUSDT: '🌪', BCHUSDT: '⭐️',
  LINKUSDT: '⚡️', AVAXUSDT: '🔥', TONUSDT: '🌦'
};

const bybitIntervalMap = {
  '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
  '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
  '1d': 'D', '1w': 'W', '1M': 'M'
};

const CONFIG = {
  marketMode: strEnv('MARKET_MODE', 'linear').toLowerCase(), // linear | spot
  bybitCategory: strEnv('BYBIT_CATEGORY', strEnv('MARKET_MODE', 'linear')).toLowerCase(),
  scanIntervalMs: intEnv('SCAN_INTERVAL_MS', 60_000),
  requestDelayMs: intEnv('REQUEST_DELAY_MS', 150),
  httpTimeoutMs: intEnv('HTTP_TIMEOUT_MS', 15_000),
  retryCount: intEnv('RETRY_COUNT', 2),

  rangeLookback: intEnv('RANGE_LOOKBACK', 20),
  // Le vecchie variabili REQUIRE_* restano compatibili, ma ora abilitano i due pilastri:
  // non sono piu' entrambe obbligatorie nello stesso segnale.
  rangeSignalEnabled: boolEnv('ENABLE_RANGEBOX_SIGNAL', boolEnv('REQUIRE_RANGEBOX_BREAKOUT', true)),
  tlSignalEnabled: boolEnv('ENABLE_LUX_TL_SIGNAL', boolEnv('REQUIRE_LUX_TL_BREAK', true)),
  signalMinPillars: Math.max(2, Math.min(3, intEnv('SIGNAL_MIN_PILLARS', 2))),
  // Gate Telegram: liquidity obbligatoria. Consente solo Range+Liquidity, TL+Liquidity o 3/3.
  requireLiquidityForTelegram: boolEnv(
    'REQUIRE_LIQUIDITY_FOR_TELEGRAM',
    boolEnv('SEND_ONLY_LIQUIDITY_CONFIRMED', true)
  ),
  notify3Of3Upgrade: boolEnv('NOTIFY_3OF3_UPGRADE', true),
  tlBreakMaxAgeCandles: intEnv('TL_BREAK_MAX_AGE_CANDLES', 3),

  luxLength: intEnv('LUX_LENGTH', 14),
  luxSlopeMult: floatEnv('LUX_SLOPE_MULT', 1.0),
  luxCalcMethod: strEnv('LUX_CALC_METHOD', 'Atr'), // Atr | Stdev | Linreg

  orderbookLimit: intEnv('ORDERBOOK_LIMIT', 50),
  tradeLimit: intEnv('TRADE_LIMIT', 100),
  topBookLevels: intEnv('TOP_BOOK_LEVELS', 10),
  strongestWallMaxDistancePct: floatEnv('STRONGEST_WALL_MAX_DISTANCE_PCT', 1.25),
  maxClusterDistancePct: floatEnv('AUTO_CLUSTER_MAX_DISTANCE_PCT', 2.5),
  mergeTolerancePct: floatEnv('AUTO_CLUSTER_MERGE_TOLERANCE_PCT', 0.20),
  levelsAbove: intEnv('AUTO_CLUSTER_LEVELS_ABOVE', 3),
  levelsBelow: intEnv('AUTO_CLUSTER_LEVELS_BELOW', 3),
  requiredConfirmations: intEnv('EXCHANGE_REQUIRED_CONFIRMATIONS', 2),

  minSpreadOkPct: floatEnv('MIN_SPREAD_OK_PCT', 0.08),
  minVelocityActive: floatEnv('MIN_BOOK_VELOCITY_ACTIVE', 0.35),
  noChasePct: floatEnv('NO_CHASE_ENTRY_RANGE_PCT', 0.12),
  nearBreakPct: floatEnv('ENTRY_NEAR_BREAK_PCT', 0.05),
  pivotWarningPct: floatEnv('PIVOT_WARNING_DISTANCE_PCT', 0.20),

  // Memoria rotture/retest, separata per simbolo + timeframe + direzione.
  // Una rottura precedente resta contesto informativo; di default NON conta come nuovo pilastro.
  rangeBreakMaxAgeCandles: intEnv('RANGE_BREAK_MAX_AGE_CANDLES', 0),
  rangeBreakMemoryBars: intEnv('RANGE_BREAK_MEMORY_BARS', 20),
  tlBreakMemoryBars: intEnv('TL_BREAK_MEMORY_BARS', 20),
  retestTolerancePct: floatEnv('RETEST_TOLERANCE_PCT', 0.10),
  retestConfirmOnClose: boolEnv('RETEST_CONFIRM_ON_CLOSE', true),
  countRetestAsPillar: boolEnv('COUNT_RETEST_AS_PILLAR', false),
  breakInvalidationCloses: Math.max(1, intEnv('BREAK_INVALIDATION_CLOSES', 2)),
  breakInvalidationTolerancePct: floatEnv('BREAK_INVALIDATION_TOLERANCE_PCT', 0.05),

  // Supporti/Resistenze portati da EzAlgo V.5:
  // ta.pivothigh/low(left=50, right=25) + pivot rapido right=5.
  srPivotLeft: intEnv('SR_PIVOT_LEFT', 50),
  srPivotRight: intEnv('SR_PIVOT_RIGHT', 25),
  srQuickRight: intEnv('SR_QUICK_RIGHT', 5),
  srLevelsAbove: intEnv('SR_LEVELS_ABOVE', 3),
  srLevelsBelow: intEnv('SR_LEVELS_BELOW', 3),
  srMergeTolerancePct: floatEnv('SR_MERGE_TOLERANCE_PCT', 0.05),

  telegramEnabled: boolEnv('TELEGRAM_ENABLED', true),
  telegramAuditDetails: boolEnv('TELEGRAM_AUDIT_DETAILS', false),
  debugRejected: boolEnv('DEBUG_REJECTED_SIGNALS', true)
};

if (Object.prototype.hasOwnProperty.call(process.env, 'SEND_ONLY_LIQUIDITY_CONFIRMED')) {
  console.warn('[CONFIG] SEND_ONLY_LIQUIDITY_CONFIRMED resta supportata come alias di REQUIRE_LIQUIDITY_FOR_TELEGRAM.');
}

const lastSignals = {};
const runtime = {
  startedAt: new Date().toISOString(),
  running: false,
  lastScanAt: null,
  lastCycleSummary: {},
  lastExchangeSnapshots: {},
  lastClusters: {},
  lastBreakMemory: {},
  lastEvents: []
};

for (const c of coins) {
  lastSignals[c] = {};
  for (const tf of intervals) {
    lastSignals[c][tf] = {
      lastAlertKey: null,
      lastDirection: null,
      breakoutDone: false,
      rangeBreakoutDirection: null,
      lastPillarSignature: null,
      lastMajorityScore: 0,
      lastBreakMemorySignature: null,
      // Memoria anti-spam: conserva i setup già notificati per questo simbolo/TF.
      // La chiave non include lo stato oscillante della liquidity.
      notifiedSetups: {},
      macd: null
    };
  }
}

// ───────────────────────── SERVER ─────────────────────────
app.get('/', (req, res) => {
  res.type('text').send('✅ BR/TL + Liquidity: liquidity obbligatoria e anti-spam setup attivi');
});

app.get('/status', (req, res) => {
  res.json({
    ok: true,
    config: publicConfig(),
    runtime,
    coins,
    intervals
  });
});

app.get('/clusters/:symbol', async (req, res) => {
  const symbol = normalizeSymbol(req.params.symbol);
  const snapshots = await fetchMultiExchangeSnapshots(symbol);
  const clusters = buildAutoClusters(symbol, snapshots);
  res.json({ symbol, snapshots: snapshots.map(lightSnapshot), clusters });
});

// Audit tecnico puro: confronta high/low/pivot/linee LuxAlgo senza aspettare un segnale Telegram.
app.get('/lux-audit/:symbol/:interval', async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    const interval = String(req.params.interval || '15m');
    const klines = await fetchKlines(symbol, interval, 350);
    const lux = computeLuxAlgoTrendlines(klines, {
      length: CONFIG.luxLength,
      mult: CONFIG.luxSlopeMult,
      calcMethod: CONFIG.luxCalcMethod
    });
    res.json({
      symbol,
      interval,
      market: { bybitCategory: CONFIG.bybitCategory, source: 'Bybit v5 market/kline', closedCandlesOnly: true },
      luxSettings: { length: CONFIG.luxLength, mult: CONFIG.luxSlopeMult, calcMethod: CONFIG.luxCalcMethod },
      lastClosedCandle: buildLuxCandleInfo(klines, klines.length - 1),
      activeUpperPivot: lux.lastPivotHigh,
      activeLowerPivot: lux.lastPivotLow,
      supportResistance: buildPivotLevels(klines, klines.at(-1)?.close || 0),
      activeLevelsOnLastClosedCandle: lux.last ? {
        upperRawLevel: lux.last.upper,
        lowerRawLevel: lux.last.lower,
        upperTriggerExact: lux.last.upperBreakLevel,
        lowerTriggerExact: lux.last.lowerBreakLevel,
        formulaUpper: 'upperRaw - slope_ph * length',
        formulaLower: 'lowerRaw + slope_pl * length',
        slopePh: lux.last.slopePh,
        slopePl: lux.last.slopePl
      } : null,
      lastBreakEvents: lux.events.slice(-12).map(lightLuxEvent)
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});


// Audit Supporti/Resistenze EzAlgo V.5, calcolati sul timeframe richiesto.
app.get('/sr-audit/:symbol/:interval', async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    const interval = String(req.params.interval || '15m');
    const klines = await fetchKlines(symbol, interval, 350);
    const lastPrice = klines.at(-1)?.close || 0;
    const sr = buildPivotLevels(klines, lastPrice);
    res.json({
      symbol,
      interval,
      market: { bybitCategory: CONFIG.bybitCategory, source: 'Bybit v5 market/kline', closedCandlesOnly: true },
      lastClosedCandle: buildLuxCandleInfo(klines, klines.length - 1),
      supportResistance: sr
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Audit memoria rotture/retest: mostra per LONG e SHORT se la rottura è fresca,
// recente, in retest, invalidata, scaduta o mai avvenuta nelle candele caricate.
app.get('/memory-audit/:symbol/:interval', async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    const interval = String(req.params.interval || '15m');
    const klines = await fetchKlines(symbol, interval, 350);
    const lux = computeLuxAlgoTrendlines(klines, {
      length: CONFIG.luxLength,
      mult: CONFIG.luxSlopeMult,
      calcMethod: CONFIG.luxCalcMethod
    });
    const rangeEvents = computeRangeBreakEvents(klines, CONFIG.rangeLookback);
    const memory = buildBreakMemory(klines, lux, rangeEvents);
    res.json({
      symbol,
      interval,
      settings: breakMemorySettings(),
      lastClosedCandle: buildLuxCandleInfo(klines, klines.length - 1),
      currentRangeBox: getRangeBox(klines, CONFIG.rangeLookback),
      memory
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/scan-now', async (req, res) => {
  runScan('manual').catch(err => console.error(`${now()} ❌ manual scan error`, err));
  res.json({ ok: true, message: 'Scan manuale avviato' });
});

app.listen(PORT, () => {
  console.log(`${now()} 🚀 Server in ascolto sulla porta ${PORT}`);
  console.log(`${now()} ⚙️ Config: ${JSON.stringify(publicConfig())}`);
});

// ───────────────────────── TELEGRAM ─────────────────────────
async function sendTelegramMessage(msg, symbol, interval) {
  if (!CONFIG.telegramEnabled) {
    console.log(`${now()} TELEGRAM_DISABLED ${symbol}[${interval}]\n${msg}`);
    return;
  }
  if (!TELEGRAM_TOKENS.length || !TELEGRAM_CHAT_IDS.length) {
    console.warn(`${now()} ⚠️ Telegram non configurato: BOT_TOKENS/CHAT_IDS mancanti`);
    return;
  }

  const count = Math.min(TELEGRAM_TOKENS.length, TELEGRAM_CHAT_IDS.length);
  for (let i = 0; i < count; i++) {
    const token = TELEGRAM_TOKENS[i].trim();
    const chatId = TELEGRAM_CHAT_IDS[i].trim();
    if (!token || !chatId) continue;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
      // Plain text: evita errori Telegram 400 causati da Markdown non escapato
      // dentro audit LuxAlgo, simboli, underscore, parentesi, ecc.
      await axios.post(url, {
        chat_id: chatId,
        text: msg
      }, { timeout: CONFIG.httpTimeoutMs });
      console.log(`${now()} 📬 Telegram inviato su ${symbol}[${interval}] ➡️ Bot ${i + 1}`);
    } catch (e) {
      const details = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      console.error(`${now()} ❌ Telegram error ${symbol}[${interval}]:`, details);
    }
  }
}

// ───────────────────────── EXCHANGE DATA ─────────────────────────
async function fetchKlines(symbol, interval, limit = 300) {
  const bybitInterval = bybitIntervalMap[interval];
  if (!bybitInterval) {
    console.warn(`${now()} ⚠️ Interval non supportato Bybit: ${interval}`);
    return [];
  }

  const res = await requestWithRetry('GET', 'https://api.bybit.com/v5/market/kline', {
    category: CONFIG.bybitCategory,
    symbol,
    interval: bybitInterval,
    limit
  });

  const list = res?.data?.result?.list;
  if (!Array.isArray(list)) return [];

  const candles = list.slice().reverse().map(k => ({
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5])
  })).filter(k => Number.isFinite(k.time) && Number.isFinite(k.close));

  return dropOpenCandle(candles, interval);
}

async function fetchMultiExchangeSnapshots(symbol) {
  const tasks = [
    safeExchangeFetch('BYBIT', () => fetchBybitSnapshot(symbol)),
    safeExchangeFetch('BINANCE', () => fetchBinanceSnapshot(symbol)),
    safeExchangeFetch('OKX', () => fetchOkxSnapshot(symbol))
  ];
  const results = await Promise.all(tasks);
  const snapshots = results.filter(Boolean);
  runtime.lastExchangeSnapshots[symbol] = snapshots.map(lightSnapshot);
  return snapshots;
}

async function safeExchangeFetch(exchange, fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn(`${now()} ⚠️ ${exchange} snapshot non disponibile: ${e.message}`);
    return null;
  }
}

async function fetchBybitSnapshot(symbol) {
  const category = CONFIG.bybitCategory;
  const [bookRes, tradesRes] = await Promise.all([
    requestWithRetry('GET', 'https://api.bybit.com/v5/market/orderbook', {
      category,
      symbol,
      limit: CONFIG.orderbookLimit
    }),
    requestWithRetry('GET', 'https://api.bybit.com/v5/market/recent-trade', {
      category,
      symbol,
      limit: CONFIG.tradeLimit
    })
  ]);

  const book = bookRes?.data?.result || {};
  const bids = parseLevels(book.b || book.bids);
  const asks = parseLevels(book.a || book.asks);
  const trades = (tradesRes?.data?.result?.list || []).map(t => ({
    qty: Number(t.size ?? t.v ?? t.qty ?? 0),
    side: String(t.side ?? t.S ?? '').toLowerCase().includes('buy') ? 'buy' : 'sell'
  }));
  return buildMarketSnapshot('BYBIT', symbol, bids, asks, trades);
}

async function fetchBinanceSnapshot(symbol) {
  const futures = CONFIG.marketMode !== 'spot';
  const base = futures ? 'https://fapi.binance.com' : 'https://api.binance.com';
  const depthPath = futures ? '/fapi/v1/depth' : '/api/v3/depth';
  const tradesPath = futures ? '/fapi/v1/aggTrades' : '/api/v3/aggTrades';

  const [bookRes, tradesRes] = await Promise.all([
    requestWithRetry('GET', base + depthPath, { symbol, limit: normalizeBinanceDepthLimit(CONFIG.orderbookLimit, futures) }),
    requestWithRetry('GET', base + tradesPath, { symbol, limit: CONFIG.tradeLimit })
  ]);

  const book = bookRes?.data || {};
  const bids = parseLevels(book.bids);
  const asks = parseLevels(book.asks);
  const trades = Array.isArray(tradesRes?.data) ? tradesRes.data.map(t => ({
    qty: Number(t.q ?? 0),
    // m=true => buyer is maker => sell aggressor; m=false => buy aggressor
    side: t.m ? 'sell' : 'buy'
  })) : [];

  return buildMarketSnapshot('BINANCE', symbol, bids, asks, trades);
}

async function fetchOkxSnapshot(symbol) {
  const instId = toOkxInstId(symbol);
  const [bookRes, tradesRes] = await Promise.all([
    requestWithRetry('GET', 'https://www.okx.com/api/v5/market/books', { instId, sz: CONFIG.orderbookLimit }),
    requestWithRetry('GET', 'https://www.okx.com/api/v5/market/trades', { instId, limit: CONFIG.tradeLimit })
  ]);

  const d = bookRes?.data?.data?.[0] || {};
  const bids = parseLevels(d.bids);
  const asks = parseLevels(d.asks);
  const trades = (tradesRes?.data?.data || []).map(t => ({
    qty: Number(t.sz ?? 0),
    side: String(t.side ?? '').toLowerCase() === 'buy' ? 'buy' : 'sell'
  }));

  return buildMarketSnapshot('OKX', symbol, bids, asks, trades);
}

function buildMarketSnapshot(exchange, symbol, bids, asks, trades) {
  bids = bids.filter(x => x.price > 0 && x.qty > 0).sort((a, b) => b.price - a.price).slice(0, CONFIG.orderbookLimit);
  asks = asks.filter(x => x.price > 0 && x.qty > 0).sort((a, b) => a.price - b.price).slice(0, CONFIG.orderbookLimit);
  if (!bids.length || !asks.length) throw new Error(`orderbook vuoto ${exchange} ${symbol}`);

  const bestBid = bids[0].price;
  const bestAsk = asks[0].price;
  const mid = (bestBid + bestAsk) / 2;
  const topN = Math.max(1, CONFIG.topBookLevels);
  const bidPressure = bids.slice(0, topN).reduce((s, x) => s + x.qty, 0);
  const askPressure = asks.slice(0, topN).reduce((s, x) => s + x.qty, 0);
  const bookImbalance = bidPressure - askPressure;
  const tradeDelta = trades.reduce((s, t) => s + (t.side === 'buy' ? t.qty : -t.qty), 0);
  const deltaProxy = bookImbalance + tradeDelta;
  const velocity = Math.abs(bookImbalance) / Math.max(1, bidPressure + askPressure);
  const spreadPct = mid > 0 ? Math.abs(bestAsk - bestBid) / mid * 100 : 99;
  const strongestBid = strongestLevel(bids, mid);
  const strongestAsk = strongestLevel(asks, mid);

  return {
    exchange,
    symbol,
    mid,
    bidPressure,
    askPressure,
    deltaProxy,
    velocity,
    spreadPct,
    strongestBidPrice: strongestBid?.price || 0,
    strongestBidQty: strongestBid?.qty || 0,
    strongestAskPrice: strongestAsk?.price || 0,
    strongestAskQty: strongestAsk?.qty || 0,
    time: new Date().toISOString()
  };
}

// ───────────────────────── ANALISI BR + LUXALGO + LIQUIDITY ─────────────────────────
async function analyze(symbol, interval, sharedSnapshots, sharedClusters) {
  let klines;
  try {
    klines = await fetchKlines(symbol, interval, 350);
  } catch (e) {
    console.warn(`${now()} ⚠️ fetchKlines ${symbol}[${interval}] fallito: ${e.message}`);
    return { skipped: true, reason: 'KLINES_ERROR' };
  }

  if (klines.length < Math.max(220, CONFIG.luxLength * 3 + CONFIG.rangeLookback + 5)) {
    return { skipped: true, reason: 'NOT_ENOUGH_CANDLES', candles: klines.length };
  }

  const prices = klines.map(k => k.close);
  const ema12 = EMA.calculate({ period: 12, values: prices }).at(-1);
  const ema26 = EMA.calculate({ period: 26, values: prices }).at(-1);
  const ema50 = EMA.calculate({ period: 50, values: prices }).at(-1);
  const ema200 = EMA.calculate({ period: 200, values: prices }).at(-1);

  const macdVals = MACD.calculate({ values: prices, fastPeriod: 26, slowPeriod: 50, signalPeriod: 9 });
  if (macdVals.length < 2) return { skipped: true, reason: 'MACD_NOT_READY' };

  const lastMacd = macdVals.at(-1);
  const prevMacd = macdVals.at(-2);
  const crossover =
    prevMacd.MACD < prevMacd.signal && lastMacd.MACD > lastMacd.signal ? 'bullish' :
    prevMacd.MACD > prevMacd.signal && lastMacd.MACD < lastMacd.signal ? 'bearish' :
    null;

  const state = lastSignals[symbol][interval];
  if (crossover) state.macd = crossover;

  const last = klines.at(-1);
  const lastIndex = klines.length - 1;
  const lastPrice = last.close;
  const rangeBox = getRangeBox(klines, CONFIG.rangeLookback);
  const rangeOutsideDirection =
    lastPrice > rangeBox.high ? 'long' :
    lastPrice < rangeBox.low ? 'short' :
    null;

  if (!rangeOutsideDirection) {
    state.breakoutDone = false;
    state.rangeBreakoutDirection = null;
  }

  const rangeEvents = computeRangeBreakEvents(klines, CONFIG.rangeLookback);
  const recentRangeEvent = findRecentBreakEvent(rangeEvents, lastIndex, CONFIG.rangeBreakMaxAgeCandles);
  const rangeBreakout = recentRangeEvent?.direction === 'long' ? 'up' : recentRangeEvent?.direction === 'short' ? 'down' : null;

  const lux = computeLuxAlgoTrendlines(klines, {
    length: CONFIG.luxLength,
    mult: CONFIG.luxSlopeMult,
    calcMethod: CONFIG.luxCalcMethod
  });
  const tlConfirm = findRecentTlBreak(lux.events, lastIndex, CONFIG.tlBreakMaxAgeCandles);
  const breakMemory = buildBreakMemory(klines, lux, rangeEvents);
  runtime.lastBreakMemory[`${symbol}|${interval}`] = breakMemory;

  const directionFromRangeRaw = recentRangeEvent?.direction || null;
  const directionFromTlRaw = tlConfirm?.direction || null;
  const rememberedRangeDirection = directionFromRetestMemory(breakMemory.range);
  const rememberedTlDirection = directionFromRetestMemory(breakMemory.tl);
  const directionFromRange = CONFIG.rangeSignalEnabled ? (directionFromRangeRaw || rememberedRangeDirection) : null;
  const directionFromTl = CONFIG.tlSignalEnabled ? (directionFromTlRaw || rememberedTlDirection) : null;

  const liquidityState = resolveLiquidityDirection(sharedSnapshots);
  const majority = selectMajoritySignal({
    rangeDirection: directionFromRange,
    tlDirection: directionFromTl,
    liquidityDirection: liquidityState.direction,
    minPillars: CONFIG.signalMinPillars
  });

  if (!majority) {
    if (CONFIG.debugRejected && (rangeBreakout || tlConfirm || liquidityState.direction)) {
      console.log(`${now()} ⏸️ ${symbol}[${interval}] nessuna maggioranza ${CONFIG.signalMinPillars}/3: range=${directionFromRange || '-'} tl=${directionFromTl || '-'} liquidity=${liquidityState.direction || '-'} price=${formatPrice(lastPrice)}`);
    }
    return {
      skipped: true,
      reason: 'NO_MAJORITY_2_OF_3',
      rangeBreakout,
      rangeEvent: recentRangeEvent,
      tl: tlConfirm,
      liquidityState,
      breakMemory
    };
  }

  const direction = majority.direction;
  const liquidity = direction === 'long' ? liquidityState.long : liquidityState.short;

  // Regola definitiva Telegram:
  // ✅ Range + Liquidity
  // ✅ TL + Liquidity
  // ✅ Range + TL + Liquidity
  // ❌ Range + TL senza liquidity (o con liquidity contraria)
  if (CONFIG.requireLiquidityForTelegram && majority.liquidityStatus !== 'same') {
    if (CONFIG.debugRejected) {
      console.log(`${now()} ⛔ ${symbol}[${interval}] ${direction.toUpperCase()} tecnico ${majority.score}/3 NON INVIATO: liquidity obbligatoria non conferma (${liquidityState.direction || 'neutra'})`);
    }
    return {
      skipped: true,
      reason: 'LIQUIDITY_REQUIRED_FOR_TELEGRAM',
      majority,
      rangeBreakout,
      rangeEvent: recentRangeEvent,
      tl: tlConfirm,
      liquidityState,
      breakMemory
    };
  }

  const setupKey = buildNotificationSetupKey({
    symbol,
    interval,
    direction,
    majority,
    rangeEvent: recentRangeEvent,
    tlEvent: tlConfirm
  });
  const previousSetup = state.notifiedSetups?.[setupKey] || null;
  const isAllowedUpgrade = Boolean(
    previousSetup &&
    CONFIG.notify3Of3Upgrade &&
    previousSetup.maxScore < 3 &&
    majority.score === 3
  );

  if (previousSetup && !isAllowedUpgrade) {
    if (CONFIG.debugRejected) {
      console.log(`${now()} 🔕 ${symbol}[${interval}] ${direction.toUpperCase()} setup già notificato: nessun reinvio (${majority.score}/3)`);
    }
    return { skipped: true, reason: 'SETUP_ALREADY_NOTIFIED', setupKey, majority };
  }

  const signalKey = [
    symbol,
    interval,
    direction,
    directionFromRange || 'noRange',
    tlConfirm?.barTime || 'noTL',
    liquidityState.direction || 'noLiquidity',
    majority.signature,
    memorySignature(breakMemory)
  ].join('|');

  if (state.lastAlertKey === signalKey) return { skipped: true, reason: 'DUPLICATE_STATE' };

  // Se il Range Box resta rotto per molte candele, non ripetere lo stesso identico 2/3.
  // Un upgrade (es. da 2/3 a 3/3) o un cambiamento dei pilastri viene invece notificato.
  if (
    majority.rangeStatus === 'same' &&
    state.breakoutDone &&
    state.rangeBreakoutDirection === direction &&
    state.lastPillarSignature === majority.signature &&
    state.lastMajorityScore >= majority.score
  ) {
    return { skipped: true, reason: 'RANGE_STATE_ALREADY_NOTIFIED' };
  }

  rememberNotifiedSetup(state, setupKey, majority.score);
  state.lastAlertKey = signalKey;
  state.lastDirection = direction;
  state.lastPillarSignature = majority.signature;
  state.lastMajorityScore = majority.score;
  state.lastBreakMemorySignature = memorySignature(breakMemory);
  if (majority.rangeStatus === 'same') {
    state.breakoutDone = true;
    state.rangeBreakoutDirection = direction;
  }

  const opMap = buildOperationalMap(symbol, interval, direction, lastPrice, rangeBox, sharedClusters);
  const pivotLevels = buildPivotLevels(klines, lastPrice);
  const livePrice = Number(sharedClusters?.mid) > 0 ? Number(sharedClusters.mid) : lastPrice;
  const event = {
    time: new Date().toISOString(),
    symbol,
    interval,
    direction,
    lastPrice,
    rangeBox,
    rangeDirection: directionFromRange,
    rangeEvent: recentRangeEvent,
    tlDirection: directionFromTl,
    tl: tlConfirm,
    liquidity,
    liquidityState,
    majority,
    clusters: sharedClusters,
    opMap,
    pivotLevels,
    livePrice,
    breakMemory
  };
  pushRuntimeEvent(event);

  const statusCompact = `R:${pillarIcon(majority.rangeStatus)} TL:${pillarIcon(majority.tlStatus)} LIQ:${pillarIcon(majority.liquidityStatus)}`;
  console.log(`${now()} 🚨 ${symbol}[${interval}] ${direction.toUpperCase()} ${majority.score}/3 ${statusCompact}`);
  await sendSignal({
    symbol,
    interval,
    lastPrice,
    rangeBox,
    rangeDirection: directionFromRange,
    rangeEvent: recentRangeEvent,
    ema12,
    ema26,
    ema50,
    ema200,
    direction,
    lux,
    tlDirection: directionFromTl,
    tlConfirm,
    liquidity,
    liquidityState,
    majority,
    clusters: sharedClusters,
    opMap,
    pivotLevels,
    livePrice,
    breakMemory,
    macd: state.macd
  });

  return { sent: true, event };
}


function resolveLiquidityDirection(snapshots) {
  const long = evaluateLiquidity('LONG', snapshots);
  const short = evaluateLiquidity('SHORT', snapshots);

  let direction = null;
  if (long.confirmed && !short.confirmed) direction = 'long';
  else if (short.confirmed && !long.confirmed) direction = 'short';
  else if (long.confirmed && short.confirmed) {
    if (long.confirms > short.confirms) direction = 'long';
    else if (short.confirms > long.confirms) direction = 'short';
  }

  return {
    direction,
    long,
    short,
    ambiguous: long.confirmed && short.confirmed && !direction
  };
}

function buildNotificationSetupKey({ symbol, interval, direction, majority, rangeEvent, tlEvent }) {
  const rangeId = majority?.rangeStatus === 'same'
    ? String(rangeEvent?.index ?? rangeEvent?.barTime ?? 'range-current')
    : '-';
  const tlId = majority?.tlStatus === 'same'
    ? String(tlEvent?.index ?? tlEvent?.barTime ?? 'tl-current')
    : '-';
  return `${symbol}|${interval}|${direction}|R:${rangeId}|T:${tlId}`;
}

function rememberNotifiedSetup(state, setupKey, score) {
  if (!state.notifiedSetups || typeof state.notifiedSetups !== 'object') state.notifiedSetups = {};
  const previous = state.notifiedSetups[setupKey];
  state.notifiedSetups[setupKey] = {
    maxScore: Math.max(Number(previous?.maxScore) || 0, Number(score) || 0),
    notifiedAt: Date.now()
  };

  // Evita crescita indefinita della memoria durante settimane di esecuzione.
  const entries = Object.entries(state.notifiedSetups);
  if (entries.length > 100) {
    entries
      .sort((a, b) => Number(a[1]?.notifiedAt || 0) - Number(b[1]?.notifiedAt || 0))
      .slice(0, entries.length - 100)
      .forEach(([key]) => delete state.notifiedSetups[key]);
  }
}

function relationToDirection(actualDirection, targetDirection) {
  if (!actualDirection) return 'missing';
  return actualDirection === targetDirection ? 'same' : 'opposite';
}

function selectMajoritySignal({ rangeDirection, tlDirection, liquidityDirection, minPillars = 2 }) {
  const candidates = ['long', 'short'].map(direction => {
    const rangeStatus = relationToDirection(rangeDirection, direction);
    const tlStatus = relationToDirection(tlDirection, direction);
    const liquidityStatus = relationToDirection(liquidityDirection, direction);
    const score = [rangeStatus, tlStatus, liquidityStatus].filter(v => v === 'same').length;
    return {
      direction,
      score,
      rangeStatus,
      tlStatus,
      liquidityStatus,
      signature: `R:${rangeStatus}|T:${tlStatus}|L:${liquidityStatus}`
    };
  });

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const second = candidates[1];
  if (!best || best.score < minPillars) return null;
  if (second && second.score === best.score) return null;
  return best;
}

function pillarIcon(status) {
  return status === 'same' ? '✅' : '❌';
}

function getRangeBox(klines, lookback = 20) {
  if (klines.length <= lookback + 1) return { high: NaN, low: NaN, size: NaN };
  // Come il BR originale: box sulle precedenti 20 candele, non sulla candela di breakout.
  const slice = klines.slice(-(lookback + 1), -1);
  const highs = slice.map(k => k.high);
  const lows = slice.map(k => k.low);
  const high = Math.max(...highs);
  const low = Math.min(...lows);
  return { high, low, size: high - low };
}

function getRangeBoxAt(klines, index, lookback = 20) {
  if (index < lookback || index >= klines.length) return { high: NaN, low: NaN, size: NaN };
  const slice = klines.slice(index - lookback, index);
  const high = Math.max(...slice.map(k => k.high));
  const low = Math.min(...slice.map(k => k.low));
  return { high, low, size: high - low };
}

// Ricostruisce le vere rotture del Range Box sullo storico.
// Non crea un nuovo evento su ogni candela già fuori dal box: registra solo il passaggio iniziale.
function computeRangeBreakEvents(klines, lookback = 20) {
  const events = [];
  let activeDirection = null;
  for (let i = lookback; i < klines.length; i++) {
    const box = getRangeBoxAt(klines, i, lookback);
    const close = klines[i].close;
    const direction = close > box.high ? 'long' : close < box.low ? 'short' : null;

    if (!direction) {
      activeDirection = null;
      continue;
    }
    if (direction === activeDirection) continue;

    const level = direction === 'long' ? box.high : box.low;
    events.push({
      kind: 'range',
      direction,
      type: direction === 'long' ? 'RANGE_BREAK_UP' : 'RANGE_BREAK_DOWN',
      index: i,
      barTime: klines[i].time,
      level,
      price: close,
      box,
      candle: buildLuxCandleInfo(klines, i)
    });
    activeDirection = direction;
  }
  return events;
}

function latestEventForDirection(events, direction) {
  for (let i = (events || []).length - 1; i >= 0; i--) {
    if (events[i]?.direction === direction) return events[i];
  }
  return null;
}

function breakMemorySettings() {
  return {
    rangeBreakMemoryBars: CONFIG.rangeBreakMemoryBars,
    tlBreakMemoryBars: CONFIG.tlBreakMemoryBars,
    retestTolerancePct: CONFIG.retestTolerancePct,
    retestConfirmOnClose: CONFIG.retestConfirmOnClose,
    countRetestAsPillar: CONFIG.countRetestAsPillar,
    invalidationCloses: CONFIG.breakInvalidationCloses,
    invalidationTolerancePct: CONFIG.breakInvalidationTolerancePct
  };
}

function buildBreakMemory(klines, lux, rangeEvents) {
  const lastIndex = klines.length - 1;
  return {
    settings: breakMemorySettings(),
    range: {
      long: analyzeRangeMemory(klines, latestEventForDirection(rangeEvents, 'long'), 'long', lastIndex),
      short: analyzeRangeMemory(klines, latestEventForDirection(rangeEvents, 'short'), 'short', lastIndex)
    },
    tl: {
      long: analyzeTlMemory(klines, lux, latestEventForDirection(lux?.events, 'long'), 'long', lastIndex),
      short: analyzeTlMemory(klines, lux, latestEventForDirection(lux?.events, 'short'), 'short', lastIndex)
    }
  };
}

function analyzeRangeMemory(klines, event, direction, lastIndex) {
  return analyzeBreakMemory({
    klines,
    event,
    direction,
    lastIndex,
    memoryBars: CONFIG.rangeBreakMemoryBars,
    levelAt: () => Number(event?.level),
    resetAt: () => false,
    kind: 'RANGE_BOX'
  });
}

function analyzeTlMemory(klines, lux, event, direction, lastIndex) {
  return analyzeBreakMemory({
    klines,
    event,
    direction,
    lastIndex,
    memoryBars: CONFIG.tlBreakMemoryBars,
    levelAt: index => {
      const row = lux?.rows?.[index];
      return direction === 'long' ? Number(row?.upperBreakLevel) : Number(row?.lowerBreakLevel);
    },
    // Un nuovo pivot dello stesso lato resetta upos/dnos nel Pine originale: la vecchia rottura non è più attiva.
    resetAt: index => {
      if (index <= Number(event?.index)) return false;
      const row = lux?.rows?.[index];
      return direction === 'long' ? row?.ph !== null && row?.ph !== undefined : row?.pl !== null && row?.pl !== undefined;
    },
    kind: 'TL'
  });
}

function analyzeBreakMemory({ klines, event, direction, lastIndex, memoryBars, levelAt, resetAt, kind }) {
  if (!event) {
    return { kind, direction, state: 'missing', ageBars: null, valid: false, retestConfirmed: false };
  }

  const ageBars = lastIndex - event.index;
  const base = {
    kind,
    direction,
    eventType: event.type,
    eventIndex: event.index,
    eventTime: event.barTime,
    eventClose: event.price,
    eventLevel: Number(event.level ?? event.breakLevel),
    ageBars,
    memoryBars,
    valid: true,
    retestConfirmed: false,
    retest: null,
    invalidatedAt: null,
    invalidationReason: null
  };

  if (ageBars === 0) return { ...base, state: 'fresh' };
  if (ageBars > memoryBars) return { ...base, state: 'expired', valid: false };

  const tolerance = CONFIG.retestTolerancePct / 100;
  const invalidationTolerance = CONFIG.breakInvalidationTolerancePct / 100;
  let wrongSideCloses = 0;
  const eventLevel = Number(event.level ?? event.breakLevel);
  const eventCandle = klines[event.index];
  let movedAway = Number.isFinite(eventLevel) && eventCandle
    ? (direction === 'long'
      ? eventCandle.high > eventLevel * (1 + tolerance)
      : eventCandle.low < eventLevel * (1 - tolerance))
    : false;
  let latestRetest = null;

  for (let i = event.index + 1; i <= lastIndex; i++) {
    if (resetAt(i)) {
      return {
        ...base,
        state: 'invalidated',
        valid: false,
        invalidatedAt: i,
        invalidationTime: klines[i]?.time,
        invalidationReason: 'NEW_PIVOT_RESET'
      };
    }

    const candle = klines[i];
    const level = Number(levelAt(i));
    if (!candle || !Number.isFinite(level) || level <= 0) continue;

    const wrongSide = direction === 'long'
      ? candle.close < level * (1 - invalidationTolerance)
      : candle.close > level * (1 + invalidationTolerance);
    wrongSideCloses = wrongSide ? wrongSideCloses + 1 : 0;
    if (wrongSideCloses >= CONFIG.breakInvalidationCloses) {
      return {
        ...base,
        state: 'invalidated',
        valid: false,
        invalidatedAt: i,
        invalidationTime: candle.time,
        invalidationLevel: level,
        invalidationReason: `${CONFIG.breakInvalidationCloses}_CLOSES_WRONG_SIDE`
      };
    }

    if (direction === 'long') {
      if (candle.high > level * (1 + tolerance)) movedAway = true;
      const touched = candle.low <= level * (1 + tolerance) && candle.high >= level * (1 - tolerance);
      const confirmed = CONFIG.retestConfirmOnClose ? candle.close >= level : true;
      if (movedAway && touched && confirmed) {
        latestRetest = { index: i, time: candle.time, level, close: candle.close, high: candle.high, low: candle.low };
      }
    } else {
      if (candle.low < level * (1 - tolerance)) movedAway = true;
      const touched = candle.high >= level * (1 - tolerance) && candle.low <= level * (1 + tolerance);
      const confirmed = CONFIG.retestConfirmOnClose ? candle.close <= level : true;
      if (movedAway && touched && confirmed) {
        latestRetest = { index: i, time: candle.time, level, close: candle.close, high: candle.high, low: candle.low };
      }
    }
  }

  if (latestRetest) {
    return { ...base, state: 'retest_confirmed', retestConfirmed: true, retest: latestRetest };
  }
  return { ...base, state: 'recent' };
}

function directionFromRetestMemory(memoryGroup) {
  if (!CONFIG.countRetestAsPillar) return null;
  const candidates = ['long', 'short']
    .map(direction => ({ direction, info: memoryGroup?.[direction] }))
    .filter(x => x.info?.state === 'retest_confirmed')
    .sort((a, b) => a.info.ageBars - b.info.ageBars);
  if (!candidates.length) return null;
  if (candidates.length > 1 && candidates[0].info.ageBars === candidates[1].info.ageBars) return null;
  return candidates[0].direction;
}

function memorySignature(memory) {
  const one = info => `${info?.state || 'missing'}:${info?.ageBars ?? '-'}:${info?.retest?.index ?? '-'}`;
  return [
    `RL=${one(memory?.range?.long)}`,
    `RS=${one(memory?.range?.short)}`,
    `TL=${one(memory?.tl?.long)}`,
    `TS=${one(memory?.tl?.short)}`
  ].join('|');
}

// ───────────────────────── LUXALGO TRENDLINE ENGINE ─────────────────────────
function computeLuxAlgoTrendlines(klines, opts) {
  const length = Math.max(1, opts.length || 14);
  const mult = Number.isFinite(opts.mult) ? opts.mult : 1.0;
  const calcMethod = String(opts.calcMethod || 'Atr').toLowerCase();
  const n = klines.length;
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const atr = calculateAtrRma(klines, length);

  let upper = 0;
  let lower = 0;
  let slopePh = 0;
  let slopePl = 0;
  let upos = 0;
  let dnos = 0;

  let lastPivotHigh = null;
  let lastPivotLow = null;
  const pivotHighs = [];
  const pivotLows = [];

  const rows = [];
  const events = [];

  for (let i = 0; i < n; i++) {
    const ph = pivotHigh(highs, i, length);
    const pl = pivotLow(lows, i, length);
    const slope = slopeAt({ method: calcMethod, closes, atr, index: i, length, mult });

    const prevUpos = upos;
    const prevDnos = dnos;

    if (ph !== null) {
      slopePh = slope;
      lastPivotHigh = buildLuxPivotInfo(klines, i - length, i, ph, 'PIVOT_HIGH', slope);
      pivotHighs.push(lastPivotHigh);
    }
    if (pl !== null) {
      slopePl = slope;
      lastPivotLow = buildLuxPivotInfo(klines, i - length, i, pl, 'PIVOT_LOW', slope);
      pivotLows.push(lastPivotLow);
    }

    upper = ph !== null ? ph : upper - slopePh;
    lower = pl !== null ? pl : lower + slopePl;

    const upperBreakLevel = upper - slopePh * length;
    const lowerBreakLevel = lower + slopePl * length;

    upos = ph !== null ? 0 : (closes[i] > upperBreakLevel ? 1 : upos);
    dnos = pl !== null ? 0 : (closes[i] < lowerBreakLevel ? 1 : dnos);

    const upwardBreak = upos > prevUpos;
    const downwardBreak = dnos > prevDnos;

    const row = {
      index: i,
      time: klines[i].time,
      upper,
      lower,
      upperBreakLevel,
      lowerBreakLevel,
      slopePh,
      slopePl,
      ph,
      pl,
      upos,
      dnos,
      upwardBreak,
      downwardBreak
    };
    rows.push(row);

    if (upwardBreak) {
      events.push({
        direction: 'long',
        type: 'UPPER_BREAK',
        index: i,
        barTime: klines[i].time,
        price: closes[i],
        breakLevel: upperBreakLevel,
        markerPrice: lows[i],
        markerAnchor: 'LOW della candela B',
        label: 'B',
        candle: buildLuxCandleInfo(klines, i),
        pivot: lastPivotHigh,
        upperPivot: lastPivotHigh,
        lowerPivot: lastPivotLow,
        formula: 'close > upper - slope_ph * length',
        upper,
        lower,
        upperLevelAtBreak: upperBreakLevel,
        lowerLevelAtBreak: lowerBreakLevel,
        slopePh,
        slopePl
      });
    }
    if (downwardBreak) {
      events.push({
        direction: 'short',
        type: 'LOWER_BREAK',
        index: i,
        barTime: klines[i].time,
        price: closes[i],
        breakLevel: lowerBreakLevel,
        markerPrice: highs[i],
        markerAnchor: 'HIGH della candela B',
        label: 'B',
        candle: buildLuxCandleInfo(klines, i),
        pivot: lastPivotLow,
        upperPivot: lastPivotHigh,
        lowerPivot: lastPivotLow,
        formula: 'close < lower + slope_pl * length',
        upper,
        lower,
        upperLevelAtBreak: upperBreakLevel,
        lowerLevelAtBreak: lowerBreakLevel,
        slopePh,
        slopePl
      });
    }
  }

  return {
    rows,
    events,
    last: rows.at(-1),
    lastEvent: events.at(-1) || null,
    lastPivotHigh,
    lastPivotLow,
    pivotHighs,
    pivotLows
  };
}

function buildLuxCandleInfo(klines, index) {
  const k = klines[index];
  if (!k) return null;
  return {
    index,
    time: k.time,
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume
  };
}

function buildLuxPivotInfo(klines, pivotIndex, confirmedAtIndex, value, type, slope) {
  const k = klines[pivotIndex];
  const confirmed = klines[confirmedAtIndex];
  if (!k) return null;
  return {
    type,
    index: pivotIndex,
    confirmedAtIndex,
    time: k.time,
    confirmedAtTime: confirmed?.time || null,
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    value,
    slope
  };
}

function pivotHigh(highs, index, length) {
  const pivotIndex = index - length;
  if (pivotIndex < length || pivotIndex < 0) return null;
  const value = highs[pivotIndex];
  for (let j = pivotIndex - length; j <= pivotIndex + length; j++) {
    if (j < 0 || j >= highs.length) return null;
    if (highs[j] > value) return null;
  }
  return value;
}

function pivotLow(lows, index, length) {
  const pivotIndex = index - length;
  if (pivotIndex < length || pivotIndex < 0) return null;
  const value = lows[pivotIndex];
  for (let j = pivotIndex - length; j <= pivotIndex + length; j++) {
    if (j < 0 || j >= lows.length) return null;
    if (lows[j] < value) return null;
  }
  return value;
}

function buildPivotLevels(klines, currentPrice) {
  const left = Math.max(1, CONFIG.srPivotLeft);
  const right = Math.max(1, CONFIG.srPivotRight);
  const quickRight = Math.max(1, CONFIG.srQuickRight);

  // Replica della sezione Support & Resistance di EzAlgo V.5:
  // level1 = ultimo quick pivot high (50,5)
  // level2 = ultimo quick pivot low  (50,5)
  // level3/5/7 = ultimi tre pivot high regolari (50,25)
  // level4/6/8 = ultimi tre pivot low regolari  (50,25)
  const quickHighs = collectConfirmedPivots(klines, 'high', left, quickRight, 'QUICK_PIVOT_HIGH');
  const quickLows = collectConfirmedPivots(klines, 'low', left, quickRight, 'QUICK_PIVOT_LOW');
  const regularHighs = collectConfirmedPivots(klines, 'high', left, right, 'PIVOT_HIGH');
  const regularLows = collectConfirmedPivots(klines, 'low', left, right, 'PIVOT_LOW');

  const qh = quickHighs.at(-1) || null;
  const ql = quickLows.at(-1) || null;
  const rh = regularHighs.slice(-3).reverse();
  const rl = regularLows.slice(-3).reverse();

  const rawLevels = [
    withLevelName(qh, 'level1', 'QUICK HIGH'),
    withLevelName(ql, 'level2', 'QUICK LOW'),
    withLevelName(rh[0], 'level3', 'PIVOT HIGH 0'),
    withLevelName(rl[0], 'level4', 'PIVOT LOW 0'),
    withLevelName(rh[1], 'level5', 'PIVOT HIGH 1'),
    withLevelName(rl[1], 'level6', 'PIVOT LOW 1'),
    withLevelName(rh[2], 'level7', 'PIVOT HIGH 2'),
    withLevelName(rl[2], 'level8', 'PIVOT LOW 2')
  ].filter(Boolean);

  // EzAlgo colora ogni livello in base alla posizione del close:
  // qualunque livello sopra il prezzo è resistenza; qualunque livello sotto è supporto.
  // Non limitiamo quindi "high sopra" e "low sotto": un vecchio massimo rotto può diventare supporto.
  const above = nearestDistinctSrLevels(
    rawLevels.filter(p => Number(p.value) > currentPrice),
    true,
    CONFIG.srLevelsAbove
  );
  const below = nearestDistinctSrLevels(
    rawLevels.filter(p => Number(p.value) < currentPrice),
    false,
    CONFIG.srLevelsBelow
  );

  return {
    method: 'EZALGO_V5_SR_EXACT',
    settings: { left, right, quickRight },
    currentPrice,
    rawLevels,
    above,
    below
  };
}

function collectConfirmedPivots(klines, side, left, right, type) {
  const out = [];
  if (!Array.isArray(klines) || klines.length < left + right + 1) return out;

  for (let confirmedAtIndex = left + right; confirmedAtIndex < klines.length; confirmedAtIndex++) {
    const pivotIndex = confirmedAtIndex - right;
    const pivotCandle = klines[pivotIndex];
    if (!pivotCandle) continue;
    const value = side === 'high' ? pivotCandle.high : pivotCandle.low;
    if (!Number.isFinite(value)) continue;

    let valid = true;
    for (let j = pivotIndex - left; j <= pivotIndex + right; j++) {
      const candle = klines[j];
      if (!candle) { valid = false; break; }
      if (side === 'high' && candle.high > value) { valid = false; break; }
      if (side === 'low' && candle.low < value) { valid = false; break; }
    }
    if (!valid) continue;

    const confirmed = klines[confirmedAtIndex];
    out.push({
      type,
      side: side.toUpperCase(),
      value,
      index: pivotIndex,
      confirmedAtIndex,
      time: pivotCandle.time,
      confirmedAtTime: confirmed?.time || null,
      open: pivotCandle.open,
      high: pivotCandle.high,
      low: pivotCandle.low,
      close: pivotCandle.close
    });
  }
  return out;
}

function withLevelName(level, levelName, sourceLabel) {
  if (!level) return null;
  return { ...level, levelName, sourceLabel };
}

function nearestDistinctSrLevels(levels, above, wanted) {
  const sorted = [...levels].sort((a, b) => above ? a.value - b.value : b.value - a.value);
  const out = [];
  for (const p of sorted) {
    if (!p || !Number.isFinite(Number(p.value))) continue;
    const duplicate = out.some(x => pctDistance(x.value, p.value) <= CONFIG.srMergeTolerancePct);
    if (duplicate) continue;
    out.push({
      levelName: p.levelName,
      sourceLabel: p.sourceLabel,
      type: p.type,
      side: p.side,
      value: p.value,
      time: p.time,
      confirmedAtTime: p.confirmedAtTime,
      high: p.high,
      low: p.low,
      open: p.open,
      close: p.close,
      index: p.index,
      confirmedAtIndex: p.confirmedAtIndex
    });
    if (out.length >= wanted) break;
  }
  return out;
}

function calculateAtrRma(klines, length) {
  const tr = [];
  for (let i = 0; i < klines.length; i++) {
    const h = klines[i].high;
    const l = klines[i].low;
    const pc = i > 0 ? klines[i - 1].close : klines[i].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  const out = new Array(klines.length).fill(NaN);
  let seed = 0;
  for (let i = 0; i < tr.length; i++) {
    if (i < length) {
      seed += tr[i];
      if (i === length - 1) out[i] = seed / length;
    } else {
      out[i] = (out[i - 1] * (length - 1) + tr[i]) / length;
    }
  }
  return out;
}

function slopeAt({ method, closes, atr, index, length, mult }) {
  if (method === 'stdev') return stdev(closes, index, length) / length * mult;
  if (method === 'linreg') return linregSlopeLux(closes, index, length) * mult;
  const v = atr[index];
  return Number.isFinite(v) ? v / length * mult : 0;
}

function stdev(values, index, length) {
  if (index < length - 1) return 0;
  const slice = values.slice(index - length + 1, index + 1);
  const mean = slice.reduce((s, v) => s + v, 0) / length;
  const variance = slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / length;
  return Math.sqrt(variance);
}

function linregSlopeLux(values, index, length) {
  if (index < length - 1) return 0;
  const start = index - length + 1;
  const xs = [];
  const ys = [];
  for (let i = start; i <= index; i++) {
    xs.push(i);
    ys.push(values[i]);
  }
  const smaXY = xs.reduce((s, x, k) => s + x * ys[k], 0) / length;
  const smaY = ys.reduce((s, y) => s + y, 0) / length;
  const smaX = xs.reduce((s, x) => s + x, 0) / length;
  const varianceX = xs.reduce((s, x) => s + Math.pow(x - smaX, 2), 0) / length;
  if (varianceX <= 0) return 0;
  return Math.abs(smaXY - smaY * smaX) / varianceX / 2;
}

function findRecentBreakEvent(events, lastIndex, maxAge) {
  for (let i = (events || []).length - 1; i >= 0; i--) {
    const e = events[i];
    if (lastIndex - e.index <= maxAge) return e;
    if (lastIndex - e.index > maxAge) break;
  }
  return null;
}

function findRecentTlBreak(events, lastIndex, maxAge) {
  return findRecentBreakEvent(events, lastIndex, maxAge);
}

// ───────────────────────── LIQUIDITY ENGINE 0.4.7J-LIKE ─────────────────────────
function evaluateLiquidity(direction, snapshots) {
  const votes = [];
  for (const snap of snapshots || []) {
    if (!snap) continue;
    votes.push(voteExchange(direction, snap));
  }
  const available = votes.length;
  const confirms = votes.filter(v => v.vote === 'CONFIRM').length;
  const contrary = votes.filter(v => v.vote === 'CONTRA').length;
  const required = Math.max(2, CONFIG.requiredConfirmations);
  const confirmed = confirms >= required;

  let status;
  let friendlyLine;
  let reason;
  if (available < required) {
    status = 'WAIT_EXCHANGES';
    friendlyLine = `LIQUIDITY ENGINE: ATTESA DATI ${required}/3`;
    reason = `Servono almeno ${required} exchange disponibili per confermare il segnale.`;
  } else if (confirmed) {
    status = 'CONFIRMED_2_OF_3';
    friendlyLine = `LIQUIDITY ENGINE: CONFERMA ${direction} ${confirms}/${available}`;
    reason = `Almeno ${required} exchange confermano direzione e pressione coerente.`;
  } else if (contrary >= required) {
    status = 'REJECTED_2_OF_3';
    friendlyLine = `LIQUIDITY ENGINE: NON CONFERMA ${direction}`;
    reason = `Almeno ${required} exchange sono contrari o non coerenti con il segnale.`;
  } else {
    status = 'NEUTRAL';
    friendlyLine = `LIQUIDITY ENGINE: NEUTRO ${confirms}/${available}`;
    reason = 'Conferma multi-exchange insufficiente: meglio non inviare notifica operativa aggressiva.';
  }

  // Telegram mostra sempre la maggioranza sul totale teorico dei tre exchange.
  // `available` resta nei log/audit per distinguere 2 dati disponibili da 3.
  return { confirmed, confirms, available, contrary, direction, status, friendlyLine, reason, votes, scoreLabel: `${confirms}/3` };
}

function voteExchange(direction, snap) {
  let s = 0;
  const reasons = [];
  const bid = snap.bidPressure;
  const ask = snap.askPressure;
  const delta = snap.deltaProxy;
  const velocity = snap.velocity;
  const spread = snap.spreadPct;

  if (direction === 'LONG') {
    if (bid > ask * 1.10) { s += 2; reasons.push('pressione compratrice'); }
    if (delta > 0) { s += 2; reasons.push('delta positivo'); }
    if (ask > bid * 1.20) { s -= 2; reasons.push('pressione venditrice contraria'); }
    if (delta < 0) { s -= 2; reasons.push('delta negativo contrario'); }
  } else if (direction === 'SHORT') {
    if (ask > bid * 1.10) { s += 2; reasons.push('pressione venditrice'); }
    if (delta < 0) { s += 2; reasons.push('delta negativo'); }
    if (bid > ask * 1.20) { s -= 2; reasons.push('pressione compratrice contraria'); }
    if (delta > 0) { s -= 2; reasons.push('delta positivo contrario'); }
  }

  if (velocity > CONFIG.minVelocityActive) { s += 1; reasons.push('book attivo'); }
  if (spread < CONFIG.minSpreadOkPct) { s += 1; reasons.push('spread regolare'); }

  const vote = s >= 3 ? 'CONFIRM' : s <= -2 ? 'CONTRA' : 'NEUTRAL';
  return { exchange: snap.exchange, vote, score: s, reason: reasons.join('; ') || 'flow misto' };
}

function buildAutoClusters(symbol, snapshots) {
  const valid = (snapshots || []).filter(Boolean);
  const mid = average(valid.map(s => s.mid).filter(v => v > 0));
  if (!mid) return { symbol, mid: 0, above: [], below: [], source: 'NO_EXCHANGE_DATA', updatedAt: new Date().toISOString() };

  const candidates = [];
  for (const snap of valid) {
    addClusterCandidate(candidates, symbol, snap.exchange, snap.strongestBidPrice, snap.strongestBidQty, mid, 'BID_WALL');
    addClusterCandidate(candidates, symbol, snap.exchange, snap.strongestAskPrice, snap.strongestAskQty, mid, 'ASK_WALL');
  }

  const merged = mergeNearby(candidates, mid, CONFIG.mergeTolerancePct);
  const belowRaw = merged.filter(c => c.price < mid).sort((a, b) => b.score - a.score).slice(0, CONFIG.levelsBelow);
  const aboveRaw = merged.filter(c => c.price > mid).sort((a, b) => b.score - a.score).slice(0, CONFIG.levelsAbove);

  const below = fillMissingLevels(belowRaw, mid, false, CONFIG.levelsBelow).sort((a, b) => b.price - a.price);
  const above = fillMissingLevels(aboveRaw, mid, true, CONFIG.levelsAbove).sort((a, b) => a.price - b.price);
  const out = { symbol, mid, above, below, source: 'EVENT_DRIVEN_LIVE_ORDERBOOK_EXCHANGE_CLUSTERS', updatedAt: new Date().toISOString() };
  runtime.lastClusters[symbol] = out;
  return out;
}

function addClusterCandidate(out, symbol, exchange, price, qty, mid, source) {
  if (!(price > 0) || !(qty > 0)) return;
  if (mid > 0) {
    const distancePct = Math.abs(price - mid) / mid * 100;
    if (distancePct > Math.max(0.1, CONFIG.maxClusterDistancePct)) return;
  }
  out.push({ symbol, exchange: exchange || 'UNKNOWN', price, score: Math.max(0.1, qty), source: source || 'BOOK' });
}

function mergeNearby(candidates, mid, tolerancePct) {
  const sorted = candidates.filter(c => c.price > 0).sort((a, b) => a.price - b.price);
  const out = [];
  let bucket = [];
  for (const c of sorted) {
    if (!bucket.length) { bucket.push(c); continue; }
    const bucketAvg = weightedPrice(bucket);
    const base = mid > 0 ? mid : Math.max(1, bucketAvg);
    const pct = Math.abs(c.price - bucketAvg) / base * 100;
    if (pct <= tolerancePct) bucket.push(c);
    else { out.push(toCluster(bucket)); bucket = [c]; }
  }
  if (bucket.length) out.push(toCluster(bucket));
  return out.filter(c => c.score >= 0.1).sort((a, b) => b.score - a.score);
}

function toCluster(bucket) {
  const score = bucket.reduce((s, c) => s + c.score, 0);
  const price = weightedPrice(bucket);
  const exchanges = [...new Set(bucket.map(c => c.exchange))].sort();
  const sources = [...new Set(bucket.map(c => c.source))].sort();
  return { price, score, exchangeCount: exchanges.length, exchanges: exchanges.join('+'), sources: sources.join('+') };
}

function weightedPrice(bucket) {
  const w = bucket.reduce((s, c) => s + c.score, 0);
  if (w <= 0) return average(bucket.map(c => c.price));
  return bucket.reduce((s, c) => s + c.price * c.score, 0) / w;
}

function fillMissingLevels(source, mid, above, wanted) {
  const out = Array.isArray(source) ? [...source] : [];
  let step = 1;
  while (out.length < wanted && step <= 8) {
    const pct = 0.35 * step;
    const price = above ? mid * (1 + pct / 100) : mid * (1 - pct / 100);
    const exists = out.some(c => pctDistance(c.price, price) <= 0.05);
    if (!exists) out.push({ price, score: 0.5, exchangeCount: 0, exchanges: 'FALLBACK', sources: 'PRICE_LADDER_FILL' });
    step++;
  }
  return out.slice(0, wanted);
}

function buildOperationalMap(symbol, interval, direction, entryRef, rangeBox, clusters) {
  const isLong = direction === 'long';
  const targets = directionalLevels(isLong ? clusters.above : clusters.below, entryRef, isLong, true);
  const protections = directionalLevels(isLong ? clusters.below : clusters.above, entryRef, isLong, false);
  const retailPool = protections?.[0]?.price || 0;
  const protectiveStop = estimateProtectiveStop(direction, retailPool, entryRef, rangeBox);
  const targetLines = classifyMapLines(targets, `TARGET_${isLong ? 'LONG' : 'SHORT'}`, retailPool, true);
  const protectionLines = classifyMapLines(protections, isLong ? 'SUPPORTO_INVALIDAZIONE' : 'RESISTENZA_INVALIDAZIONE', retailPool, false);
  const stopWarning = buildStopWarning(direction, retailPool, protectiveStop, entryRef);

  return {
    symbol,
    interval,
    direction: direction.toUpperCase(),
    entryRef,
    targets: targetLines,
    protections: protectionLines,
    retailLiquidityPool: retailPool,
    protectiveStopEstimate: protectiveStop,
    stopWarning,
    confluenceSummary: buildConfluenceSummary(targetLines, protectionLines, retailPool, protectiveStop, stopWarning),
    source: 'NODE_PORT_0_4_7J_AUTOCLUSTER'
  };
}

function directionalLevels(levels, entryRef, isLong, target) {
  if (!Array.isArray(levels) || entryRef <= 0) return [];
  return levels.filter(c => {
    if (!c || c.price <= 0) return false;
    if (isLong && target) return c.price > entryRef;
    if (isLong && !target) return c.price < entryRef;
    if (!isLong && target) return c.price < entryRef;
    return c.price > entryRef;
  });
}

function classifyMapLines(levels, role, retailStop, target) {
  return (levels || [])
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(c => {
      let score = Math.min(60, c.score * 10) + Math.min(20, c.exchangeCount * 7);
      if (retailStop > 0 && pctDistance(c.price, retailStop) <= 0.35) score += target ? 5 : 12;
      return {
        price: c.price,
        score: Math.max(1, Math.min(100, Math.round(score))),
        role,
        reason: `${c.exchangeCount}/3 exchange + ${c.sources}`,
        exchanges: c.exchanges
      };
    });
}

function estimateProtectiveStop(direction, retailPool, entryRef, rangeBox) {
  const fallbackBox = Number.isFinite(rangeBox?.size) && rangeBox.size > 0 ? rangeBox.size : entryRef * 0.01;
  if (retailPool > 0) {
    const distancePct = Math.abs(entryRef - retailPool) / Math.max(1, entryRef) * 100;
    const bufferPct = distancePct > 1.0 ? 0.30 : 0.20;
    return direction === 'long' ? retailPool * (1 - bufferPct / 100) : retailPool * (1 + bufferPct / 100);
  }
  return direction === 'long' ? entryRef - fallbackBox * 0.5 : entryRef + fallbackBox * 0.5;
}

function buildStopWarning(direction, retailPool, protectiveStop, entryRef) {
  if (!(retailPool > 0)) return '';
  if (direction === 'long' && protectiveStop >= entryRef) return 'SL protettivo non direzionale per LONG';
  if (direction === 'short' && protectiveStop <= entryRef) return 'SL protettivo non direzionale per SHORT';
  return 'SL nostro separato dal retail liquidity pool';
}

function buildConfluenceSummary(targets, protections, retailPool, protectiveStop, stopWarning) {
  const pieces = [];
  if (targets?.length) pieces.push(`target ${formatPrice(targets[0].price)} score ${targets[0].score}`);
  if (protections?.length) pieces.push(`protezione ${formatPrice(protections[0].price)} score ${protections[0].score}`);
  if (retailPool > 0) pieces.push(`retail pool ${formatPrice(retailPool)}`);
  if (protectiveStop > 0) pieces.push(`our SL ${formatPrice(protectiveStop)}`);
  if (stopWarning) pieces.push(stopWarning);
  return pieces.join('; ') || 'nessuna confluenza forte';
}

function formatLuxAudit(tlConfirm) {
  if (!tlConfirm) return '• Nessuna candela LuxAlgo B disponibile';

  const c = tlConfirm.candle || {};
  const p = tlConfirm.pivot || {};
  const upperPivot = tlConfirm.upperPivot || {};
  const lowerPivot = tlConfirm.lowerPivot || {};
  const lines = [];

  lines.push(`• Candela BREAK/B index: ${safeVal(c.index)} | time UTC: ${formatTimestamp(c.time)} | Italia: ${formatTimestampIT(c.time)}`);
  lines.push(`• Candela BREAK/B O/H/L/C: O $${formatPrice(c.open)} / H $${formatPrice(c.high)} / L $${formatPrice(c.low)} / C $${formatPrice(c.close)}`);
  lines.push(`• Trigger LuxAlgo esatto rotto: $${formatPrice(tlConfirm.breakLevel)} | Close usato: $${formatPrice(tlConfirm.price)}`);
  lines.push(`• Marker LuxAlgo B agganciato a: ${tlConfirm.markerAnchor || 'N/A'} = $${formatPrice(tlConfirm.markerPrice)}`);

  lines.push('');
  lines.push('📌 Origine TL che ha generato la rottura');
  lines.push(`• Pivot usato dalla formula: ${p.type || 'N/A'} index ${safeVal(p.index)} | time UTC: ${formatTimestamp(p.time)} | Italia: ${formatTimestampIT(p.time)}`);
  lines.push(`• Pivot O/H/L/C: O $${formatPrice(p.open)} / H $${formatPrice(p.high)} / L $${formatPrice(p.low)} / C $${formatPrice(p.close)} | valore pivot: $${formatPrice(p.value)}`);
  lines.push(`• Pivot confermato a index ${safeVal(p.confirmedAtIndex)} | time UTC: ${formatTimestamp(p.confirmedAtTime)} | Italia: ${formatTimestampIT(p.confirmedAtTime)} | length ${CONFIG.luxLength}`);

  lines.push('');
  lines.push('🔺 Triangolo attivo LuxAlgo, entrambe le TL');
  lines.push(formatPivotAnchor('TL ALTA / Upper da PIVOT_HIGH', upperPivot, 'upper'));
  lines.push(formatPivotAnchor('TL BASSA / Lower da PIVOT_LOW', lowerPivot, 'lower'));
  lines.push(`• Livello Upper sulla candela break: $${formatPrice(tlConfirm.upperLevelAtBreak)}`);
  lines.push(`• Livello Lower sulla candela break: $${formatPrice(tlConfirm.lowerLevelAtBreak)}`);
  lines.push(`• Slope usata: PH ${formatNumber(tlConfirm.slopePh)} / PL ${formatNumber(tlConfirm.slopePl)}`);

  lines.push('• Nota: LuxAlgo non collega due pivot reali come una TL manuale; il secondo punto e\' sintetico: pivot +/- slope. Quindi il confronto preciso va fatto su pivot O/H/L/C + slope + livello proiettato.');

  return lines.join('\n');
}

function formatPivotAnchor(title, p, side) {
  if (!p || p.index === undefined || p.index === null) return `• ${title}: N/A`;
  const nextSynthetic = side === 'upper' ? p.value - p.slope : p.value + p.slope;
  const direction = side === 'upper' ? 'pivot - slope' : 'pivot + slope';
  return `• ${title}: index ${safeVal(p.index)} | time UTC ${formatTimestamp(p.time)} | Italia ${formatTimestampIT(p.time)} | O/H/L/C O $${formatPrice(p.open)} / H $${formatPrice(p.high)} / L $${formatPrice(p.low)} / C $${formatPrice(p.close)} | pivot $${formatPrice(p.value)} | punto sint. +1 (${direction}) $${formatPrice(nextSynthetic)}`;
}

function lightLuxEvent(e) {
  return {
    direction: e.direction,
    type: e.type,
    index: e.index,
    time: formatTimestamp(e.barTime),
    breakCandle: e.candle,
    breakLevel: e.breakLevel,
    upperRawAtBreak: e.upper,
    lowerRawAtBreak: e.lower,
    upperTriggerExact: e.upperLevelAtBreak,
    lowerTriggerExact: e.lowerLevelAtBreak,
    formula: e.formula,
    pivotUsed: e.pivot,
    upperPivot: e.upperPivot,
    lowerPivot: e.lowerPivot,
    slopePh: e.slopePh,
    slopePl: e.slopePl
  };
}

function safeVal(v) {
  return v === undefined || v === null || Number.isNaN(v) ? 'N/A' : String(v);
}

function formatTimestamp(ts) {
  if (!ts) return 'N/A';
  const n = Number(ts);
  if (!Number.isFinite(n)) return 'N/A';
  return new Date(n).toISOString();
}

function formatTimestampIT(ts) {
  if (!ts) return 'N/A';
  const n = Number(ts);
  if (!Number.isFinite(n)) return 'N/A';
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).format(new Date(n));
}

function formatNumber(v, decimals = 8) {
  if (v === undefined || v === null || Number.isNaN(Number(v))) return 'N/A';
  return Number(v).toFixed(decimals);
}

// ───────────────────────── MESSAGGIO ─────────────────────────
function formatDirectionalClusterList(levels, direction) {
  const selected = direction === 'long' ? (levels?.above || []) : (levels?.below || []);
  if (!selected.length) return '1. N/A\n2. N/A\n3. N/A';
  return [0, 1, 2].map(i => `${i + 1}. ${selected[i] ? '$' + formatPrice(selected[i].price) : 'N/A'}`).join('\n');
}

function formatPivotList(pivots, label) {
  const arr = Array.isArray(pivots) ? pivots : [];
  return [0, 1, 2].map(i => `${label}${i + 1}: ${arr[i] ? '$' + formatPrice(arr[i].value) : 'N/A'}`).join('\n');
}

function buildEntryState({ direction, entry, livePrice, rangeBoundary, tlLevel }) {
  const noChaseDistance = entry * CONFIG.noChasePct / 100;
  const tooFar = direction === 'long'
    ? livePrice > entry + noChaseDistance
    : livePrice < entry - noChaseDistance;

  const distances = [rangeBoundary, tlLevel]
    .filter(Number.isFinite)
    .map(level => pctDistance(livePrice, level));
  const nearBreak = distances.length > 0 && Math.min(...distances) <= CONFIG.nearBreakPct;

  if (tooFar) {
    return {
      title: '🟡 NO CHASE',
      detail: 'Prezzo live già troppo distante dall’entry tecnica. Attendere un retest.'
    };
  }
  if (nearBreak) {
    return {
      title: '⚠️ ATTENZIONE ENTRY — VICINO ALLA ROTTURA',
      detail: 'Prezzo vicino al bordo Range Box o alla TL: attendere tenuta o retest respinto.'
    };
  }
  return {
    title: '🟢 PREZZO IN ZONA OPERATIVA',
    detail: 'Il prezzo non è ancora oltre il limite NO CHASE.'
  };
}

function oppositeDirection(direction) {
  return direction === 'long' ? 'short' : 'long';
}

function sideLabel(direction) {
  return direction === 'long' ? 'LONG' : 'SHORT';
}

function selectedBreakMemory(ctx, pillar) {
  const direction = ctx?.direction;
  return ctx?.breakMemory?.[pillar]?.[direction] || null;
}

function memoryStateLabel(info) {
  if (!info) return 'missing';
  return info.state || 'missing';
}

function breakMemoryLines(info, label, direction) {
  const side = sideLabel(direction);
  if (!info || info.state === 'missing') return [`• ${label}: ❌ NON ANCORA ROTTA ${side}`];

  const level = Number(info.retest?.level ?? info.eventLevel);
  const levelText = Number.isFinite(level) ? ` @ $${formatPrice(level)}` : '';
  const ageText = Number.isFinite(info.ageBars) ? `${info.ageBars} candele fa` : 'tempo N/A';

  if (info.state === 'fresh') {
    return [`• ${label}: ✅ ROTTURA FRESCA ${side}${levelText}`];
  }
  if (info.state === 'retest_confirmed') {
    return [
      `• ${label}: 🟡 ROTTA ${ageText} — RETEST CONFERMATO ${side}`,
      `  Livello retest $${formatPrice(info.retest?.level)} | Close $${formatPrice(info.retest?.close)}`
    ];
  }
  if (info.state === 'recent') {
    return [
      `• ${label}: 🟡 ROTTA ${ageText} — ANCORA IN MEMORIA ${side}${levelText}`,
      '  Rottura precedente valida, ma non conta come nuova conferma verde.'
    ];
  }
  if (info.state === 'invalidated') {
    return [
      `• ${label}: ❌ ROTTURA PRECEDENTE INVALIDATA ${side}`,
      `  Motivo: ${info.invalidationReason || 'rientro stabile dal lato opposto'}`
    ];
  }
  if (info.state === 'expired') {
    return [`• ${label}: ❌ ROTTURA SCADUTA — ${ageText}`];
  }
  return [`• ${label}: ❌ STATO NON DISPONIBILE`];
}

function hasRecentBreakContext(ctx, pillar) {
  const state = memoryStateLabel(selectedBreakMemory(ctx, pillar));
  return state === 'recent' || state === 'retest_confirmed';
}

function buildRangeStatusLines(ctx) {
  const { direction, rangeDirection, rangeBox, lastPrice, majority } = ctx;
  const target = sideLabel(direction);
  if (majority.rangeStatus === 'same') {
    const isLong = direction === 'long';
    const boundary = isLong ? rangeBox.high : rangeBox.low;
    return [
      `• RANGE BOX ${CONFIG.rangeLookback}: ${isLong ? 'ROTTO SOPRA' : 'ROTTO SOTTO'} ✅ ${target}`,
      `  Close $${formatPrice(lastPrice)} ${isLong ? '>' : '<'} ${isLong ? 'resistenza' : 'supporto'} Box $${formatPrice(boundary)}`
    ];
  }
  if (majority.rangeStatus === 'opposite') {
    const actual = sideLabel(rangeDirection);
    return [
      `• RANGE BOX ${CONFIG.rangeLookback}: ❌ OPPOSTO ${actual}`,
      `  Box H $${formatPrice(rangeBox.high)} | L $${formatPrice(rangeBox.low)}`
    ];
  }

  const memory = selectedBreakMemory(ctx, 'range');
  const memoryLines = breakMemoryLines(memory, `RANGE BOX ${CONFIG.rangeLookback}`, direction);
  if (memory?.state === 'missing') {
    memoryLines.push(`  Supporto $${formatPrice(rangeBox.low)} | Resistenza $${formatPrice(rangeBox.high)}`);
  }
  return memoryLines;
}

function buildTlStatusLines(ctx) {
  const { direction, tlDirection, tlConfirm, lastPrice, majority } = ctx;
  const target = sideLabel(direction);
  if (majority.tlStatus === 'same') {
    const isLong = direction === 'long';
    return [
      `• TL: ${tlConfirm?.type || (isLong ? 'UPPER_BREAK' : 'LOWER_BREAK')} ✅ ${target}`,
      `  Close $${formatPrice(lastPrice)} ${isLong ? '>' : '<'} livello TL $${formatPrice(tlConfirm?.breakLevel)}`
    ];
  }
  if (majority.tlStatus === 'opposite') {
    return [
      `• TL: ${tlConfirm?.type || 'BREAK'} ❌ OPPOSTA ${sideLabel(tlDirection)}`,
      `  Livello TL $${formatPrice(tlConfirm?.breakLevel)}`
    ];
  }

  return breakMemoryLines(selectedBreakMemory(ctx, 'tl'), 'TL', direction);
}

function liquidityDisplayStatus(ctx) {
  const { direction, liquidityState, majority } = ctx;
  const targetEval = direction === 'long' ? liquidityState.long : liquidityState.short;
  if (majority.liquidityStatus === 'same') return 'same';
  if (majority.liquidityStatus === 'opposite') return 'opposite';
  if (targetEval?.status === 'REJECTED_2_OF_3') return 'opposite';
  return 'missing';
}

function buildLiquidityStatusLines(ctx) {
  const { direction, liquidityState } = ctx;
  const targetEval = direction === 'long' ? liquidityState.long : liquidityState.short;
  const oppositeEval = direction === 'long' ? liquidityState.short : liquidityState.long;
  const displayStatus = liquidityDisplayStatus(ctx);
  if (displayStatus === 'same') {
    return [`• LIQUIDITY ${targetEval.scoreLabel} ✅ ${sideLabel(direction)}`];
  }
  if (displayStatus === 'opposite') {
    const contraryScore = oppositeEval.confirmed
      ? oppositeEval.scoreLabel
      : `${targetEval.contrary}/3`;
    return [`• LIQUIDITY ${contraryScore} ❌ CONTRARIA ${sideLabel(oppositeDirection(direction))}`];
  }
  return [`• LIQUIDITY ${targetEval.scoreLabel} ❌ NON CONFERMATA`];
}

function buildActionLines(ctx, entryState) {
  const { majority } = ctx;
  const liquidityStatus = liquidityDisplayStatus(ctx);
  const lines = [];

  if (majority.score === 3) {
    lines.push('🚨 CONFERMA COMPLETA 3/3');
  } else {
    lines.push(`🟡 SEGNALE 2/3 — ${activePillarLabel(majority)}`);
  }

  if (majority.rangeStatus !== 'same') {
    if (majority.rangeStatus === 'opposite') {
      lines.push('Range Box opposto alla direzione prevalente: attendere riallineamento.');
    } else if (hasRecentBreakContext(ctx, 'range')) {
      lines.push('Range Box già rotto nelle candele precedenti: contesto/retest visibile in giallo, ma non è una nuova conferma verde.');
    } else {
      lines.push('Range Box non ancora rotto oppure rottura scaduta/invalidata.');
    }
  }
  if (majority.tlStatus !== 'same') {
    if (majority.tlStatus === 'opposite') {
      lines.push('TL rotta nella direzione opposta: rischio di conflitto tecnico.');
    } else if (hasRecentBreakContext(ctx, 'tl')) {
      lines.push('TL già rotta nelle candele precedenti: possibile retest, mostrato in giallo e non contato come nuova conferma.');
    } else {
      lines.push('TL non ancora rotta oppure rottura scaduta/invalidata.');
    }
  }
  if (liquidityStatus !== 'same') {
    lines.push(liquidityStatus === 'opposite'
      ? 'Exchange contrari: segnale tecnico presente, ma non è una entry pienamente confermata.'
      : 'Exchange non confermano ancora: usare prudenza e attendere il flow.');
  }
  lines.push(entryState.title, entryState.detail);
  return lines;
}

function activePillarLabel(majority) {
  const active = [];
  if (majority.tlStatus === 'same') active.push('TL');
  if (majority.rangeStatus === 'same') active.push('RANGE BOX');
  if (majority.liquidityStatus === 'same') active.push('LIQUIDITY');
  return active.join(' + ') || 'PILASTRI NON DEFINITI';
}

function buildPivotWarning(ctx) {
  const { direction, livePrice, lastPrice, rangeBox, tlConfirm, pivotLevels } = ctx;
  const relevant = direction === 'long'
    ? pivotLevels?.above?.[0]
    : pivotLevels?.below?.[0];
  if (!relevant || !Number.isFinite(Number(relevant.value))) return null;

  const rangeBoundary = direction === 'long' ? rangeBox.high : rangeBox.low;
  const references = [livePrice, lastPrice, rangeBoundary, tlConfirm?.breakLevel]
    .filter(Number.isFinite);
  if (!references.length) return null;

  const distance = Math.min(...references.map(v => pctDistance(v, Number(relevant.value))));
  if (distance > CONFIG.pivotWarningPct) return null;

  const code = direction === 'long' ? 'R1' : 'S1';
  const role = direction === 'long' ? 'resistenza' : 'supporto';
  return {
    code,
    role,
    price: Number(relevant.value),
    distance
  };
}

function buildOperationalMessage(ctx, levels) {
  const { symbol, interval, lastPrice, livePrice, rangeBox, direction, tlConfirm, clusters, pivotLevels, majority } = ctx;
  const emoji = coinEmojis[symbol] || '🔸';
  const isLong = direction === 'long';
  const side = sideLabel(direction);
  const sideIcon = isLong ? '🟢' : '🔴';
  const rangeBoundary = isLong ? rangeBox.high : rangeBox.low;
  const entryState = buildEntryState({
    direction,
    entry: lastPrice,
    livePrice,
    rangeBoundary,
    tlLevel: tlConfirm?.breakLevel
  });

  const confirmationTitle = majority.score === 3
    ? `🚨 CONFERMA COMPLETA ${majority.score}/3`
    : `🟡 SEGNALE ${majority.score}/3`;

  const confirmationLines = [
    ...buildTlStatusLines(ctx),
    ...buildRangeStatusLines(ctx),
    ...buildLiquidityStatusLines(ctx)
  ].join('\n');
  const pivotWarning = buildPivotWarning(ctx);
  const actionParts = buildActionLines(ctx, entryState);
  if (pivotWarning) {
    actionParts.push(
      `⚠️ PIVOT VICINO — ${pivotWarning.code} ${pivotWarning.role} $${formatPrice(pivotWarning.price)} a ${formatPercent(pivotWarning.distance)}`,
      'Possibile reazione o fake break. Il pivot non blocca il segnale: serve come cartello di attenzione.'
    );
  }
  const actionLines = actionParts.join('\n');

  return `
${confirmationTitle} — ${emoji} ${symbol} [${interval}]
${sideIcon} DIREZIONE PREVALENTE: ${side}
Prezzo live: $${formatPrice(livePrice)}

🎯 OPERATIVITÀ
• Entry tecnica: $${formatPrice(lastPrice)}
• TP1: $${formatPrice(levels.tp1)}
• TP2: $${formatPrice(levels.tp2)}
• TP3: $${formatPrice(levels.tp3)}
• SL: $${formatPrice(levels.sl)}

🚦 FARI ATTIVI — STATO CONFERME
${confirmationLines}

🧲 LIQUIDITÀ / AUTO CLUSTER ${side}
${formatDirectionalClusterList(clusters, direction)}

📍 S/R EZALGO ${interval} — RESISTENZE SOPRA
${formatPivotList(pivotLevels?.above, 'R')}

📍 S/R EZALGO ${interval} — SUPPORTI SOTTO
${formatPivotList(pivotLevels?.below, 'S')}

📌 AZIONE
${actionLines}
`.trim();
}

function buildAuditMessage(ctx, levels) {
  const { symbol, interval, lastPrice, livePrice, rangeBox, direction, tlConfirm, liquidity, pivotLevels, majority } = ctx;
  return `
🔎 AUDIT INTERNO ${symbol} [${interval}] — ${direction.toUpperCase()} ${majority?.score || 0}/3
Close: $${formatPrice(lastPrice)} | Live: $${formatPrice(livePrice)}
Range H/L: $${formatPrice(rangeBox.high)} / $${formatPrice(rangeBox.low)} | stato ${majority?.rangeStatus || 'N/A'}
TL: ${tlConfirm?.type || 'N/A'} @ $${formatPrice(tlConfirm?.breakLevel)} | stato ${majority?.tlStatus || 'N/A'}
Memoria Range: ${selectedBreakMemory(ctx, 'range')?.state || 'missing'} | age ${selectedBreakMemory(ctx, 'range')?.ageBars ?? 'N/A'}
Memoria TL: ${selectedBreakMemory(ctx, 'tl')?.state || 'missing'} | age ${selectedBreakMemory(ctx, 'tl')?.ageBars ?? 'N/A'}
Liquidity target: ${liquidity.scoreLabel} | stato ${majority?.liquidityStatus || 'N/A'}
S/R sopra: ${(pivotLevels?.above || []).map(p => formatPrice(p.value)).join(', ') || 'N/A'}
S/R sotto: ${(pivotLevels?.below || []).map(p => formatPrice(p.value)).join(', ') || 'N/A'}
TP/SL: $${formatPrice(levels.tp1)} / $${formatPrice(levels.tp2)} / $${formatPrice(levels.tp3)} / $${formatPrice(levels.sl)}
`.trim();
}

function formatPercent(v) {
  return Number.isFinite(Number(v)) ? `${Number(v).toFixed(3)}%` : 'N/A';
}

async function sendSignal(ctx) {
  const { lastPrice, rangeBox, direction, symbol, interval } = ctx;
  const boxSize = Number.isFinite(rangeBox.size) && rangeBox.size > 0 ? rangeBox.size : lastPrice * 0.01;

  const levels = {
    tp1: direction === 'long' ? lastPrice + boxSize : lastPrice - boxSize,
    tp2: direction === 'long' ? lastPrice + boxSize * 1.5 : lastPrice - boxSize * 1.5,
    tp3: direction === 'long' ? lastPrice + boxSize * 2.0 : lastPrice - boxSize * 2.0,
    sl: direction === 'long' ? lastPrice - boxSize * 0.5 : lastPrice + boxSize * 0.5,
    noChaseLow: direction === 'long' ? lastPrice * (1 - CONFIG.noChasePct / 100) : lastPrice,
    noChaseHigh: direction === 'long' ? lastPrice : lastPrice * (1 + CONFIG.noChasePct / 100)
  };

  const operationalMessage = buildOperationalMessage(ctx, levels);
  await sendTelegramMessage(operationalMessage, symbol, interval);

  if (CONFIG.telegramAuditDetails) {
    const auditMessage = buildAuditMessage(ctx, levels);
    await sendTelegramMessage(auditMessage, symbol, interval);
  }
}

// ───────────────────────── LOOP ─────────────────────────
async function runScan(trigger = 'timer') {
  if (runtime.running) {
    console.log(`${now()} ⏳ Scan saltato: ciclo precedente ancora attivo`);
    return;
  }

  runtime.running = true;
  runtime.lastScanAt = new Date().toISOString();
  const summary = { trigger, scanned: 0, sent: 0, skipped: 0, errors: 0 };
  console.log(`${now()} 🔎 Scan avviato (${trigger})`);

  try {
    for (const symbolRaw of coins) {
      const symbol = normalizeSymbol(symbolRaw);
      const snapshots = await fetchMultiExchangeSnapshots(symbol);
      const clusters = buildAutoClusters(symbol, snapshots);
      await sleep(CONFIG.requestDelayMs);

      for (const tf of intervals) {
        try {
          const result = await analyze(symbol, tf, snapshots, clusters);
          summary.scanned++;
          if (result?.sent) summary.sent++;
          else summary.skipped++;
        } catch (e) {
          summary.errors++;
          console.error(`${now()} ❌ analyze ${symbol}[${tf}] errore:`, e.message);
        }
        await sleep(CONFIG.requestDelayMs);
      }
    }
  } finally {
    runtime.lastCycleSummary = summary;
    runtime.running = false;
    console.log(`${now()} ✅ Scan completato ${JSON.stringify(summary)}`);
  }
}

setTimeout(() => runScan('startup').catch(e => console.error(e)), 2_000);
setInterval(() => runScan('timer').catch(e => console.error(e)), CONFIG.scanIntervalMs);

// ───────────────────────── UTILS ─────────────────────────
async function requestWithRetry(method, url, params = {}, data = null) {
  let lastError;
  for (let attempt = 1; attempt <= CONFIG.retryCount + 1; attempt++) {
    try {
      return await axios({ method, url, params, data, timeout: CONFIG.httpTimeoutMs });
    } catch (e) {
      lastError = e;
      if (attempt <= CONFIG.retryCount) await sleep(500 * attempt);
    }
  }
  throw lastError;
}

function parseLevels(levels) {
  if (!Array.isArray(levels)) return [];
  return levels.map(l => ({ price: Number(l[0]), qty: Number(l[1]) }))
    .filter(x => Number.isFinite(x.price) && Number.isFinite(x.qty));
}

function strongestLevel(levels, mid) {
  if (!Array.isArray(levels) || mid <= 0) return null;
  let best = null;
  for (const lvl of levels) {
    const dist = Math.abs(lvl.price - mid) / mid * 100;
    if (dist > CONFIG.strongestWallMaxDistancePct) continue;
    if (!best || lvl.qty > best.qty) best = lvl;
  }
  return best;
}

function dropOpenCandle(candles, interval) {
  if (!candles.length) return candles;
  const ms = intervalToMs(interval);
  if (!ms) return candles;
  const last = candles.at(-1);
  if (Date.now() < last.time + ms) return candles.slice(0, -1);
  return candles;
}

function intervalToMs(interval) {
  const s = String(interval);
  if (s.endsWith('m')) return Number(s.slice(0, -1)) * 60_000;
  if (s.endsWith('h')) return Number(s.slice(0, -1)) * 3_600_000;
  if (s.endsWith('d')) return Number(s.slice(0, -1)) * 86_400_000;
  if (s.endsWith('w')) return Number(s.slice(0, -1)) * 7 * 86_400_000;
  return null;
}

function normalizeSymbol(symbol) {
  return String(symbol || '')
    .replace('BYBIT:', '')
    .replace('BINANCE:', '')
    .replace('OKX:', '')
    .replace('.P', '')
    .replace('PERP', '')
    .replace('/', '')
    .replace('-USDT-SWAP', 'USDT')
    .replace(/-/g, '')
    .trim()
    .toUpperCase();
}

function toOkxInstId(symbol) {
  const s = normalizeSymbol(symbol);
  if (!s.endsWith('USDT')) return s;
  const base = s.replace('USDT', '');
  return CONFIG.marketMode === 'spot' ? `${base}-USDT` : `${base}-USDT-SWAP`;
}

function normalizeBinanceDepthLimit(limit, futures) {
  const allowed = futures ? [5, 10, 20, 50, 100, 500, 1000] : [5, 10, 20, 50, 100, 500, 1000, 5000];
  let best = allowed[0];
  for (const v of allowed) if (v <= limit) best = v;
  return best;
}

function formatPrice(p) {
  if (!Number.isFinite(p) || p <= 0) return 'N/A';
  if (p < 0.01) return p.toFixed(9);
  if (p < 1) return p.toFixed(4);
  return p.toFixed(2);
}

function formatVotes(votes) {
  if (!votes?.length) return '-';
  return votes.map(v => `${v.exchange}:${v.vote}(${v.score})`).join(' | ');
}

function formatClusterList(levels) {
  if (!levels?.length) return '-';
  return levels.map(c => `$${formatPrice(c.price)} score ${Math.round(c.score)} [${c.exchangeCount}/3 ${c.exchanges} ${c.sources}]`).join(', ');
}

function formatMapLines(lines) {
  if (!lines?.length) return '-';
  return lines.map(l => `$${formatPrice(l.price)} score ${l.score} (${l.role})`).join(', ');
}

function lightSnapshot(s) {
  return {
    exchange: s.exchange,
    mid: round(s.mid),
    bidPressure: round(s.bidPressure),
    askPressure: round(s.askPressure),
    deltaProxy: round(s.deltaProxy),
    velocity: round(s.velocity),
    spreadPct: round(s.spreadPct),
    strongestBidPrice: round(s.strongestBidPrice),
    strongestBidQty: round(s.strongestBidQty),
    strongestAskPrice: round(s.strongestAskPrice),
    strongestAskQty: round(s.strongestAskQty),
    time: s.time
  };
}

function publicConfig() {
  return {
    marketMode: CONFIG.marketMode,
    bybitCategory: CONFIG.bybitCategory,
    scanIntervalMs: CONFIG.scanIntervalMs,
    rangeLookback: CONFIG.rangeLookback,
    rangeSignalEnabled: CONFIG.rangeSignalEnabled,
    tlSignalEnabled: CONFIG.tlSignalEnabled,
    signalMinPillars: CONFIG.signalMinPillars,
    requireLiquidityForTelegram: CONFIG.requireLiquidityForTelegram,
    notify3Of3Upgrade: CONFIG.notify3Of3Upgrade,
    tlBreakMaxAgeCandles: CONFIG.tlBreakMaxAgeCandles,
    rangeBreakMaxAgeCandles: CONFIG.rangeBreakMaxAgeCandles,
    rangeBreakMemoryBars: CONFIG.rangeBreakMemoryBars,
    tlBreakMemoryBars: CONFIG.tlBreakMemoryBars,
    retestTolerancePct: CONFIG.retestTolerancePct,
    retestConfirmOnClose: CONFIG.retestConfirmOnClose,
    countRetestAsPillar: CONFIG.countRetestAsPillar,
    breakInvalidationCloses: CONFIG.breakInvalidationCloses,
    breakInvalidationTolerancePct: CONFIG.breakInvalidationTolerancePct,
    luxLength: CONFIG.luxLength,
    luxSlopeMult: CONFIG.luxSlopeMult,
    luxCalcMethod: CONFIG.luxCalcMethod,
    requiredConfirmations: CONFIG.requiredConfirmations,
    levelsAbove: CONFIG.levelsAbove,
    levelsBelow: CONFIG.levelsBelow,
    srPivotLeft: CONFIG.srPivotLeft,
    srPivotRight: CONFIG.srPivotRight,
    srQuickRight: CONFIG.srQuickRight,
    srLevelsAbove: CONFIG.srLevelsAbove,
    srLevelsBelow: CONFIG.srLevelsBelow,
    srMergeTolerancePct: CONFIG.srMergeTolerancePct,
    nearBreakPct: CONFIG.nearBreakPct,
    pivotWarningPct: CONFIG.pivotWarningPct,
    telegramEnabled: CONFIG.telegramEnabled,
    telegramAuditDetails: CONFIG.telegramAuditDetails
  };
}

function pushRuntimeEvent(event) {
  runtime.lastEvents.unshift({
    time: event.time,
    symbol: event.symbol,
    interval: event.interval,
    direction: event.direction,
    price: round(event.lastPrice),
    majorityScore: event.majority?.score || 0,
    majoritySignature: event.majority?.signature || null,
    rangeDirection: event.rangeDirection || null,
    tlDirection: event.tlDirection || null,
    liquidityDirection: event.liquidityState?.direction || null,
    liquidity: event.liquidity?.friendlyLine,
    tl: event.tl?.type,
    rangeMemory: event.breakMemory?.range?.[event.direction]?.state || 'missing',
    tlMemory: event.breakMemory?.tl?.[event.direction]?.state || 'missing',
    rangeMemoryAge: event.breakMemory?.range?.[event.direction]?.ageBars ?? null,
    tlMemoryAge: event.breakMemory?.tl?.[event.direction]?.ageBars ?? null,
    pivotAbove: event.pivotLevels?.above?.map(p => round(p.value)) || [],
    pivotBelow: event.pivotLevels?.below?.map(p => round(p.value)) || []
  });
  runtime.lastEvents = runtime.lastEvents.slice(0, 30);
}

function pctDistance(a, b) {
  const base = Math.max(1, Math.abs(a));
  return Math.abs(a - b) / base * 100;
}

function average(values) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return 0;
  return v.reduce((s, x) => s + x, 0) / v.length;
}

function round(v) {
  return Number.isFinite(v) ? Number(v.toFixed(6)) : 0;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function now() { return `[${new Date().toLocaleTimeString('it-IT')}]`; }

function listEnv(name, fallback = []) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return Array.isArray(fallback) ? fallback : [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}
function strEnv(name, fallback) { return process.env[name] || fallback; }
function intEnv(name, fallback) {
  const v = Number.parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}
function floatEnv(name, fallback) {
  const v = Number.parseFloat(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}
function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(raw).toLowerCase());
}
