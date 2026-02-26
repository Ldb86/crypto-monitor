// Banda di Bollinger + incrocio EMA12 x BB Middle
// Funzionante secondo il tester

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
  'TIAUSDT', 'SHIBUSDT', 'ICPUSDT',
  'BCHUSDT', 'LINKUSDT', 'AVAXUSDT', 'TONUSDT'
];

const coinEmojis = {
  BTCUSDT: '🟠', ETHUSDT: '⚫', SOLUSDT: '🌞', BNBUSDT: '🌈',
  UNIUSDT: '🟣', XRPUSDT: '🔵', LTCUSDT: '⚪', AAVEUSDT: '🔷',
  SUIUSDT: '🔹', ENAUSDT: '🟪', ONDOUSDT: '🟤', DOGEUSDT: '🐶',
  DOTUSDT: '⚪', ATOMUSDT: '🌌', HBARUSDT: '🚀', TIAUSDT: '🟡',
  SHIBUSDT: '🐕', PEPEUSDT: '🐸', ICPUSDT: '🌪',
  BCHUSDT: '⭐️', LINKUSDT: '⚡️', AVAXUSDT: '🔥', TONUSDT: '🌦'
};

const intervals = ['30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w'];
const intervalMap = {
  '30m': '30', '1h': '60', '2h': '120',
  '4h': '240', '6h': '360', '12h': '720',
  '1d': 'D', '1w': 'W'
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
  if (klines.length < 60) return;

  const prices = klines.map(k => k.close);
  const lastPrice = prices.at(-1);

  // EMA 12
  const ema12Arr = EMA.calculate({ period: 12, values: prices });
  if (ema12Arr.length < 2) return;
  const ema12 = ema12Arr.at(-1);
  const prevEma12 = ema12Arr.at(-2);

  // EMA 50 / 200
  const ema50 = EMA.calculate({ period: 50, values: prices }).at(-1);
  const ema200 = EMA.calculate({ period: 200, values: prices }).at(-1);

  // Bollinger Middle
  const bbArr = BollingerBands.calculate({
    period: 20,
    values: prices,
    stdDev: 2
  });
  if (bbArr.length < 2) return;
  const bbMid = bbArr.at(-1).middle;
  const prevBbMid = bbArr.at(-2).middle;

  const box = getRangeBox(klines);

  // Incrocio EMA12 ↔ BB Middle
  const cross =
    prevEma12 < prevBbMid && ema12 > bbMid ? 'long' :
    prevEma12 > prevBbMid && ema12 < bbMid ? 'short' :
    null;

  if (!cross) return;

  const s = state[symbol][interval];
  if (s.lastCross === cross) return;
  s.lastCross = cross;

  console.log(`${now()} ⚡ ${symbol}[${interval}] EMA12 x BB ${cross.toUpperCase()}`);

  const boxSize = box.size || lastPrice * 0.01;
  const tp = cross === 'long' ? lastPrice + boxSize : lastPrice - boxSize;
  const sl = cross === 'long' ? lastPrice - boxSize * 0.5 : lastPrice + boxSize * 0.5;

  await sendSignal(
    symbol, interval, cross, lastPrice,
    box, ema12, ema50, ema200, bbMid, tp, sl
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

📊 BB Middle: $${formatPrice(bbMid)}

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
app.listen(PORT, () =>
  console.log(`🚀 Server avviato su porta ${PORT}`)
);
