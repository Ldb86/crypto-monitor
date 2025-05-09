require('dotenv').config();
const axios = require('axios');
const { EMA, RSI, SMA } = require('technicalindicators');

const TELEGRAM_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.CHAT_ID;

const coins = ['bitcoin', 'ethereum', 'solana'];
const vs_currency = 'usd';

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});


// === Utility Telegram ===
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

// === Fetch prezzi da CoinGecko ===
async function fetchPrices(coinId) {
  const now = Math.floor(Date.now() / 1000);
  const past = now - (60 * 60 * 24); // Ultime 24 ore (più dati per EMA/RSI)
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=${vs_currency}&from=${past}&to=${now}`;
  const res = await axios.get(url);
  return res.data.prices.map(p => p[1]); // Solo prezzi
}

// === Calcolo MACD con SMA ===
function calculateMACD(prices, shortPeriod = 12, longPeriod = 26) {
  const shortMA = SMA.calculate({ values: prices, period: shortPeriod });
  const longMA = SMA.calculate({ values: prices, period: longPeriod });

  const lengthDiff = longMA.length - shortMA.length;
  const macd = shortMA.map((val, i) => val - longMA[i + lengthDiff]);

  return { macd };
}

// === Controllo Mercato ===
async function checkMarket() {
  console.clear();
  console.log(`🕒 ${new Date().toLocaleTimeString()}`);

  for (let coin of coins) {
    try {
      const prices = await fetchPrices(coin);
      const lastPrice = prices.at(-1);

      console.log(`💰 ${coin.toUpperCase()}: $${lastPrice.toFixed(2)}`);

      // Calcolo Indicatori
      const ema50 = EMA.calculate({ values: prices, period: 50 }).at(-1);
      const ema200 = EMA.calculate({ values: prices, period: 200 }).at(-1);
      const { macd } = calculateMACD(prices);
      const rsi = RSI.calculate({ values: prices, period: 14 }).at(-1);

      const macdVal = macd.at(-1);

      // === Strategia Tecnica ===
      const { shortMA, longMA } = calculateMACD(prices);
      if (shortMA.length === 0 || longMA.length === 0) continue;

      const signal = getSignal(shortMA, longMA);
      const lastSignal = lastAlerts[${coin}_strategy],

      if (signal !== 'HOLD' && signal !== lastSignal) {
        const shortVal = shortMA.at(-1).toFixed(4);
        const longVal = longMA.at(-1).toFixed(4);  

      // Componi messaggio
      const message = `
📈 *${coin.toUpperCase()}* - Aggiornamento Mercato:
💰 Prezzo attuale: *$${lastPrice.toFixed(2)}*

📊 Short MA (${shortMA.length}): ${shortVal}
📊 Long MA (${longMA.length}): ${longVal}
  .trim();
  
    await sendTelegramMessage(message);
    lastAlerts[${coin}_strategy] = signal;
  }

📊 EMA 50: *$${ema50?.toFixed(2) || 'N/A'}*
📊 EMA 200: *$${ema200?.toFixed(2) || 'N/A'}*
📉 MACD: *${macdVal?.toFixed(4) || 'N/A'}*
📈 RSI (14): *${rsi?.toFixed(2) || 'N/A'}*
      `.trim();

      await sendTelegramMessage(message);

    } catch (err) {
      console.error(`Errore su ${coin}:`, err.message);
    }
  }
}

// Avvio iniziale + Loop ogni 3 minuti
checkMarket();
setInterval(checkMarket, 15 * 60 * 1000);
