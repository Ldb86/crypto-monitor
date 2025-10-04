require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { EMA, MACD } = require('technicalindicators');

const app = express();
const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.BOT_TOKENS.split(',');
const TELEGRAM_CHAT_ID = process.env.CHAT_IDS.split(',');

const coins = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT',
  'BNBUSDT', 'UNIUSDT', 'XRPUSDT',
  'LTCUSDT', 'AAVEUSDT', 'SUIUSDT', 'ENAUSDT',
  'ONDOUSDT', 'DOGEUSDT', 'PEPEUSDT',
  'DOTUSDT', 'ATOMUSDT', 'HBARUSDT',
  'TIAUSDT', 'SHIBUSDT'
];

const coinEmojis = {
  BTCUSDT: '🟠', ETHUSDT: '⚫', SOLUSDT: '🟢', BNBUSDT: '🟡', UNIUSDT: '🟣',
  XRPUSDT: '🔵', LTCUSDT: '⚪', AAVEUSDT: '🔷', SUIUSDT: '🔹', ENAUSDT: '🟪',
  ONDOUSDT: '🟤', DOGEUSDT: '🐶', DOTUSDT: '⚪', ATOMUSDT: '🌌', HBARUSDT: '🔴',
  TIAUSDT: '🟡', SHIBUSDT: '🐕', PEPEUSDT: '🐸'
};

const intervals = ['30m', '1h', '2h', '4h', '12h', '1d'];
const intervalMap = { '30m': '30', '1h': '60', '2h': '120', '4h': '240', '12h' : '720', '1d': 'D' };

const lastSignals = {};
coins.forEach(c => { lastSignals[c] = {}; intervals.forEach(tf => { lastSignals[c][tf] = { macd: null, notified: false }; }); });

app.get('/', (req, res) => res.send('✅ MACD + Breakout Bot attivo'));
app.listen(PORT, () => console.log(`🚀 Server in ascolto sulla porta ${PORT}`));

// ──────────────── TELEGRAM ────────────────
async function sendTelegramMessage(msg) {
  for (let i = 0; i < TELEGRAM_TOKEN.length; i++) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN[i].trim()}/sendMessage`;
    try {
      await axios.post(url, { chat_id: TELEGRAM_CHAT_ID[i].trim(), text: msg, parse_mode: 'Markdown' });
      console.log(`📬 Telegram inviato ➡️ Bot ${i + 1}`);
    } catch (e) {
      console.error(`❌ Telegram error:`, e.message);
    }
  }
}

// ──────────────── BYBIT DATA ────────────────
async function fetchKlines(symbol, interval, limit = 300) {
  try {
    const res = await axios.get('https://api.bybit.com/v5/market/kline', {
      params: { category: 'spot', symbol, interval: intervalMap[interval], limit },
      timeout: 10000
    });
    return res.data.result.list.reverse().map(k => ({
      time: Number(k[0]), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5]
    }));
  } catch (err) {
    console.error(`⚠️ fetchKlines ${symbol}[${interval}] error:`, err.message);
    return [];
  }
}

// ──────────────── HELPERS ────────────────
function formatPrice(p) {
  if (!p || isNaN(p)) return 'N/A';
  if (p < 0.01) return p.toFixed(9);
  if (p < 1) return p.toFixed(4);
  return p.toFixed(2);
}

function getRangeBox(klines, lookback = 20) {
  if (klines.length < lookback) return { high: NaN, low: NaN, size: NaN };
  const highs = klines.slice(-lookback).map(k => k.high);
  const lows = klines.slice(-lookback).map(k => k.low);
  const high = Math.max(...highs);
  const low = Math.min(...lows);
  return { high, low, size: high - low };
}

// ──────────────── ANALISI ────────────────
async function analyze(symbol, interval) {
  const klines = await fetchKlines(symbol, interval, 300);
  if (klines.length < 60) return;

  const prices = klines.map(k => k.close);
  const ema12 = EMA.calculate({ period: 12, values: prices }).at(-1);
  const ema26 = EMA.calculate({ period: 26, values: prices }).at(-1);
  const ema50 = EMA.calculate({ period: 50, values: prices }).at(-1);
  const ema200 = EMA.calculate({ period: 200, values: prices }).at(-1);

  const macdVals = MACD.calculate({
    values: prices, fastPeriod: 26, slowPeriod: 50, signalPeriod: 9
  });
  if (macdVals.length < 2) return;

  const lastMacd = macdVals.at(-1), prevMacd = macdVals.at(-2);
  const crossover =
    prevMacd.MACD < prevMacd.signal && lastMacd.MACD > lastMacd.signal ? 'bullish' :
    prevMacd.MACD > prevMacd.signal && lastMacd.MACD < lastMacd.signal ? 'bearish' : null;

  const lastPrice = prices.at(-1);
  const rangeBox = getRangeBox(klines);

  // Stato precedente
  const state = lastSignals[symbol][interval];

  // 1) Arma il segnale MACD
  if (crossover) {
    state.macd = crossover;
    state.notified = false;
    console.log(`⚡ ${symbol}[${interval}] MACD ${crossover} armato`);
    return;
  }

  // 2) Breakout dopo incrocio
  if (state.macd && !state.notified) {
    const breakout =
      lastPrice > rangeBox.high ? 'up' :
      lastPrice < rangeBox.low ? 'down' : null;

    if ((state.macd === 'bullish' && breakout === 'up') ||
        (state.macd === 'bearish' && breakout === 'down')) {
      
      const direction = state.macd === 'bullish' ? 'long' : 'short';
      const boxSize = isNaN(rangeBox.size) || rangeBox.size <= 0 ? lastPrice * 0.01 : rangeBox.size;
      const tp = direction === 'long' ? lastPrice + boxSize : lastPrice - boxSize;
      const sl = direction === 'long' ? lastPrice - boxSize * 0.5 : lastPrice + boxSize * 0.5;

      const emoji = coinEmojis[symbol] || '🔸';
      const msg = `
✋ ${emoji} *MACD (26/50) + BREAKOUT with range box* su *${symbol}* [${interval}]
${direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} | Prezzo: $${formatPrice(lastPrice)}

📦 Box (ultime 20 candele)
• High: $${formatPrice(rangeBox.high)}
• Low:  $${formatPrice(rangeBox.low)}
• Size: $${formatPrice(rangeBox.size)}

${state.macd === 'bullish' ? '✅ Cross BULLISH' : '✅ Cross BEARISH'}

📈 EMA:
• 12:  $${formatPrice(ema12)}
• 26:  $${formatPrice(ema26)}
• 50:  $${formatPrice(ema50)}
• 200: $${formatPrice(ema200)}

🎯 TP: $${formatPrice(tp)}
🛑 SL: $${formatPrice(sl)}
`.trim();

      await sendTelegramMessage(msg);
      state.notified = true;
    }
  }
}

// ──────────────── LOOP ────────────────
async function checkMarket() {
  for (const c of coins) {
    for (const tf of intervals) {
      await analyze(c, tf);
      await new Promise(r => setTimeout(r, 350));
    }
  }
}

setInterval(checkMarket, 60 * 1000);
