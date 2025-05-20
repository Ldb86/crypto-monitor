require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { EMA, RSI, MACD } = require('technicalindicators');

const app = express();
const PORT = process.env.PORT || 4000;
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
  BTCUSDT: '🟠', // arancione
  ETHUSDT: '⚫', // nero
  SOLUSDT: '🟢', // verde
  BNBUSDT: '🟡', // giallo
  UNIUSDT: '🟣', // viola
  XRPUSDT: '🔵', // blu
  LTCUSDT: '⚪', // bianco/grigio
  AAVEUSDT: '🔷', // azzurro
  SUIUSDT: '🔹', // blu chiaro
  ENAUSDT: '🟪', // viola scuro
  ONDOUSDT: '🟤', // marrone
  DOGEUSDT: '🐶', // cane
  DOTUSDT: '⚪', // bianco/grigio
  ATOMUSDT: '🌌', // galassia
  HBARUSDT: '🔴', // rosso
  TIAUSDT: '🟡', // giallo
  SHIBUSDT: '🐕', // cane
  PEPEUSDT: '🐸' // rana
 };


const intervals = ['5m', '15m', '30m', '1h', '2h', '4h', '1d'];
//const SIGNAL_INTERVAL_MS = 60 * 1000;

const lastSignals = {};
coins.forEach(coin => {
  lastSignals[coin] = {};
  intervals.forEach(tf => {
    lastSignals[coin][tf] = { type: null, timestamp: 0 };
  });
});

const intervalMap = {
  '5m': '5',
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

async function fetchKlines(symbol, interval, limit = 200) {
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
    if (!data || data.length === 0) {
      throw new Error('Nessun dato restituito da Bybit.');
    }

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
    const macdInput = {
      values: prices,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    };
    const macd = MACD.calculate(macdInput);

    if (ema12.length < 2 || ema26.length < 2 || rsi.length < 1 || macd.length < 1) {
      console.log(`⏳ Dati insufficienti per ${symbol} [${interval}]`);
      return;
    }

    const lastPrice = prices.at(-1);
    const lastEma12 = ema12.at(-1);
    const lastEma26 = ema26.at(-1);
    const lastEma50 = ema50.at(-1);
    const lastEma200 = ema200.at(-1);
    const lastRsi = rsi.at(-1);
    const lastMacd = macd.at(-1);

    const { support, resistance } = getSupportResistance(prices, 20);

    // Detect crossover
    let crossover = null;
    const prevEma12 = ema12.at(-2);
    const prevEma26 = ema26.at(-2);
    if (prevEma12 < prevEma26 && lastEma12 > lastEma26) crossover = 'bullish';
    if (prevEma12 > prevEma26 && lastEma12 < lastEma26) crossover = 'bearish';

    const now = Date.now();
    const lastSignal = lastSignals[symbol][interval];

    const rsiCategory = lastRsi < 30 ? 'Ipervenduto' : lastRsi > 70 ? 'Ipercomprato' : 'Neutro';
    const macdSignal = lastMacd.MACD > lastMacd.signal ? 'Rialzista ✅' : 'Ribassista ✅';

    const shouldNotify = intervals.includes(interval);
    if (shouldNotify && crossover && lastSignal.type !== crossover) {
      const emoji = coinEmojis[symbol] || '🔸';
      const msg = `
${emoji} 📉 Segnale ${crossover === 'bullish' ? 'LONG 🟢' : 'SHORT 🔴'} per *${symbol}* [${interval}]
📍 Prezzo attuale: $${formatPrice(lastPrice)}
🔁 EMA 12 ha incrociato EMA 26: ${crossover.toUpperCase()}

📈 EMA12: $${formatPrice(lastEma12)}
📈 EMA26: $${formatPrice(lastEma26)}
📈 EMA50: $${formatPrice(lastEma50)}
📈 EMA200: $${formatPrice(lastEma200)}

MACD: ${macdSignal}
RSI (14): ${lastRsi.toFixed(2)} (${rsiCategory}) ✅
📉 Supporto: $${formatPrice(support)}
📈 Resistenza: $${formatPrice(resistance)}
      `.trim();

      await sendTelegramMessage(msg);
      lastSignals[symbol][interval] = { type: crossover, timestamp: now };
    } else {
      console.log(`⏸ Nessun cambio trend per ${symbol} [${interval}]`);
    }

  } catch (err) {
    console.error(`❌ Errore su ${symbol} [${interval}]:`, err.message);
  }
}
// Funzione principale per controllare il mercato
// e inviare notifiche
async function checkMarket() {
  for (const coin of coins) {
    for (const interval of intervals) {
      try {
        await analyzeEMA(coin, interval);
      } catch (err) {
        console.error(`❌ Errore durante l'analisi EMA per ${coin} [${interval}]:`, err.message);
      }
      await new Promise(r => setTimeout(r, 350)); // breve pausa per evitare rate limit
    }
  }
}

setInterval(checkMarket, 60 * 1000);
