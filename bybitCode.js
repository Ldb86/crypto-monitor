require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { EMA, RSI, MACD } = require('technicalindicators');

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
  BTCUSDT: '🟠',
  ETHUSDT: '⚫',
  SOLUSDT: '🟢',
  BNBUSDT: '🟡',
  UNIUSDT: '🟣',
  XRPUSDT: '🔵',
  LTCUSDT: '⚪',
  AAVEUSDT: '🔷',
  SUIUSDT: '🔹',
  ENAUSDT: '🟪',
  ONDOUSDT: '🟤',
  DOGEUSDT: '🐶',
  DOTUSDT: '⚪',
  ATOMUSDT: '🌌',
  HBARUSDT: '🔴',
  TIAUSDT: '🟡',
  SHIBUSDT: '🐕',
  PEPEUSDT: '🐸'
};

const intervals = ['15m', '30m', '1h', '2h', '4h', '1d'];

const lastSignals = {};
coins.forEach(coin => {
  lastSignals[coin] = {};
  intervals.forEach(tf => {
    lastSignals[coin][tf] = { type: null, macdType: null, timestamp: 0 };
  });
});

const intervalMap = {
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '1d': 'D'
};

app.get('/', (req, res) => {
  res.send('✅ EMA Alert Bot attivo');
});

app.listen(PORT, () => {
  console.log(`🚀 Server in ascolto sulla porta ${PORT}`);
});

async function sendTelegramMessage(message) {
  for (let i = 0; i < TELEGRAM_TOKEN.length; i++) {
    const token = TELEGRAM_TOKEN[i].trim();
    const chatId = TELEGRAM_CHAT_ID[i] ? TELEGRAM_CHAT_ID[i].trim() : null;

    if (!chatId) continue;

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

async function fetchKlines(symbol, interval, limit = 300) {
  const mappedInterval = intervalMap[interval];
  if (!mappedInterval) {
    console.error(`⚠️ Interval "${interval}" non valido o non mappato in intervalMap.`);
    return [];
  }

  try {
    const res = await axios.get('https://api.bybit.com/v5/market/kline', {
      params: {
        category: 'spot',
        symbol,
        interval: mappedInterval,
        limit
      }
    });

    const data = res.data?.result?.list;
    if (!data || data.length === 0) throw new Error('Nessun dato restituito da Bybit.');

    return data.reverse().map(k => ({
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      time: Number(k[0])
    }));
  } catch (error) {
    console.error(`❌ Errore nella fetchKlines da Bybit per ${symbol} [${interval}]:`, error.message);
    return [];
  }
}

function getSupportResistance(prices, lookback = 20) {
  const recent = prices.slice(-lookback);
  const support = Math.min(...recent);
  const resistance = Math.max(...recent);
  return { support, resistance };
}

function formatPrice(price) {
  if (price < 0.01) return price.toFixed(9);
  if (price < 1) return price.toFixed(4);
  return price.toFixed(2);
}

async function analyzeEMA(symbol, interval) {
  try {
    const klines = await fetchKlines(symbol, interval, 300);
    const prices = klines.map(k => k.close);

    const ema12 = EMA.calculate({ period: 12, values: prices });
    const ema26 = EMA.calculate({ period: 26, values: prices });
    const ema50 = EMA.calculate({ period: 50, values: prices });
    const ema200 = EMA.calculate({ period: 200, values: prices });
    const rsi = RSI.calculate({ period: 14, values: prices });

    const macdCustomInput = {
      values: prices,
      fastPeriod: 26,
      slowPeriod: 50,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    };
    const macdCustom = MACD.calculate(macdCustomInput);

    if (
      ema12.length < 1 || ema26.length < 1 ||
      ema50.length < 1 || ema200.length < 1 ||
      macdCustom.length < 2 || rsi.length < 1
    ) {
      console.log(`⏳ Dati insufficienti per ${symbol} [${interval}]`);
      return;
    }

    const lastPrice = prices.at(-1);
    const lastEma12 = ema12.at(-1);
    const lastEma26 = ema26.at(-1);
    const lastEma50 = ema50.at(-1);
    const lastEma200 = ema200.at(-1);
    const lastRsi = rsi.at(-1);
    const lastMacd = macdCustom.at(-1);
    const prevMacd = macdCustom.at(-2);
    const { support, resistance } = getSupportResistance(prices, 20);

    let crossover = null;
    if (prevMacd.MACD < prevMacd.signal && lastMacd.MACD > lastMacd.signal) crossover = 'bullish';
    if (prevMacd.MACD > prevMacd.signal && lastMacd.MACD < lastMacd.signal) crossover = 'bearish';

    const lastSignal = lastSignals[symbol][interval];
    const rsiCategory = lastRsi < 30 ? 'Ipervenduto' : lastRsi > 70 ? 'Ipercomprato' : 'Neutro';

    if (intervals.includes(interval) && crossover && lastSignal.type !== crossover) {
      const emoji = coinEmojis[symbol] || '🔸';
      const msg = `
${emoji} ⚙️ *MACD (26/50) ${crossover === 'bullish' ? 'LONG 🟢' : 'SHORT 🔴'}* su *${symbol}* [${interval}]
📍 Prezzo attuale: $${formatPrice(lastPrice)}

🔁 MACD (26/50) ha incrociato la signal line: ${crossover.toUpperCase()}
MACD: ${lastMacd.MACD.toFixed(4)}
Signal: ${lastMacd.signal.toFixed(4)}
Histogram: ${lastMacd.histogram.toFixed(4)}

📊 EMA:
• EMA12: $${formatPrice(lastEma12)}
• EMA26: $${formatPrice(lastEma26)}
• EMA50: $${formatPrice(lastEma50)}
• EMA200: $${formatPrice(lastEma200)}

📈 RSI: ${lastRsi.toFixed(2)} (${rsiCategory})
📉 Supporto: $${formatPrice(support)}
📈 Resistenza: $${formatPrice(resistance)}
      `.trim();

      await sendTelegramMessage(msg);
      lastSignals[symbol][interval].type = crossover;
      lastSignals[symbol][interval].macdType = null;
    } else {
      console.log(`⏸ Nessun nuovo incrocio MACD (26/50) per ${symbol} [${interval}]`);
    }

  } catch (err) {
    console.error(`❌ Errore su ${symbol} [${interval}]:`, err.message);
  }
}

async function checkMarket() {
  for (const coin of coins) {
    for (const interval of intervals) {
      try {
        await analyzeEMA(coin, interval);
      } catch (err) {
        console.error(`❌ Errore durante l'analisi per ${coin} [${interval}]:`, err.message);
      }
      await new Promise(r => setTimeout(r, 350));
    }
  }
}

setInterval(checkMarket, 60 * 1000);
