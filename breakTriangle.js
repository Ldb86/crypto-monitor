//rottura del triangolo con check su BB e EMA12

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

const intervals = ['2h','4h','6h','12h','1d','1w'];
const intervalMap = {
  '2h':'120','4h':'240','6h':'360',
  '12h':'720','1d':'D','1w':'W'
};

/* ───────── STATE ───────── */
const state = {};
coins.forEach(c => {
  state[c] = {};
  intervals.forEach(tf => state[c][tf] = { lastSignal: null });
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

/* ───────── TRIANGOLO LUXALGO ───────── */
function pivotHigh(high, len, i) {
  if (i < len || i + len >= high.length) return null;
  const c = high[i];
  for (let j = i - len; j <= i + len; j++) if (high[j] > c) return null;
  return c;
}

function pivotLow(low, len, i) {
  if (i < len || i + len >= low.length) return null;
  const c = low[i];
  for (let j = i - len; j <= i + len; j++) if (low[j] < c) return null;
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

function calculateTriangle(klines, length = 14, mult = 1) {
  let upper = null, lower = null, slopePH = 0, slopePL = 0;
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

function triangleBreakout(price, t) {
  if (!t.upper || !t.lower) return null;
  if (price > t.upper) return 'long';
  if (price < t.lower) return 'short';
  return null;
}

/* ───────── TELEGRAM ───────── */
async function sendTelegram(msg) {
  for (let i = 0; i < TELEGRAM_TOKENS.length; i++) {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKENS[i]}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_IDS[i], text: msg, parse_mode: 'Markdown' }
    );
  }
}

/* ───────── BYBIT ───────── */
async function fetchKlines(symbol, interval, limit = 300) {
  try {
    const r = await axios.get('https://api.bybit.com/v5/market/kline', {
      params: { category:'spot', symbol, interval: intervalMap[interval], limit }
    });
    return r.data.result.list.reverse().map(k => ({
      open:+k[1], high:+k[2], low:+k[3], close:+k[4]
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

  // EMA
  const ema12Arr = EMA.calculate({ period: 12, values: closes });
  const ema50 = EMA.calculate({ period: 50, values: closes }).at(-1);
  const ema200 = EMA.calculate({ period: 200, values: closes }).at(-1);
  if (ema12Arr.length < 2) return;

  const prevEma12 = ema12Arr.at(-2);
  const ema12 = ema12Arr.at(-1);

  // Bollinger Bands
  const bbArr = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
  if (bbArr.length < 2) return;

  const prevBbMid = bbArr.at(-2).middle;
  const bbMid = bbArr.at(-1).middle;

  // Check incrocio EMA12 x BB (solo info)
  let emaBbCross = '❌'; // niente incrocio
  if (prevEma12 < prevBbMid && ema12 > bbMid) emaBbCross = '🟢 LONG';
  if (prevEma12 > prevBbMid && ema12 < bbMid) emaBbCross = '🔴 SHORT';

  // Triangolo
  const triangle = calculateTriangle(klines, 14, 1);
  const direction = triangleBreakout(lastClose, triangle);
  if (!direction) return;

  // Filtro trend EMA50/EMA200
  if (direction === 'long' && ema50 < ema200) return;
  if (direction === 'short' && ema50 > ema200) return;

  // Anti-spam
  const s = state[symbol][interval];
  if (s.lastSignal === direction) return;
  s.lastSignal = direction;

  // Range box TP/SL
  const box = getRangeBox(klines);
  const size = box.size || lastClose * 0.01;
  const tp = direction === 'long' ? lastClose + size : lastClose - size;
  const sl = direction === 'long' ? lastClose - size * 0.5 : lastClose + size * 0.5;

  const emoji = coinEmojis[symbol] || '🔸';

  const msg = `
${emoji} *TRIANGLE BREAKOUT*
*${symbol}* [${interval}]

${direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} @ $${formatPrice(lastClose)}

📦 Range Box
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

  console.log(`${now()} 🔺 ${symbol}[${interval}] TRIANGLE ${direction.toUpperCase()} | EMA12xBB: ${emaBbCross}`);
  await sendTelegram(msg);
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
app.get('/', (_, res) => res.send('✅ Triangle Breakout bot ATTIVO'));
app.listen(PORT, () => console.log(`🚀 Server avviato su porta ${PORT}`));
