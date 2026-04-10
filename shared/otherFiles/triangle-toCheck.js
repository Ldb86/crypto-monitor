//rottura del triangolo con EMA12 E BB


require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { EMA, BollingerBands } = require('technicalindicators');

/* ───────── CONFIG ───────── */
const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKENS = process.env.BOT_TOKENS.split(',');
const TELEGRAM_CHAT_IDS = process.env.CHAT_IDS.split(',');

const coins = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT',
  'BNBUSDT', 'UNIUSDT', 'XRPUSDT',
  'LTCUSDT', 'AAVEUSDT', 'SUIUSDT', 'ENAUSDT',
  'ONDOUSDT', 'DOGEUSDT', 'PEPEUSDT',
  'DOTUSDT', 'ATOMUSDT', 'HBARUSDT',
  'TIAUSDT', 'SHIBUSDT', 'ICPUSDT', 'BCHUSDT','LINKUSDT', 'AVAXUSDT', 'TONUSDT'
];

const coinEmojis = {
  BTCUSDT: '🟠', ETHUSDT: '⚫', SOLUSDT: '🌞', BNBUSDT: '🌈', UNIUSDT: '🟣',
  XRPUSDT: '🔵', LTCUSDT: '⚪', AAVEUSDT: '🔷', SUIUSDT: '🔹', ENAUSDT: '🟪',
  ONDOUSDT: '🟤', DOGEUSDT: '🐶', DOTUSDT: '⚪', ATOMUSDT: '🌌', HBARUSDT: '🚀',
  TIAUSDT: '🟡', SHIBUSDT: '🐕', PEPEUSDT: '🐸', ICPUSDT: '🌪', BCHUSDT:'⭐️', LINKUSDT:'⚡️', 
  AVAXUSDT:'🔥', TONUSDT:'🌦'
};

const intervals = ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w'];
const intervalMap = {
  '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120',
  '4h': '240', '6h': '360', '12h': '720', '1d': 'D', '1w': 'W'
};

/* ───────── STATE ───────── */
const state = {};
coins.forEach(c => {
  state[c] = {};
  intervals.forEach(tf => {
    state[c][tf] = { lastCross: null };
  });
});

/* ───────── HELPERS ───────── */
const now = () => `[${new Date().toLocaleTimeString()}]`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const formatPrice = p => {
  if (!p || isNaN(p)) return 'N/A';
  if (p < 0.01) return p.toFixed(8);
  if (p < 1) return p.toFixed(4);
  return p.toFixed(2);
};

function getRangeBox(klines, lookback = 20) {
  const slice = klines.slice(-(lookback + 1), -1);
  const highs = slice.map(k => k.high);
  const lows = slice.map(k => k.low);
  return {
    high: Math.max(...highs),
    low: Math.min(...lows),
    size: Math.max(...highs) - Math.min(...lows)
  };
}
/* ───────── TRIANGOLO LUXALGO (BOT VERSION) ───────── */

// Pivot High / Low
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

// ATR (necessario al triangolo)
function atr(high, low, close, len, i) {
  if (i < len) return null;
  let sum = 0;
  for (let j = i - len + 1; j <= i; j++) {
    const tr = Math.max(
      high[j] - low[j],
      Math.abs(high[j] - close[j - 1]),
      Math.abs(low[j] - close[j - 1])
    );
    sum += tr;
  }
  return sum / len;
}

// Calcolo trendline triangolo
function calculateTriangle(klines, length = 14, mult = 1) {
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

    upper = ph !== null
      ? ph
      : upper !== null
        ? upper - slopePH
        : null;

    lower = pl !== null
      ? pl
      : lower !== null
        ? lower + slopePL
        : null;
  }

  return { upper, lower };
}

// Breakout del triangolo
function triangleBreakout(price, triangle) {
  if (!triangle.upper || !triangle.lower) return null;
  if (price > triangle.upper) return 'long';
  if (price < triangle.lower) return 'short';
  return null;
}

/* ───────── TELEGRAM ───────── */
async function sendTelegram(msg, symbol, interval) {
  for (let i = 0; i < TELEGRAM_TOKENS.length; i++) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKENS[i]}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_IDS[i],
          text: msg,
          parse_mode: 'Markdown'
        }
      );
      console.log(`${now()} 📬 Telegram ${symbol}[${interval}]`);
    } catch (err) {
      console.error(`${now()} ❌ Telegram error`, err.message);
    }
  }
}

/* ───────── BYBIT DATA ───────── */
async function fetchKlines(symbol, interval, limit = 300) {
  try {
    const res = await axios.get(
      'https://api.bybit.com/v5/market/kline',
      {
        params: {
          category: 'spot',
          symbol,
          interval: intervalMap[interval],
          limit
        },
        timeout: 20000
      }
    );

    return res.data.result.list.reverse().map(k => ({
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4]
    }));
  } catch {
    return [];
  }
}

/* ───────── ANALYSIS ───────── */
async function analyze(symbol, interval) {
  const klines = await fetchKlines(symbol, interval);
  if (klines.length < 200) return;

  const closes = klines.map(k => k.close);
  const lastClose = closes.at(-1);

  /* ───── EMA ───── */
  const ema12Arr = EMA.calculate({ period: 12, values: closes });
  const ema50Arr = EMA.calculate({ period: 50, values: closes });
  const ema200Arr = EMA.calculate({ period: 200, values: closes });

  if (ema12Arr.length < 2) return;

  const ema12 = ema12Arr.at(-1);
  const prevEma12 = ema12Arr.at(-2);
  const ema50 = ema50Arr.at(-1);
  const ema200 = ema200Arr.at(-1);

  // /* ───── BOLLINGER ───── */
  // const bbArr = BollingerBands.calculate({
  //   period: 20,
  //   values: closes,
  //   stdDev: 2
  // });
  // if (bbArr.length < 2) return;

  // const bbMid = bbArr.at(-1).middle;
  // const prevBbMid = bbArr.at(-2).middle;

  // /* ───── INCROCIO EMA12 x BB ───── */
  // const cross =
  //   prevEma12 < prevBbMid && ema12 > bbMid ? 'long' :
  //   prevEma12 > prevBbMid && ema12 < bbMid ? 'short' :
  //   null;

  // if (!cross) return;

  // /* ───── TRIANGOLO LUXALGO ───── */
  // const triangle = calculateTriangle(klines, 14, 1);
  // const triBreak = triangleBreakout(lastClose, triangle);

  // // Conferma strutturale
  // if (!triBreak || triBreak !== cross) return;
  const triangle = calculateTriangle(klines, 14, 1);
const triBreak = triangleBreakout(lastClose, triangle);

if (!triBreak) return;

const direction = triBreak; // 'long' o 'short'


  /* ───── FILTRO TREND EMA50 / EMA200 ───── */
  if (cross === 'long' && ema50 < ema200) return;
  if (cross === 'short' && ema50 > ema200) return;

  // /* ───── ANTI-SPAM ───── */
  // const s = state[symbol][interval];
  // if (s.lastCross === cross) return;
  // s.lastCross = cross;
const s = state[symbol][interval];
if (s.lastCross === direction) return;
s.lastCross = direction;


  // console.log(
  //   `${now()} 🔺 ${symbol}[${interval}] TRIANGLE + EMA12xBB → ${cross.toUpperCase()}`
  // );
  console.log(
  `${now()} 🔺 ${symbol}[${interval}] TRIANGLE BREAKOUT → ${direction.toUpperCase()}`
);


  /* ───── RANGE BOX (TP / SL) ───── */
  const box = getRangeBox(klines);
  const boxSize = box.size || lastClose * 0.01;

  const tp = cross === 'long'
    ? lastClose + boxSize
    : lastClose - boxSize;

  const sl = cross === 'long'
    ? lastClose - boxSize * 0.5
    : lastClose + boxSize * 0.5;

  /* ───── INVIO TELEGRAM ───── */
  await sendSignal(
    symbol,
    interval,
    //cross,
    direction,
    lastClose,
    box,
    ema12,
    ema50,
    ema200,
    bbMid,
    tp,
    sl
  );
}


/* ───────── INVIO SEGNALE ───────── */
async function sendSignal(symbol, interval, direction, price, box, ema12, ema50, ema200, bbMid, tp, sl) {
  const emoji = coinEmojis[symbol] || '🔸';

  const msg = `
${emoji} *BREAKOUT + EMA12 x BB*
*${symbol}* [${interval}]

${direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} @ $${formatPrice(price)}

📦 Range Box
• High: $${formatPrice(box.high)}
• Low:  $${formatPrice(box.low)}

📈 EMA
• EMA12:  $${formatPrice(ema12)}
• EMA50:  $${formatPrice(ema50)}
• EMA200: $${formatPrice(ema200)}

// 📊 BB Middle: $${formatPrice(bbMid)}

🎯 TP: $${formatPrice(tp)}
🛑 SL: $${formatPrice(sl)}
`.trim();

  await sendTelegram(msg, symbol, interval);
}

/* ───────── LOOP ───────── */
async function checkMarket() {
  for (const c of coins) {
    for (const tf of intervals) {
      await analyze(c, tf);
      await sleep(350);
    }
  }
}

setInterval(checkMarket, 60 * 1000);

/* ───────── SERVER ───────── */
app.get('/', (_, res) => res.send('✅ Breakout + EMA12 x BB bot ATTIVO'));
app.listen(PORT, () => console.log(`🚀 Server avviato su porta ${PORT}`));
