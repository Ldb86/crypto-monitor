require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { EMA } = require('technicalindicators');

const app = express();
const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.BOT_TOKENS.split(',');  // due token
const TELEGRAM_CHAT_ID = process.env.CHAT_IDS.split(','); // due chat_id

const coins = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT',
  'BNBUSDT', 'UNIUSDT', 'XRPUSDT',
  'LTCUSDT', 'AAVEUSDT', 'SUIUSDT', 'ENAUSDT'
];

const intervals = ['5m', '15m'];
const SIGNAL_INTERVAL_MS = 15 * 60 * 1000;

const lastSignals = {};
coins.forEach(coin => {
  lastSignals[coin] = {};
  intervals.forEach(tf => {
    lastSignals[coin][tf] = { type: null, timestamp: 0 };
  });
});

app.get('/', (req, res) => {
  res.send('✅ Binance EMA Alert Bot attivo');
});

app.listen(PORT, () => {
  console.log(`🚀 Server in ascolto sulla porta ${PORT}`);
});

async function sendTelegramMessage(message) {
  // Itera su entrambi i bot
  for (let i = 0; i < TELEGRAM_TOKEN.length; i++) {
    const token = TELEGRAM_TOKEN[i].trim();
    const chatId = TELEGRAM_CHAT_ID[i] ? TELEGRAM_CHAT_ID[i].trim() : null;

    if (!chatId) continue; // Se non c'è un chat_id per il bot corrente, salta

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
      await axios.post(url, {
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      });
      console.log(`📬 Telegram: ${message.split('\n')[0]} ➡️ Bot ${i + 1}`);
    } catch (err) {
      console.error(`Telegram error with bot ${i + 1}:`, err.message);
    }
  }
}

async function fetchKlines(symbol, interval, limit = 200) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await axios.get(url);
  return res.data.map(k => parseFloat(k[4])); // chiusura
}

async function analyzeEMA(symbol, interval) {
  try {
    const prices = await fetchKlines(symbol, interval);
    const ema12 = EMA.calculate({ period: 12, values: prices });
    const ema26 = EMA.calculate({ period: 26, values: prices });

    if (ema12.length < 2 || ema26.length < 2) {
      console.log(`⏳ Dati insufficienti per ${symbol} [${interval}]`);
      return;
    }

    const prevEma12 = ema12.at(-2);
    const prevEma26 = ema26.at(-2);
    const lastEma12 = ema12.at(-1);
    const lastEma26 = ema26.at(-1);
    const lastPrice = prices.at(-1);

    let crossover = null;
    if (prevEma12 < prevEma26 && lastEma12 > lastEma26) crossover = 'bullish';
    if (prevEma12 > prevEma26 && lastEma12 < lastEma26) crossover = 'bearish';

    const now = Date.now();
    const lastSignal = lastSignals[symbol][interval];
    const isSolana = symbol === 'SOLUSDT';
    const isNewSignal = lastSignal.type !== crossover;
    const isTimeOk = isSolana || now - lastSignal.timestamp >= SIGNAL_INTERVAL_MS;

    // ✅ Segnale confermato (crossover)
    if (crossover && isNewSignal && isTimeOk) {
      const msg = `
📢 *Segnale ${crossover === 'bullish' ? 'LONG 🟢' : 'SHORT 🔴'} per ${symbol}* [*${interval}*]
💰 Prezzo: *$${lastPrice.toFixed(2)}*
📈 EMA12: *$${lastEma12.toFixed(2)}* | EMA26: *$${lastEma26.toFixed(2)}*
⚠️ Timeframe: *${interval}*
      `.trim();

      await sendTelegramMessage(msg);
      lastSignals[symbol][interval] = { type: crossover, timestamp: now };
    }

    // 🔍 Pre-crossover (EMA molto vicine)
//     else if (!crossover && Math.abs(lastEma12 - lastEma26) / ((lastEma12 + lastEma26) / 2) <= 0.001 &&
//              now - lastSignal.timestamp >= SIGNAL_INTERVAL_MS) {
//       const msg = `
// 👀 *Segnale in avvicinamento per ${symbol}* [*${interval}*]
// 💰 Prezzo: *$${lastPrice.toFixed(2)}*
// 📊 EMA12: *$${lastEma12.toFixed(2)}* | EMA26: *$${lastEma26.toFixed(2)}*
// 📉 Differenza: *${(Math.abs(lastEma12 - lastEma26) / ((lastEma12 + lastEma26) / 2) * 100).toFixed(4)}%*
// ⚠️ Le medie sono molto vicine, possibile incrocio a breve.
//       `.trim();

//       await sendTelegramMessage(msg);
//       lastSignals[symbol][interval].timestamp = now;
//     }

    // ⏱️ Notifica ogni minuto per SOLUSDT
    else if (symbol === 'SOLUSDT' && now - lastSignal.timestamp >= 60 * 1000) {
      const msg = `
📡 *Aggiornamento automatico ${symbol}* [*${interval}*]
💰 Prezzo: *$${lastPrice.toFixed(2)}*
📈 EMA12: *$${lastEma12.toFixed(2)}* | EMA26: *$${lastEma26.toFixed(2)}*
ℹ️ Notifica inviata ogni 1 minuto.
      `.trim();

      await sendTelegramMessage(msg);
      lastSignals[symbol][interval].timestamp = now;
    }

    else {
      console.log(`📉 ${symbol} [${interval}]: nessun incrocio EMA.`);
    }
  } catch (err) {
    console.error(`❌ Errore su ${symbol} [${interval}]:`, err.message);
  }
}

async function checkMarket() {
  for (const coin of coins) {
    for (const interval of intervals) {
      await analyzeEMA(coin, interval);
      await new Promise(r => setTimeout(r, 250)); // 0.25s delay
    }
  }
}

setInterval(checkMarket, 60 * 1000); // ogni minuto
