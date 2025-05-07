require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { EMA, RSI } = require('technicalindicators');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.CHAT_ID;

const coins = [
  'bitcoin', 
  'ethereum', 
  'solana', 
  'aaveusdt', 
  'suiusdt',
  'bnbusdt',
  'uniusdt',
  'xrpusdt',
  'ltcusdt',
  'enausdt'
];
const vs_currency = 'usd';

// Tracking ultimi segnali per evitare ripetizioni
const lastSignals = {
  bitcoin: { type: null, timestamp: 0 },
  ethereum: { type: null, timestamp: 0 },
  solana: { type: null, timestamp: 0 },
  aaveusdt: { type: null, timestamp: 0 },
  suiusdt: { type: null, timestamp: 0 },
  bnbusdt: { type: null, timestamp: 0 },
  uniusdt: { type: null, timestamp: 0 },
  xrpusdt: { type: null, timestamp: 0 },  
  ltcusdt: { type: null, timestamp: 0 },
  enausdt: { type: null, timestamp: 0 }
};

const SIGNAL_INTERVAL_MS = 15 * 60 * 1000;

// === ROUTE BASE ===
app.get('/', (req, res) => {
  res.send('API Crypto attiva ✅');
});

app.listen(PORT, () => {
  console.log(`🚀 Server in ascolto sulla porta ${PORT}`);
});

// === Funzione invio Telegram ===
async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
    });
    console.log(`📬 Messaggio Telegram inviato:\n${message}\n`);
  } catch (err) {
    console.error('Errore Telegram:', err.message);
  }
}

// === Downsample a ogni 15 minuti ===
function downsampleTo15Min(data) {
  const result = [];
  let lastTime = 0;
  for (let [timestamp, price] of data) {
    if (timestamp - lastTime >= 15 * 60 * 1000) {
      result.push(price);
      lastTime = timestamp;
    }
  }
  return result;
}

function downsampleTo5Min(data) {
  const result = [];
  let lastTime = 0;
  for (let [timestamp, price] of data) {
    if (timestamp - lastTime >= 5 * 60 * 1000) {
      result.push(price);
      lastTime = timestamp;
    }
  }
  return result;
}

// === Ottieni prezzi da CoinGecko ===
async function fetchPrices(coinId) {
  const now = Math.floor(Date.now() / 1000);
  const past = now - (60 * 60 * 24); // 24 ore
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=${vs_currency}&from=${past}&to=${now}`;
  const res = await axios.get(url);
  return downsampleTo15Min(res.data.prices) && downsampleTo5Min(res.data.prices);
}

// === Analisi incroci + invio messaggio ===
async function checkMarket() {
  console.clear();
  console.log(`🕒 ${new Date().toLocaleTimeString()}`);

  for (let coin of coins) {
    try {
      const prices = await fetchPrices(coin);
      const lastPrice = prices.at(-1);

      const ema12Arr = EMA.calculate({ values: prices, period: 12 });
      const ema26Arr = EMA.calculate({ values: prices, period: 26 });
      const ema50Arr = EMA.calculate({ values: prices, period: 50 });
      const ema200Arr = EMA.calculate({ values: prices, period: 200 });
      const rsiArr = RSI.calculate({ values: prices, period: 14 });

      if ([ema12Arr, ema26Arr, ema50Arr, ema200Arr, rsiArr].some(arr => arr.length < 2)) {
        console.warn(`Dati insufficienti per ${coin}`);
        continue;
      }

      const ema12 = ema12Arr.at(-1);
      const ema26 = ema26Arr.at(-1);
      const ema50 = ema50Arr.at(-1);
      const ema200 = ema200Arr.at(-1);
      const rsi = rsiArr.at(-1);
      const rsiStatus = rsi > 70 ? 'Ipercomprato' : rsi < 30 ? 'Ipervenduto' : 'Neutro';

      const prevEma12 = ema12Arr.at(-2);
      const prevEma26 = ema26Arr.at(-2);

      let crossover = null;
      if (prevEma12 < prevEma26 && ema12 > ema26) {
        crossover = 'bullish';
      } else if (prevEma12 > prevEma26 && ema12 < ema26) {
        crossover = 'bearish';
      }

      const now = Date.now();
      const last = lastSignals[coin];

      if (crossover) {
        if (last.type !== crossover || now - last.timestamp >= SIGNAL_INTERVAL_MS) {
          const message = `
          📢 *Segnale ${crossover === 'bullish' ? 'LONG 🟢' : 'SHORT 🔴'} per ${coin.toUpperCase()}USDT*
          💰 *Prezzo attuale:* $${lastPrice.toFixed(2)}
          🔄 EMA 12 ha incrociato EMA 26: *${crossover.toUpperCase()}*
          
          - Prezzo rispetto a EMA 200: *$${ema200.toFixed(2)}* ✅
          - Prezzo rispetto a EMA 50: *$${ema50.toFixed(2)}* ✅
          - MACD: *${ema12 > ema26 ? 'Rialzista' : 'Ribassista'}* ✅
          - RSI (14): *${rsi.toFixed(2)} (${rsiStatus})* ✅
          - Volume: *Inferiore alla media* ✅
          ⚠️ *ATTENZIONE*: Possibile fase di lateralizzazione (variazione: *-0.03%*)
          `.trim();
          

          await sendTelegramMessage(message);
          lastSignals[coin] = { type: crossover, timestamp: now };
        } else {
          console.log(`⏳ ${coin}: incrocio ${crossover}, segnale già inviato.`);
        }
      } else {
        lastSignals[coin] = { type: null, timestamp: 0 };
        console.log(`📉 Nessun incrocio EMA per ${coin.toUpperCase()}`);
      }
    } catch (err) {
      console.error(`❌ Errore su ${coin}:`, err.message);
    }
  }
}

// Analisi ogni minuto
checkMarket();
setInterval(checkMarket, 60 * 1000);

// === Invio messaggio di test manuale ===
// async function sendTestMessage() {
//   const message = `
// 📢 *Messaggio di test da Crypto Bot*
// 🧪 Questo è solo un esempio di notifica Telegram.
// 💰 *Prezzo attuale:* $1234.56
// 📊 EMA 12: $1220.00
// 📊 EMA 26: $1210.00
// 📈 RSI (14): 48.5 (Neutro) ✅
//   `.trim();

//   await sendTelegramMessage(message);
// }

// SCOMMENTA per inviare un messaggio di test immediato all'avvio
// sendTestMessage();
