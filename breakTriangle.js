require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { EMA, BollingerBands } = require('technicalindicators');

/* ───────── CONFIG ───────── */
const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.BOT_TOKENS || !process.env.CHAT_IDS) {
  throw new Error('❌ BOT_TOKENS o CHAT_IDS mancanti nel file .env');
}

const TELEGRAM_TOKENS = process.env.BOT_TOKENS.split(',').map(s => s.trim());
const TELEGRAM_CHAT_IDS = process.env.CHAT_IDS.split(',').map(s => s.trim());

if (TELEGRAM_TOKENS.length !== TELEGRAM_CHAT_IDS.length) {
  throw new Error('❌ BOT_TOKENS e CHAT_IDS devono avere lo stesso numero di elementi');
}

const coins = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','UNIUSDT','XRPUSDT','LTCUSDT',
  'AAVEUSDT','SUIUSDT','ENAUSDT','ONDOUSDT','DOGEUSDT','PEPEUSDT',
  'DOTUSDT','ATOMUSDT','HBARUSDT','TIAUSDT','SHIBUSDT','ICPUSDT',
  'BCHUSDT','LINKUSDT','AVAXUSDT','TONUSDT'
];

const coinEmojis = {
  BTCUSDT:'🟠', ETHUSDT:'⚫', SOLUSDT:'🌞', BNBUSDT:'🌈', UNIUSDT:'🟣',
  XRPUSDT:'🔵', LTCUSDT:'⚪', AAVEUSDT:'🔷', SUIUSDT:'🔹', ENAUSDT:'🟪',
  ONDOUSDT:'🟤', DOGEUSDT:'🐶', DOTUSDT:'⚪', ATOMUSDT:'🌌', HBARUSDT:'🚀',
  TIAUSDT:'🟡', SHIBUSDT:'🐕', PEPEUSDT:'🐸', ICPUSDT:'🌪',
  BCHUSDT:'⭐️', LINKUSDT:'⚡️', AVAXUSDT:'🔥', TONUSDT:'🌦'
};

const baseIntervals = ['2h','4h','6h','12h','1d','1w'];
const specialCoins = { BTCUSDT:true, ETHUSDT:true, AAVEUSDT:true };
const specialIntervals = ['30m', ...baseIntervals];

const intervalMap = {
  '30m':'30',
  '2h':'120',
  '4h':'240',
  '6h':'360',
  '12h':'720',
  '1d':'D',
  '1w':'W'
};

/* ───────── PARAMETRI BOT ───────── */
const FETCH_LIMIT = 80;          // scarica 80 candele
const PATTERN_WINDOW = 25;       // usa ultime 25 candele chiuse
const TRIANGLE_LENGTH = 6;       // pivot più reattivo (meglio di 14)
const TRIANGLE_MULT = 1;
const BREAKOUT_BUFFER = 0.0015;  // 0.15% anti fake breakout
const LOOP_EVERY_MS = 60 * 1000; // check ogni 60 sec
const REQUEST_DELAY_MS = 300;    // delay tra richieste
const USE_TREND_FILTER = true;   // filtro EMA50/EMA200
const REQUIRE_EMA12_BB_CONFIRM = false; // se true, il breakout deve essere coerente con EMA12 vs BB mid

/* ───────── STATE ───────── */
const state = {};
for (const c of coins) {
  state[c] = {};
  const tfs = specialCoins[c] ? specialIntervals : baseIntervals;
  for (const tf of tfs) {
    state[c][tf] = {
      lastSignal: null,
      lastBarTime: null,
      lastAlertKey: null
    };
  }
}

let isChecking = false;

/* ───────── HELPERS ───────── */
const now = () => `[${new Date().toLocaleTimeString()}]`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const formatPrice = p => {
  if (p == null || isNaN(p)) return 'N/A';
  if (p < 0.0001) return p.toFixed(10);
  if (p < 0.01) return p.toFixed(8);
  if (p < 1) return p.toFixed(4);
  return p.toFixed(2);
};

function getRangeBox(klines, lookback = 20) {
  const slice = klines.slice(-lookback);
  const highs = slice.map(k => k.high);
  const lows = slice.map(k => k.low);

  const high = Math.max(...highs);
  const low = Math.min(...lows);

  return {
    high,
    low,
    size: high - low
  };
}

/* ───────── TRIANGOLO (stile Lux-like, ma più reattivo) ───────── */
function pivotHigh(high, len, i) {
  if (i < len || i + len >= high.length) return null;
  const c = high[i];
  for (let j = i - len; j <= i + len; j++) {
    if (high[j] > c) return null;
  }
  return c;
}

function pivotLow(low, len, i) {
  if (i < len || i + len >= low.length) return null;
  const c = low[i];
  for (let j = i - len; j <= i + len; j++) {
    if (low[j] < c) return null;
  }
  return c;
}

function atr(high, low, close, len, i) {
  if (i < len) return null;
  let sum = 0;
  for (let j = i - len + 1; j <= i; j++) {
    sum += Math.max(
      high[j] - low[j],
      Math.abs(high[j] - close[j - 1]),
      Math.abs(low[j] - close[j - 1])
    );
  }
  return sum / len;
}

function calculateTriangle(klines, length = TRIANGLE_LENGTH, mult = TRIANGLE_MULT) {
  let upper = null;
  let lower = null;
  let slopePH = 0;
  let slopePL = 0;

  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const closes = klines.map(k => k.close);

  for (let i = 0; i < klines.length; i++) {
    const ph = pivotHigh(highs, length, i);
    const pl = pivotLow(lows, length, i);
    const atrVal = atr(highs, lows, closes, length, i);
    const slope = atrVal ? (atrVal / length) * mult : 0;

    if (ph !== null) slopePH = slope;
    if (pl !== null) slopePL = slope;

    upper = ph !== null ? ph : upper !== null ? upper - slopePH : null;
    lower = pl !== null ? pl : lower !== null ? lower + slopePL : null;
  }

  return { upper, lower };
}

/* ───────── FILTRO COMPRESSIONE (triangolo più “vero”) ───────── */
function hasCompression(klines) {
  if (klines.length < 20) return false;

  const first = klines.slice(0, Math.floor(klines.length / 2));
  const last = klines.slice(Math.floor(klines.length / 2));

  const firstRange = Math.max(...first.map(k => k.high)) - Math.min(...first.map(k => k.low));
  const lastRange = Math.max(...last.map(k => k.high)) - Math.min(...last.map(k => k.low));

  return lastRange < firstRange * 0.9; // almeno 10% di compressione
}

/* ───────── BREAKOUT REALE SU CANDELA CHIUSA ───────── */
function triangleBreakout(prevClose, lastClose, triangle, bufferPct = BREAKOUT_BUFFER) {
  if (triangle.upper == null || triangle.lower == null) return null;

  const upperBreak = triangle.upper * (1 + bufferPct);
  const lowerBreak = triangle.lower * (1 - bufferPct);

  // LONG: candela precedente non rotta, ultima candela chiusa rompe sopra
  if (prevClose <= triangle.upper && lastClose > upperBreak) return 'long';

  // SHORT: candela precedente non rotta, ultima candela chiusa rompe sotto
  if (prevClose >= triangle.lower && lastClose < lowerBreak) return 'short';

  return null;
}

/* ───────── TELEGRAM ───────── */
async function sendTelegram(msg) {
  for (let i = 0; i < TELEGRAM_TOKENS.length; i++) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKENS[i]}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_IDS[i],
          text: msg,
          parse_mode: 'Markdown'
        },
        { timeout: 10000 }
      );
    } catch (err) {
      console.error(`${now()} ❌ Telegram error [${i}]`, err.response?.data || err.message);
    }
  }
}

/* ───────── BYBIT ───────── */
async function fetchKlines(symbol, interval, limit = FETCH_LIMIT) {
  try {
    const r = await axios.get('https://api.bybit.com/v5/market/kline', {
      params: {
        category: 'spot',
        symbol,
        interval: intervalMap[interval],
        limit
      },
      timeout: 10000
    });

    const list = r?.data?.result?.list || [];

    return list.reverse().map(k => ({
      time: +k[0],   // timestamp candela
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4]
    }));
  } catch (err) {
    console.error(`${now()} ❌ Bybit Klines ${symbol}[${interval}]`, err.response?.data || err.message);
    return [];
  }
}

async function fetchCurrentPrice(symbol) {
  try {
    const r = await axios.get('https://api.bybit.com/v5/market/tickers', {
      params: { category: 'spot', symbol },
      timeout: 10000
    });

    return +(r?.data?.result?.list?.[0]?.lastPrice || NaN);
  } catch (err) {
    console.error(`${now()} ❌ Bybit Ticker ${symbol}`, err.response?.data || err.message);
    return null;
  }
}

/* ───────── ANALYSIS ───────── */
async function analyze(symbol, interval) {
  const raw = await fetchKlines(symbol, interval, FETCH_LIMIT);
  if (raw.length < PATTERN_WINDOW + 5) return;

  // escludo SEMPRE l'ultima candela live
  const closed = raw.slice(0, -1);
  if (closed.length < PATTERN_WINDOW) return;

  // uso solo il pattern recente
  const klines = closed.slice(-PATTERN_WINDOW);
  if (klines.length < PATTERN_WINDOW) return;

  const s = state[symbol][interval];

  // evita di rianalizzare la stessa ultima candela chiusa
  const lastClosedBarTime = klines.at(-1).time;
  if (s.lastBarTime === lastClosedBarTime) {
    return;
  }

  const closes = klines.map(k => k.close);
  const prevClose = closes.at(-2);
  const lastClose = closes.at(-1);

  // prezzo live SOLO per il messaggio
  const currentPrice = await fetchCurrentPrice(symbol);

  // EMA su finestra più ampia (closed, non solo pattern)
  const closedCloses = closed.map(k => k.close);

  const ema12Arr = EMA.calculate({ period: 12, values: closedCloses });
  const ema50Arr = EMA.calculate({ period: 50, values: closedCloses });
  const ema200Arr = EMA.calculate({ period: 200, values: closedCloses });

  if (ema12Arr.length < 2 || ema50Arr.length < 1 || ema200Arr.length < 1) {
    s.lastBarTime = lastClosedBarTime;
    return;
  }

  const prevEma12 = ema12Arr.at(-2);
  const ema12 = ema12Arr.at(-1);
  const ema50 = ema50Arr.at(-1);
  const ema200 = ema200Arr.at(-1);

  // Bollinger Bands su finestra chiusa
  const bbArr = BollingerBands.calculate({ period: 20, values: closedCloses, stdDev: 2 });
  if (bbArr.length < 2) {
    s.lastBarTime = lastClosedBarTime;
    return;
  }

  const prevBbMid = bbArr.at(-2).middle;
  const bbMid = bbArr.at(-1).middle;

  let emaBbCross = '❌';
  if (prevEma12 < prevBbMid && ema12 > bbMid) emaBbCross = '🟢 LONG';
  if (prevEma12 > prevBbMid && ema12 < bbMid) emaBbCross = '🔴 SHORT';

  // triangolo
  const triangle = calculateTriangle(klines, TRIANGLE_LENGTH, TRIANGLE_MULT);

  if (triangle.upper == null || triangle.lower == null) {
    s.lastBarTime = lastClosedBarTime;
    return;
  }

  // filtro compressione per evitare triangoli "sporchi"
  const compressed = hasCompression(klines);
  if (!compressed) {
    s.lastBarTime = lastClosedBarTime;
    return;
  }

  // breakout vero: solo su candela chiusa
  const direction = triangleBreakout(prevClose, lastClose, triangle, BREAKOUT_BUFFER);

  // reset anti-spam se non c'è breakout
  if (!direction) {
    s.lastSignal = null;
    s.lastBarTime = lastClosedBarTime;
    return;
  }

  // filtro trend EMA50/EMA200
  if (USE_TREND_FILTER) {
    if (direction === 'long' && ema50 < ema200) {
      s.lastBarTime = lastClosedBarTime;
      return;
    }
    if (direction === 'short' && ema50 > ema200) {
      s.lastBarTime = lastClosedBarTime;
      return;
    }
  }

  // opzionale: coerenza EMA12 vs BB middle
  if (REQUIRE_EMA12_BB_CONFIRM) {
    if (direction === 'long' && ema12 <= bbMid) {
      s.lastBarTime = lastClosedBarTime;
      return;
    }
    if (direction === 'short' && ema12 >= bbMid) {
      s.lastBarTime = lastClosedBarTime;
      return;
    }
  }

  // anti-duplicato sulla stessa candela
  const alertKey = `${symbol}-${interval}-${lastClosedBarTime}-${direction}`;
  if (s.lastAlertKey === alertKey) {
    s.lastBarTime = lastClosedBarTime;
    return;
  }

  // anti-spam classico
  if (s.lastSignal === direction) {
    s.lastBarTime = lastClosedBarTime;
    return;
  }

  s.lastSignal = direction;
  s.lastAlertKey = alertKey;
  s.lastBarTime = lastClosedBarTime;

  // range box per TP/SL
  const box = getRangeBox(klines, 20);
  const size = box.size || lastClose * 0.01;

  const entryPrice = currentPrice ?? lastClose;

  const tp = direction === 'long'
    ? entryPrice + size
    : entryPrice - size;

  const sl = direction === 'long'
    ? entryPrice - size * 0.5
    : entryPrice + size * 0.5;

  const emoji = coinEmojis[symbol] || '🔸';

  const msg = `
${emoji} *TRIANGLE BREAKOUT CONFIRMED*
*${symbol}* [${interval}]

${direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} @ $${formatPrice(entryPrice)}

📌 Close breakout: $${formatPrice(lastClose)}
📐 Triangle
• Upper: $${formatPrice(triangle.upper)}
• Lower: $${formatPrice(triangle.lower)}

📦 Range Box (20)
• High: $${formatPrice(box.high)}
• Low:  $${formatPrice(box.low)}

📈 EMA
• EMA12:  $${formatPrice(ema12)} (${emaBbCross})
• EMA50:  $${formatPrice(ema50)}
• EMA200: $${formatPrice(ema200)}

📊 BB
• Middle: $${formatPrice(bbMid)}

🎯 TP: $${formatPrice(tp)}
🛑 SL: $${formatPrice(sl)}
`.trim();

  console.log(
    `${now()} 🔺 ${symbol}[${interval}] ${direction.toUpperCase()} | ` +
    `close=${formatPrice(lastClose)} upper=${formatPrice(triangle.upper)} lower=${formatPrice(triangle.lower)}`
  );

  await sendTelegram(msg);
}

/* ───────── LOOP ───────── */
async function checkMarket() {
  if (isChecking) {
    console.log(`${now()} ⏳ Scan già in corso, skip.`);
    return;
  }

  isChecking = true;

  try {
    for (const c of coins) {
      const tfs = specialCoins[c] ? specialIntervals : baseIntervals;

      for (const tf of tfs) {
        try {
          await analyze(c, tf);
        } catch (err) {
          console.error(`${now()} ❌ Analyze error ${c}[${tf}]`, err.message);
        }

        await sleep(REQUEST_DELAY_MS);
      }
    }
  } finally {
    isChecking = false;
  }
}

/* ───────── SERVER ───────── */
app.get('/', (_, res) => res.send('✅ Triangle Breakout bot ATTIVO'));

app.listen(PORT, () => {
  console.log(`🚀 Server avviato su porta ${PORT}`);
  checkMarket(); // prima scansione immediata
  setInterval(checkMarket, LOOP_EVERY_MS);
});