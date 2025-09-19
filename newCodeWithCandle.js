require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { EMA, RSI, MACD, ADX } = require('technicalindicators');

const app = express();
const PORT = process.env.PORT || 3000;

// ENV (array di bot/chat supportati, come nel tuo codice)
const TELEGRAM_TOKEN = (process.env.BOT_TOKENS || '').split(',').map(s => s.trim()).filter(Boolean);
const TELEGRAM_CHAT_ID = (process.env.CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

// --- Config monitoraggio ---
const coins = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','UNIUSDT','XRPUSDT',
  'LTCUSDT','AAVEUSDT','SUIUSDT','ENAUSDT','ONDOUSDT','DOGEUSDT',
  'PEPEUSDT','DOTUSDT','ATOMUSDT','HBARUSDT','TIAUSDT','SHIBUSDT'
];

const coinEmojis = {
  BTCUSDT:'🟠', ETHUSDT:'⚫', SOLUSDT:'🟢', BNBUSDT:'🟡', UNIUSDT:'🟣',
  XRPUSDT:'🔵', LTCUSDT:'⚪', AAVEUSDT:'🔷', SUIUSDT:'🔹', ENAUSDT:'🟪',
  ONDOUSDT:'🟤', DOGEUSDT:'🐶', DOTUSDT:'⚪', ATOMUSDT:'🌌', HBARUSDT:'🔴',
  TIAUSDT:'🟡', SHIBUSDT:'🐕', PEPEUSDT:'🐸'
};

const intervals = ['15m','30m','1h','2h','4h','1d'];
const intervalMap = { '15m':'15', '30m':'30', '1h':'60', '2h':'120', '4h':'240', '1d':'D' };

// Parametri strategia
const BOX_LOOKBACK = 20;           // ultime 20 candele (escludendo l’ultima)
const ADX_PERIOD = 14;
const ADX_LOWER = 18;              // soglia "consolidamento" ADX
const TP_MULT = 1.0;               // ampiezza box
const SL_MULT = 0.5;               // metà ampiezza box
const MACD_FAST = 26;              // MACD 26/50
const MACD_SLOW = 50;
const MACD_SIGNAL = 9;

// Stato anti-duplicati: memorizza ultimo breakout per symbol/interval
const lastBreakoutState = {};
coins.forEach(c => {
  lastBreakoutState[c] = {};
  intervals.forEach(tf => (lastBreakoutState[c][tf] = null)); // 'long' | 'short' | null
});

// --- Server di salute ---
app.get('/', (req, res) => {
  res.send('✅ Breakout Bot attivo (EMA/MACD/ADX/Box/TP-SL) – notifiche solo su breakout');
});

app.listen(PORT, () => console.log(`🚀 Server in ascolto sulla porta ${PORT}`));

// --- Utils ---
function formatPrice(price) {
  if (price == null || Number.isNaN(price)) return 'N/A';
  if (price < 0.01) return price.toFixed(9);
  if (price < 1) return price.toFixed(4);
  return price.toFixed(2);
}

async function sendTelegramMessage(message) {
  for (let i = 0; i < TELEGRAM_TOKEN.length; i++) {
    const token = TELEGRAM_TOKEN[i];
    const chatId = TELEGRAM_CHAT_ID[i];
    if (!token || !chatId) continue;

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
      await axios.post(url, { chat_id: chatId, text: message, parse_mode: 'Markdown' });
      console.log(`📬 Telegram inviato ➡️ Bot ${i + 1}: ${message.split('\n')[0]}`);
    } catch (err) {
      console.error(`Telegram error bot ${i + 1}:`, err.message);
    }
  }
}

async function fetchKlines(symbol, interval, limit = 300, retry = 2) {
  const mappedInterval = intervalMap[interval];
  if (!mappedInterval) {
    console.error(`⚠️ Interval "${interval}" non mappato.`);
    return [];
  }
  try {
    const res = await axios.get('https://api.bybit.com/v5/market/kline', {
      params: { category: 'spot', symbol, interval: mappedInterval, limit },
      timeout: 10000
    });
    const list = res?.data?.result?.list;
    if (!Array.isArray(list) || list.length === 0) throw new Error('Lista candele vuota');

    // reverse() per avere dal più vecchio al più recente
    return list.reverse().map(k => ({
      time: Number(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    })).filter(k =>
      Number.isFinite(k.open) && Number.isFinite(k.high) && Number.isFinite(k.low) &&
      Number.isFinite(k.close) && Number.isFinite(k.volume)
    );
  } catch (err) {
    if (retry > 0) {
      console.warn(`🔁 Retry ${symbol} [${interval}]… (${err.message})`);
      await new Promise(r => setTimeout(r, 1000));
      return fetchKlines(symbol, interval, limit, retry - 1);
    }
    console.error(`❌ Errore fetchKlines ${symbol} [${interval}]: ${err.message}`);
    return [];
  }
}

function getRangeBox(klines, lookback = BOX_LOOKBACK) {
  // Box su ultime N candele **chiuse prima** dell’ultima (esclude l’ultima candela)
  if (!Array.isArray(klines) || klines.length < lookback + 1) return null;
  const slice = klines.slice(-(lookback + 1), -1);
  const highs = slice.map(k => k.high);
  const lows = slice.map(k => k.low);
  if (highs.length === 0 || lows.length === 0) return null;

  const high = Math.max(...highs);
  const low = Math.min(...lows);
  const size = high - low;
  if (!Number.isFinite(high) || !Number.isFinite(low) || size <= 0) return null;

  return { high, low, size };
}

function getVolumeDot(volumes) {
  if (!volumes || volumes.length < 26) return false;
  const emaVol12 = EMA.calculate({ period: 12, values: volumes });
  const emaVol26 = EMA.calculate({ period: 26, values: volumes });
  const v = volumes.at(-1);
  const v12 = emaVol12.at(-1);
  const v26 = emaVol26.at(-1);
  return Number.isFinite(v) && Number.isFinite(v12) && Number.isFinite(v26) && v > v12 && v > v26;
}

function macdCrossover(values) {
  if (!values || values.length < 2) return null;
  const prev = values.at(-2);
  const last = values.at(-1);
  if (!prev || !last) return null;
  if (prev.MACD < prev.signal && last.MACD > last.signal) return 'bullish';
  if (prev.MACD > prev.signal && last.MACD < last.signal) return 'bearish';
  return null;
}

async function analyze(symbol, interval) {
  const klines = await fetchKlines(symbol, interval, 300);
  if (klines.length < 200) {
    console.log(`⏳ Dati insufficienti per ${symbol} [${interval}]`);
    return;
  }

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const lastClose = closes.at(-1);

  // EMA prezzi
  const ema12 = EMA.calculate({ period: 12, values: closes }).at(-1);
  const ema26 = EMA.calculate({ period: 26, values: closes }).at(-1);
  const ema50 = EMA.calculate({ period: 50, values: closes }).at(-1);
  const ema200 = EMA.calculate({ period: 200, values: closes }).at(-1);

  // MACD 26/50
  const macdVals = MACD.calculate({
    values: closes,
    fastPeriod: MACD_FAST,
    slowPeriod: MACD_SLOW,
    signalPeriod: MACD_SIGNAL,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const lastMACD = macdVals.at(-1);
  const macdCross = macdCrossover(macdVals); // 'bullish' | 'bearish' | null

  // ADX
  const adxVals = ADX.calculate({ high: highs, low: lows, close: closes, period: ADX_PERIOD });
  const lastADX = adxVals.at(-1)?.adx;

  // Box range
  const box = getRangeBox(klines, BOX_LOOKBACK);
  if (!box) {
    console.log(`⚠️ Box non calcolabile per ${symbol} [${interval}]`);
    return;
  }

  // Breakout (ultima candela CHIUSA rispetto al box calcolato prima dell’ultima)
  let breakoutDir = null; // 'long' | 'short' | null
  if (lastClose > box.high) breakoutDir = 'long';
  else if (lastClose < box.low) breakoutDir = 'short';

  // Filtri: notifico SOLO se breakout e (ADX basso OR MACD crossover recente)
  const isADXLow = Number.isFinite(lastADX) && lastADX < ADX_LOWER;
  const macdRecent = macdCross !== null; // crossover tra le ultime 2 candele

  if (!breakoutDir || !(isADXLow || macdRecent)) {
    // Reset stato quando rientra nel box (così non blocchiamo nuovi breakout)
    if (breakoutDir === null && lastBreakoutState[symbol][interval] !== null) {
      lastBreakoutState[symbol][interval] = null;
    }
    return;
  }

  // Anti duplicati: invia solo se direzione cambiata rispetto all’ultimo breakout
  if (lastBreakoutState[symbol][interval] === breakoutDir) return;

  // Volume dot (pallino)
  const hasVolumeDot = getVolumeDot(volumes);

  // TP/SL dalla chiusura dell’ultima candela
  let tp = null, sl = null;
  if (breakoutDir === 'long') {
    tp = lastClose + TP_MULT * box.size;
    sl = lastClose - SL_MULT * box.size;
  } else {
    tp = lastClose - TP_MULT * box.size;
    sl = lastClose + SL_MULT * box.size;
  }

  // Messaggio
  const emoji = coinEmojis[symbol] || '🔸';
  const arrow = breakoutDir === 'long' ? '🟢⬆️' : '🔴⬇️';
  const dot = hasVolumeDot ? (breakoutDir === 'long' ? '🟢•' : '🔴•') : '';
  const macdLine = lastMACD
    ? `MACD(26/50): ${lastMACD.MACD.toFixed(4)} | Signal: ${lastMACD.signal.toFixed(4)} | Hist: ${lastMACD.histogram.toFixed(4)}`
    : 'MACD(26/50): N/A';

  const msg = `
${emoji} *BREAKOUT* su *${symbol}* [${interval}]
${arrow} ${dot} Prezzo: $${formatPrice(lastClose)}

📦 Box (ultime ${BOX_LOOKBACK} candele, esclusa l’ultima)
• High: $${formatPrice(box.high)}
• Low:  $${formatPrice(box.low)}
• Size: $${formatPrice(box.size)}

📐 ADX(${ADX_PERIOD}) = ${Number.isFinite(lastADX) ? lastADX.toFixed(2) : 'N/A'} (soglia ${ADX_LOWER}) ${isADXLow ? '✅' : '❌'}
${macdLine} ${macdCross ? (macdCross === 'bullish' ? '✅ Cross BULLISH' : '✅ Cross BEARISH') : '—'}

📈 EMA:
• 12:  $${formatPrice(ema12)}
• 26:  $${formatPrice(ema26)}
• 50:  $${formatPrice(ema50)}
• 200: $${formatPrice(ema200)}

🎯 TP: $${formatPrice(tp)}
🛑 SL: $${formatPrice(sl)}
`.trim();

  await sendTelegramMessage(msg);
  lastBreakoutState[symbol][interval] = breakoutDir;
}

async function checkMarket() {
  for (const coin of coins) {
    for (const interval of intervals) {
      try {
        await analyze(coin, interval);
      } catch (err) {
        console.error(`❌ Errore analyze ${coin} [${interval}]:`, err.message);
      }
      // piccola pausa per rate limit
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

// Avvio periodico: ogni minuto
setInterval(checkMarket, 60 * 1000);
checkMarket();
