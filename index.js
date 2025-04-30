require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { EMA, RSI, SMA } = require('technicalindicators');

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

// === Ottieni prezzi da CoinGecko ===
async function fetchPrices(coinId) {
  const now = Math.floor(Date.now() / 1000);
  const past = now - (60 * 60 * 24); // 24 ore
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=${vs_currency}&from=${past}&to=${now}`;
  const res = await axios.get(url);
  return res.data.prices.map(p => p[1]);
}

// === Calcolo MACD ===
function calculateMACD(prices, shortPeriod = 12, longPeriod = 26) {
  const shortMA = SMA.calculate({ values: prices, period: shortPeriod });
  const longMA = SMA.calculate({ values: prices, period: longPeriod });

  const lengthDiff = longMA.length - shortMA.length;
  const macd = shortMA.map((val, i) => val - longMA[i + lengthDiff]);

  return { macd };
}

// === Analisi mercato ===
async function checkMarket() {
  console.clear();
  console.log(`🕒 ${new Date().toLocaleTimeString()}`);

  for (let coin of coins) {
    try {
      const prices = await fetchPrices(coin);
      const lastPrice = prices.at(-1);

      console.log(`💰 ${coin.toUpperCase()}: $${lastPrice.toFixed(2)}`);

      const ema12 = EMA.calculate({ values: prices, period: 12 });
      const ema26 = EMA.calculate({ values: prices, period: 26 });
      const ema50 = EMA.calculate({ values: prices, period: 50 }).at(-1);
      const ema200 = EMA.calculate({ values: prices, period: 200 }).at(-1);
      const rsi = RSI.calculate({ values: prices, period: 14 }).at(-1);
      const { macd } = calculateMACD(prices);
      const macdVal = macd.at(-1);

      // Calcolo incrocio EMA 12 / EMA 26
      const prev12 = ema12.at(-2);
      const prev26 = ema26.at(-2);
      const curr12 = ema12.at(-1);
      const curr26 = ema26.at(-1);

      let crossoverMessage = null;

      if (prev12 < prev26 && curr12 > curr26) {
        crossoverMessage = `🟢 *${coin.toUpperCase()}* - Incrocio *rialzista* (EMA 12 > EMA 26)\nPrezzo: *$${lastPrice.toFixed(2)}*`;
      } else if (prev12 > prev26 && curr12 < curr26) {
        crossoverMessage = `🔴 *${coin.toUpperCase()}* - Incrocio *ribassista* (EMA 12 < EMA 26)\nPrezzo: *$${lastPrice.toFixed(2)}*`;
      }

      if (crossoverMessage) {
        await sendTelegramMessage(crossoverMessage);
      }

    } catch (err) {
      console.error(`❌ Errore su ${coin}:`, err.message);
    }
  }
}

// Avvia analisi all'avvio + ogni 15 minuti
checkMarket();
setInterval(checkMarket, 15 * 60 * 1000);
