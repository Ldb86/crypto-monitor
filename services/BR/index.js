//qui abbiamo solo la rottura del rangeBox che funziona con TP/SL corretti
//sulle ultime 20 candele

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
  'TIAUSDT', 'SHIBUSDT', 'ICPUSDT', 'BCHUSDT','LINKUSDT', 'AVAXUSDT', 'TONUSDT'
];

const coinEmojis = {
  BTCUSDT: '🟠', ETHUSDT: '⚫', SOLUSDT: '🌞', BNBUSDT: '🌈', UNIUSDT: '🟣',
  XRPUSDT: '🔵', LTCUSDT: '⚪', AAVEUSDT: '🔷', SUIUSDT: '🔹', ENAUSDT: '🟪',
  ONDOUSDT: '🟤', DOGEUSDT: '🐶', DOTUSDT: '⚪', ATOMUSDT: '🌌', HBARUSDT: '🚀',
  TIAUSDT: '🟡', SHIBUSDT: '🐕', PEPEUSDT: '🐸', ICPUSDT: '🌪', BCHUSDT:'⭐️', LINKUSDT:'⚡️', 
  AVAXUSDT:'🔥', TONUSDT:'🌦'
};

const intervals = ['1h', '2h', '4h', '6h', '12h', '1d', '1w'];
const intervalMap = {
  '1h': '60', '2h': '120',
  '4h': '240', '6h': '360', '12h': '720', '1d': 'D', '1w': 'W'
};

// ──────────────── STATO ────────────────
const lastSignals = {};
coins.forEach(c => {
  lastSignals[c] = {};
  intervals.forEach(tf => {
    lastSignals[c][tf] = {
      macd: null,
      breakoutDone: false,
      lastDirection: null
    };
  });
});

function now() {
  const d = new Date();
  return `[${d.toLocaleTimeString()}]`;
}

// ──────────────── SERVER ────────────────
app.get('/', (req, res) => res.send('✅ MACD + Breakout Bot attivo'));
app.listen(PORT, () => console.log(`🚀 Server in ascolto sulla porta ${PORT}`));

// ──────────────── TELEGRAM ────────────────
async function sendTelegramMessage(msg, symbol, interval) {
  for (let i = 0; i < TELEGRAM_TOKEN.length; i++) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN[i].trim()}/sendMessage`;
    try {
      await axios.post(url, {
        chat_id: TELEGRAM_CHAT_ID[i].trim(),
        text: msg,
        parse_mode: 'Markdown'
      });
      console.log(`${now()} 📬 Telegram inviato su ${symbol}[${interval}] ➡️ Bot ${i + 1}`);
    } catch (e) {
      console.error(`${now()} ❌ Telegram error:`, e.message);
    }
  }
}

// ──────────────── BYBIT DATA ────────────────
async function fetchKlines(symbol, interval, limit = 300, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get('https://api.bybit.com/v5/market/kline', {
        params: { category: 'spot', symbol, interval: intervalMap[interval], limit },
        timeout: 20000 // ⏱️ aumentato da 10s a 20s
      });

      return res.data.result.list.reverse().map(k => ({
        time: Number(k[0]),
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +k[5]
      }));
    } catch (err) {
      console.warn(`${now()} ⚠️ fetchKlines ${symbol}[${interval}] tentativo ${attempt}/${retries} fallito: ${err.message}`);
      if (attempt === retries) {
        console.error(`${now()} ❌ fetchKlines ${symbol}[${interval}] errore definitivo dopo ${retries} tentativi.`);
        return [];
      }
      await new Promise(r => setTimeout(r, 1500)); // 🕒 attesa tra i retry
    }
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
  if (klines.length <= lookback + 1) return { high: NaN, low: NaN, size: NaN };
  const slice = klines.slice(-(lookback + 1), -1);
  const highs = slice.map(k => k.high);
  const lows = slice.map(k => k.low);
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

  const lastMacd = macdVals.at(-1);
  const prevMacd = macdVals.at(-2);
  const crossover =
    prevMacd.MACD < prevMacd.signal && lastMacd.MACD > lastMacd.signal ? 'bullish' :
    prevMacd.MACD > prevMacd.signal && lastMacd.MACD < lastMacd.signal ? 'bearish' :
    null;

  if (crossover) {
    console.log(`${now()} ⚡ ${symbol}[${interval}] MACD ${crossover} rilevato`);
  }

  const lastPrice = prices.at(-1);
  const rangeBox = getRangeBox(klines);
  const state = lastSignals[symbol][interval];

  const breakout =
    lastPrice > rangeBox.high ? 'up' :
    lastPrice < rangeBox.low ? 'down' : null;

  // ✅ Reset del segnale se il prezzo rientra nel box
  if (lastPrice <= rangeBox.high && lastPrice >= rangeBox.low) {
    state.breakoutDone = false;
  }

  // Aggiorna MACD
  if (crossover) state.macd = crossover;

  // Invio segnale su breakout reale
  if (
    breakout &&
    !state.breakoutDone &&
    ((breakout === 'up' && state.lastDirection !== 'long') ||
     (breakout === 'down' && state.lastDirection !== 'short'))
  ) {
    const direction = breakout === 'up' ? 'long' : 'short';
    state.breakoutDone = true;
    state.lastDirection = direction;

    console.log(`${now()} 🚀 ${symbol}[${interval}] breakout ${breakout} → ${direction.toUpperCase()}`);

    await sendSignal(symbol, interval, lastPrice, rangeBox, ema12, ema26, ema50, ema200, direction);
  }
}

// ──────────────── INVIO MESSAGGIO ────────────────
async function sendSignal(symbol, interval, lastPrice, rangeBox, ema12, ema26, ema50, ema200, direction) {
  const emoji = coinEmojis[symbol] || '🔸';

  
  
const isShortTF = (interval === '15m' || interval === '30m')
  const boxSize = isNaN(rangeBox.size) || rangeBox.size <= 0 ? lastPrice * 0.01 : rangeBox.size;
  const tp = direction === 'long' ? lastPrice + boxSize : lastPrice - boxSize;
  const sl = direction === 'long' ? lastPrice - boxSize * 0.5 : lastPrice + boxSize * 0.5;

  const msg = `
✋ ${emoji} *BREAKOUT Range Box* su *${symbol}* [${interval}]
${direction === 'long' ? '🟢 LONG formazione' : '🔴 SHORT formazione'} | Prezzo: $${formatPrice(lastPrice)} *(BR)*

📦 Box (ultime 20 candele)
• High: $${formatPrice(rangeBox.high)}
• Low:  $${formatPrice(rangeBox.low)}
• Size: $${formatPrice(rangeBox.size)}

📈 EMA:
• 12:  $${formatPrice(ema12)}
• 26:  $${formatPrice(ema26)}
• 50:  $${formatPrice(ema50)}
• 200: $${formatPrice(ema200)}

🎯 TP: $${formatPrice(tp)}
🛑 SL: $${formatPrice(sl)}


${isShortTF ? '⚠️' : ''} *Non rischiare più dell\'1–3% del tuo capitale totale*
`.trim();

  await sendTelegramMessage(msg, symbol, interval);
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
