require('dotenv').config();
const axios = require('axios');
const { SMA } = require('technicalindicators');

const TELEGRAM_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.CHAT_ID;

const coins = ['bitcoin', 'ethereum', 'solana'];
const vs_currency = 'usd';
const lastAlerts = {}; // evita spam

const thresholds = {
  bitcoin: { min: 10, max: 20 },
  ethereum: { min: 5, max: 10 },
  solana: { min: 5, max: 10 },
};

// === Utility Telegram ===
async function sendTelegramMessage(message) {
  const url = https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage;
  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
    });
    console.log(📬 Telegram: ${message});
  } catch (err) {
    console.error('Errore Telegram:', err.message);
  }
}

// === Price fetch da CoinGecko ===
async function fetchPrices(coinId) {
  const now = Math.floor(Date.now() / 1000);
  const past = now - (60 * 60 * 4); // 4h data (per SMA)
  const url = https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=${vs_currency}&from=${past}&to=${now};
  const res = await axios.get(url);
  return res.data.prices.map(p => p[1]); // solo i prezzi
}

// === Calcolo MACD con SMA ===
function calculateMACD(prices, shortPeriod = 12, longPeriod = 26) {
  const shortMA = SMA.calculate({ values: prices, period: shortPeriod });
  const longMA = SMA.calculate({ values: prices, period: longPeriod });

  const lengthDiff = longMA.length - shortMA.length;
  const macd = shortMA.map((val, i) => val - longMA[i + lengthDiff]);

  return {
    macd,
    shortMA: shortMA.slice(-macd.length),
    longMA: longMA.slice(-macd.length),
  };
}

// === Segnali Long/Short ===
function getSignal(shortMA, longMA) {
  const last = shortMA.length - 1;
  const prevCross = shortMA[last - 1] - longMA[last - 1];
  const currCross = shortMA[last] - longMA[last];

  if (prevCross < 0 && currCross > 0) return 'LONG';
  if (prevCross > 0 && currCross < 0) return 'SHORT';
  return 'HOLD';
}

// === Controllo prezzi e segnali ===
async function checkMarket() {
  console.clear();
  console.log(🕒 ${new Date().toLocaleTimeString()});

  for (let coin of coins) {
    try {
      const prices = await fetchPrices(coin);
      const lastPrice = prices.at(-1);
      const { min, max } = thresholds[coin];

      // === Alert Statico (come prima) ===
      console.log(💰 ${coin.toUpperCase()}: $${lastPrice});
      if (lastPrice < min && lastAlerts[coin] !== 'low') {
        await sendTelegramMessage(⚠️ ${coin.toUpperCase()} è sceso sotto $${min}: $${lastPrice});
        lastAlerts[coin] = 'low';
      } else if (lastPrice > max && lastAlerts[coin] !== 'high') {
        await sendTelegramMessage(🚀 ${coin.toUpperCase()} ha superato $${max}: $${lastPrice});
        lastAlerts[coin] = 'high';
      }

      // === Strategia Tecnica ===
      const { shortMA, longMA } = calculateMACD(prices);
      if (shortMA.length === 0 || longMA.length === 0) continue;

      const signal = getSignal(shortMA, longMA);
      const lastSignal = lastAlerts[${coin}_strategy];

      if (signal !== 'HOLD' && signal !== lastSignal) {
        const shortVal = shortMA.at(-1).toFixed(4);
        const longVal = longMA.at(-1).toFixed(4);
      
        const message = 
      📈 Segnale *${signal}* su ${coin.toUpperCase()} (MACD Crossover)
      💰 Prezzo: ${lastPrice.toFixed(2)}
      📊 Short MA (${shortMA.length}): ${shortVal}
      📊 Long MA (${longMA.length}): ${longVal}
      .trim();
      
        await sendTelegramMessage(message);
        lastAlerts[${coin}_strategy] = signal;
      }
      

    } catch (err) {
      console.error(Errore su ${coin}:, err.message);
    }
  }
}

// Avvio loop ogni 15 minuti
checkMarket();
setInterval(checkMarket, 15 * 60 * 1000);  integrami le cose da modificare al mio file