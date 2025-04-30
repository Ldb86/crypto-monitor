require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { EMA } = require('technicalindicators');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.CHAT_ID;

const coins = ['bitcoin', 'ethereum', 'solana'];
const vs_currency = 'usd';

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

// === Ottieni prezzi da CoinGecko ===
async function fetchPrices(coinId) {
  const now = Math.floor(Date.now() / 1000);
  const past = now - (60 * 60 * 24); // 24 ore
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=${vs_currency}&from=${past}&to=${now}`;
  const res = await axios.get(url);
  return downsampleTo15Min(res.data.prices);
}

// === Analisi incroci EMA 12/26 ===
async function checkMarket() {
  console.clear();
  console.log(`🕒 ${new Date().toLocaleTimeString()}`);

  for (let coin of coins) {
    try {
      const prices = await fetchPrices(coin);
      const lastPrice = prices.at(-1);

      const ema12Arr = EMA.calculate({ values: prices, period: 12 });
      const ema26Arr = EMA.calculate({ values: prices, period: 26 });

      if (ema12Arr.length < 2 || ema26Arr.length < 2) {
        console.warn(`Dati insufficienti per ${coin}`);
        continue;
      }

      const ema12 = ema12Arr.at(-1);
      const ema26 = ema26Arr.at(-1);
      const prevEma12 = ema12Arr.at(-2);
      const prevEma26 = ema26Arr.at(-2);

      let crossover = null;
      if (prevEma12 < prevEma26 && ema12 > ema26) {
        crossover = 'bullish';
      } else if (prevEma12 > prevEma26 && ema12 < ema26) {
        crossover = 'bearish';
      }

      if (crossover) {
        const message = `
📈 *${coin.toUpperCase()}* - Segnale *${crossover === 'bullish' ? 'Bullish 🟢' : 'Bearish 🔴'}*
💰 Prezzo attuale: *$${lastPrice.toFixed(2)}*
📊 EMA 12: $${ema12.toFixed(2)}
📊 EMA 26: $${ema26.toFixed(2)}
        `.trim();

        await sendTelegramMessage(message);
      } else {
        console.log(`📉 Nessun incrocio su ${coin.toUpperCase()}`);
      }

    } catch (err) {
      console.error(`❌ Errore su ${coin}:`, err.message);
    }
  }
}

// Avvia analisi all'avvio + ogni 15 minuti
checkMarket();
setInterval(checkMarket, 15 * 60 * 1000);
