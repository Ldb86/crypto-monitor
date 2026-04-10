require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { EMA, BollingerBands } = require('technicalindicators');

/* ───────── CONFIG ───────── */
const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.BOT_TOKENS || !process.env.CHAT_IDS) {
  throw new Error('❌ BOT_TOKENS o CHAT_IDS mancanti nel file .env');
}

const TELEGRAM_TOKENS = process.env.BOT_TOKENS.split(',').map(s => s.trim());
const TELEGRAM_CHAT_IDS = process.env.CHAT_IDS.split(',').map(s => s.trim());

if (TELEGRAM_TOKENS.length !== TELEGRAM_CHAT_IDS.length) {
  throw new Error('❌ BOT_TOKENS e CHAT_IDS devono avere lo stesso numero di elementi');
}

/* ───────── COINS ───────── */
const coins = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','UNIUSDT','XRPUSDT','LTCUSDT',
  'AAVEUSDT','SUIUSDT','ENAUSDT','ONDOUSDT','DOGEUSDT','PEPEUSDT',
  'DOTUSDT','ATOMUSDT','HBARUSDT','TIAUSDT','SHIBUSDT','ICPUSDT',
  'BCHUSDT','LINKUSDT','AVAXUSDT','TONUSDT'
];

const coinEmojis = {
  BTCUSDT:'🟠', ETHUSDT:'⚫', SOLUSDT:'🌞', BNBUSDT:'🌈', UNIUSDT:'🟣',
  XRPUSDT:'🔵', LTCUSDT:'⚪', AAVEUSDT:'🔷', SUIUSDT:'🔹', ENAUSDT:'🟪',
  ONDOUSDT:'🟤', DOGEUSDT:'🐶', DOTUSDT:'⚪', ATOMUSDT:'🌌', HBARUSDT:'🚀',
  TIAUSDT:'🟡', SHIBUSDT:'🐕', PEPEUSDT:'🐸', ICPUSDT:'🌪',
  BCHUSDT:'⭐️', LINKUSDT:'⚡️', AVAXUSDT:'🔥', TONUSDT:'🌦'
};

/* ───────── TIMEFRAMES ───────── */
/* 30m su TUTTE le coin */
const intervals = ['30m', '2h', '4h', '6h', '12h', '1d', '1w'];

const intervalMap = {
  '30m':'30',
  '2h':'120',
  '4h':'240',
  '6h':'360',
  '12h':'720',
  '1d':'D',
  '1w':'W'
};

/* ───────── PARAMETRI BOT ───────── */
const FETCH_LIMIT = 260;          // abbastanza per EMA200
const PATTERN_WINDOW = 25;        // ultime 25 candele chiuse
const TRIANGLE_LENGTH = 5;        // più reattivo
const TRIANGLE_MULT = 1;
const BREAKOUT_BUFFER = 0.0008;   // 0.08% anti fake breakout (meno rigido)
const LIVE_BREAKOUT_BUFFER = 0.0005; // 0.05% per pre-alert live
const LOOP_EVERY_MS = 60 * 1000;  // check ogni 60 sec
const REQUEST_DELAY_MS = 250;     // delay tra richieste

/* ───────── FILTRI ───────── */
const USE_TREND_FILTER = false;   // DISATTIVO per non perdere 30m breakout
const REQUIRE_EMA12_BB_CONFIRM = false;

/* ───────── MODALITÀ ALERT ───────── */
/*
  SEND_LIVE_PREALERT = true  => manda pre-alert appena il prezzo rompe live
  SEND_CONFIRMED_ALERT = true => manda conferma quando chiude la candela
*/
const SEND_LIVE_PREALERT = true;
const SEND_CONFIRMED_ALERT = false;

/* ───────── STATE ───────── */
const state = {};
for (const c of coins) {
  state[c] = {};
  for (const tf of intervals) {
    state[c][tf] = {
      lastClosedBarTime: null,
      lastConfirmedAlertKey: null,
      lastLiveAlertKey: null,
      lastSignal: null
    };
  }
}

let isChecking = false;

/* ───────── HELPERS ───────── */
const now = () => `[${new Date().toLocaleTimeString()}]`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const formatPrice = p => {
  if (p == null || isNaN(p)) return 'N/A';
  if (p < 0.0001) return p.toFixed(10);
  if (p < 0.01) return p.toFixed(8);
  if (p < 1) return p.toFixed(4);
  return p.toFixed(2);
};

function getRangeBox(klines, lookback = 20) {
  const slice = klines.slice(-lookback);
  const highs = slice.map(k => k.high);
  const lows = slice.map(k => k.low);

  const high = Math.max(...highs);
  const low = Math.min(...lows);

  return {
    high,
    low,
    size: high - low
  };
}

/* ───────── TRIANGOLO ───────── */
function pivotHigh(high, len, i) {
  if (i < len || i + len >= high.length) return null;
  const c = high[i];
  for (let j = i - len; j <= i + len; j++) {
    if (high[j] > c) return null;
  }
  return c;
}

function pivotLow(low, len, i) {
  if (i < len || i + len >= low.length) return null;
  const c = low[i];
  for (let j = i - len; j <= i + len; j++) {
    if (low[j] < c) return null;
  }
  return c;
}

function atr(high, low, close, len, i) {
  if (i < len) return null;
  let sum = 0;
  for (let j = i - len + 1; j <= i; j++) {
    sum += Math.max(
      high[j] - low[j],
      Math.abs(high[j] - close[j - 1]),
      Math.abs(low[j] - close[j - 1])
    );
  }
  return sum / len;
}

function calculateTriangle(klines, length = TRIANGLE_LENGTH, mult = TRIANGLE_MULT) {
  let upper = null;
  let lower = null;
  let slopePH = 0;
  let slopePL = 0;

  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const closes = klines.map(k => k.close);

  for (let i = 0; i < klines.length; i++) {
    const ph = pivotHigh(highs, length, i);
    const pl = pivotLow(lows, length, i);
    const atrVal = atr(highs, lows, closes, length, i);
    const slope = atrVal ? (atrVal / length) * mult : 0;

    if (ph !== null) slopePH = slope;
    if (pl !== null) slopePL = slope;

    upper = ph !== null ? ph : upper !== null ? upper - slopePH : null;
    lower = pl !== null ? pl : lower !== null ? lower + slopePL : null;
  }

  return { upper, lower };
}

/* ───────── COMPRESSIONE ───────── */
function hasCompression(klines) {
  if (klines.length < 20) return false;

  const first = klines.slice(0, Math.floor(klines.length / 2));
  const last = klines.slice(Math.floor(klines.length / 2));

  const firstRange = Math.max(...first.map(k => k.high)) - Math.min(...first.map(k => k.low));
  const lastRange = Math.max(...last.map(k => k.high)) - Math.min(...last.map(k => k.low));

  // meno rigido di prima (3% basta)
  return lastRange < firstRange * 0.97;
}

/* ───────── BREAKOUT ───────── */
function triangleBreakoutClosed(prevClose, lastClose, triangle, bufferPct = BREAKOUT_BUFFER) {
  if (triangle.upper == null || triangle.lower == null) return null;

  const upperBreak = triangle.upper * (1 + bufferPct);
  const lowerBreak = triangle.lower * (1 - bufferPct);

  if (prevClose <= triangle.upper && lastClose > upperBreak) return 'long';
  if (prevClose >= triangle.lower && lastClose < lowerBreak) return 'short';

  return null;
}

function triangleBreakoutLive(currentPrice, triangle, bufferPct = LIVE_BREAKOUT_BUFFER) {
  if (triangle.upper == null || triangle.lower == null || currentPrice == null || isNaN(currentPrice)) return null;

  const upperBreak = triangle.upper * (1 + bufferPct);
  const lowerBreak = triangle.lower * (1 - bufferPct);

  if (currentPrice > upperBreak) return 'long';
  if (currentPrice < lowerBreak) return 'short';

  return null;
}

/* ───────── TELEGRAM ───────── */
async function sendTelegram(msg) {
  for (let i = 0; i < TELEGRAM_TOKENS.length; i++) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKENS[i]}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_IDS[i],
          text: msg,
          parse_mode: 'Markdown'
        },
        { timeout: 10000 }
      );
    } catch (err) {
      console.error(`${now()} ❌ Telegram error [${i}]`, err.response?.data || err.message);
    }
  }
}

/* ───────── BYBIT ───────── */
async function fetchKlines(symbol, interval, limit = FETCH_LIMIT) {
  try {
    const r = await axios.get('https://api.bybit.com/v5/market/kline', {
      params: {
        category: 'spot',
        symbol,
        interval: intervalMap[interval],
        limit
      },
      timeout: 10000
    });

    const list = r?.data?.result?.list || [];

    return list.reverse().map(k => ({
      time: +k[0],
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4]
    }));
  } catch (err) {
    console.error(`${now()} ❌ Bybit Klines ${symbol}[${interval}]`, err.response?.data || err.message);
    return [];
  }
}

async function fetchCurrentPrice(symbol) {
  try {
    const r = await axios.get('https://api.bybit.com/v5/market/tickers', {
      params: { category: 'spot', symbol },
      timeout: 10000
    });

    return +(r?.data?.result?.list?.[0]?.lastPrice || NaN);
  } catch (err) {
    console.error(`${now()} ❌ Bybit Ticker ${symbol}`, err.response?.data || err.message);
    return null;
  }
}

/* ───────── MESSAGE BUILDERS ───────── */
function buildMessage({
  symbol,
  interval,
  direction,
  entryPrice,
  breakoutPrice,
  triangle,
  box,
  ema12,
  ema50,
  ema200,
  bbMid,
  emaBbCross,
  tp,
  sl,
  mode = 'CONFIRMED'
}) {
  const emoji = coinEmojis[symbol] || '🔸';

  return `
${emoji} *${mode === 'LIVE' ? 'TRIANGLE BREAKOUT LIVE' : 'TRIANGLE BREAKOUT CONFIRMED'}*
*${symbol}* [${interval}]

${direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} @ $${formatPrice(entryPrice)}

📌 Breakout Price: $${formatPrice(breakoutPrice)}
📐 Triangle
• Upper: $${formatPrice(triangle.upper)}
• Lower: $${formatPrice(triangle.lower)}

📦 Range Box (20)
• High: $${formatPrice(box.high)}
• Low:  $${formatPrice(box.low)}

📈 EMA
• EMA12:  $${formatPrice(ema12)} (${emaBbCross})
• EMA50:  $${formatPrice(ema50)}
• EMA200: $${formatPrice(ema200)}

📊 BB
• Middle: $${formatPrice(bbMid)}

🎯 TP: $${formatPrice(tp)}
🛑 SL: $${formatPrice(sl)}
`.trim();
}

/* ───────── ANALYSIS ───────── */
async function analyze(symbol, interval) {
  const raw = await fetchKlines(symbol, interval, FETCH_LIMIT);
  if (raw.length < 220) {
    console.log(`${now()} ⚠️ ${symbol}[${interval}] dati insufficienti (${raw.length})`);
    return;
  }

  const currentPrice = await fetchCurrentPrice(symbol);
  const s = state[symbol][interval];

  // Ultima candela live
  const liveBar = raw.at(-1);

  // SOLO candele chiuse
  const closed = raw.slice(0, -1);
  if (closed.length < PATTERN_WINDOW) return;

  const klines = closed.slice(-PATTERN_WINDOW);
  if (klines.length < PATTERN_WINDOW) return;

  const lastClosedBarTime = klines.at(-1).time;
  const closes = klines.map(k => k.close);
  const prevClose = closes.at(-2);
  const lastClose = closes.at(-1);

  // EMA / BB su finestra ampia chiusa
  const closedCloses = closed.map(k => k.close);

  const ema12Arr = EMA.calculate({ period: 12, values: closedCloses });
  const ema50Arr = EMA.calculate({ period: 50, values: closedCloses });
  const ema200Arr = EMA.calculate({ period: 200, values: closedCloses });

  if (ema12Arr.length < 2 || ema50Arr.length < 1 || ema200Arr.length < 1) {
    console.log(`${now()} ⚠️ ${symbol}[${interval}] EMA insufficienti`);
    return;
  }

  const prevEma12 = ema12Arr.at(-2);
  const ema12 = ema12Arr.at(-1);
  const ema50 = ema50Arr.at(-1);
  const ema200 = ema200Arr.at(-1);

  const bbArr = BollingerBands.calculate({ period: 20, values: closedCloses, stdDev: 2 });
  if (bbArr.length < 2) {
    console.log(`${now()} ⚠️ ${symbol}[${interval}] BB insufficienti`);
    return;
  }

  const prevBbMid = bbArr.at(-2).middle;
  const bbMid = bbArr.at(-1).middle;

  let emaBbCross = '❌';
  if (prevEma12 < prevBbMid && ema12 > bbMid) emaBbCross = '🟢 LONG';
  if (prevEma12 > prevBbMid && ema12 < bbMid) emaBbCross = '🔴 SHORT';

  // Triangolo
  const triangle = calculateTriangle(klines, TRIANGLE_LENGTH, TRIANGLE_MULT);
  if (triangle.upper == null || triangle.lower == null) {
    console.log(`${now()} 🚫 ${symbol}[${interval}] no triangle`);
    return;
  }

  // Compressione
  const compressed = hasCompression(klines);
  if (!compressed) {
    console.log(`${now()} 🚫 ${symbol}[${interval}] no compression`);
    return;
  }

  /* ───────── PRE-ALERT LIVE ───────── */
  if (SEND_LIVE_PREALERT && currentPrice != null && !isNaN(currentPrice)) {
    const liveDirection = triangleBreakoutLive(currentPrice, triangle, LIVE_BREAKOUT_BUFFER);

    if (liveDirection) {
      if (
        (!USE_TREND_FILTER) ||
        (liveDirection === 'long' && ema50 >= ema200) ||
        (liveDirection === 'short' && ema50 <= ema200)
      ) {
        if (
          (!REQUIRE_EMA12_BB_CONFIRM) ||
          (liveDirection === 'long' && ema12 > bbMid) ||
          (liveDirection === 'short' && ema12 < bbMid)
        ) {
          const liveBarTime = liveBar?.time || Date.now();
          const liveAlertKey = `${symbol}-${interval}-${liveBarTime}-${liveDirection}-LIVE`;

          if (s.lastLiveAlertKey !== liveAlertKey) {
            const box = getRangeBox(klines, 20);
            const size = box.size || lastClose * 0.01;

            const entryPrice = currentPrice;
            const tp = liveDirection === 'long' ? entryPrice + size : entryPrice - size;
            const sl = liveDirection === 'long' ? entryPrice - size * 0.5 : entryPrice + size * 0.5;

            const msg = buildMessage({
              symbol,
              interval,
              direction: liveDirection,
              entryPrice,
              breakoutPrice: currentPrice,
              triangle,
              box,
              ema12,
              ema50,
              ema200,
              bbMid,
              emaBbCross,
              tp,
              sl,
              mode: 'LIVE'
            });

            console.log(
              `${now()} ⚡ LIVE ${symbol}[${interval}] ${liveDirection.toUpperCase()} ` +
              `price=${formatPrice(currentPrice)} upper=${formatPrice(triangle.upper)} lower=${formatPrice(triangle.lower)}`
            );

            s.lastLiveAlertKey = liveAlertKey;
            await sendTelegram(msg);
          }
        }
      }
    }
  }

  /* ───────── ALERT CONFERMATO SU CHIUSURA ───────── */
  // Analizza la candela chiusa UNA sola volta
  if (s.lastClosedBarTime === lastClosedBarTime) {
    return;
  }

  const direction = triangleBreakoutClosed(prevClose, lastClose, triangle, BREAKOUT_BUFFER);

  console.log(
    `${now()} ${symbol}[${interval}] ` +
    `prevClose=${formatPrice(prevClose)} lastClose=${formatPrice(lastClose)} ` +
    `upper=${formatPrice(triangle.upper)} lower=${formatPrice(triangle.lower)} ` +
    `upperBreak=${formatPrice(triangle.upper * (1 + BREAKOUT_BUFFER))} ` +
    `lowerBreak=${formatPrice(triangle.lower * (1 - BREAKOUT_BUFFER))} ` +
    `compressed=${compressed} direction=${direction || 'none'} ` +
    `ema50=${formatPrice(ema50)} ema200=${formatPrice(ema200)}`
  );

  if (!direction) {
    s.lastSignal = null;
    s.lastClosedBarTime = lastClosedBarTime;
    return;
  }

  // Trend filter opzionale
  if (USE_TREND_FILTER) {
    if (direction === 'long' && ema50 < ema200) {
      console.log(`${now()} 🚫 ${symbol}[${interval}] LONG bloccato da trend filter`);
      s.lastClosedBarTime = lastClosedBarTime;
      return;
    }
    if (direction === 'short' && ema50 > ema200) {
      console.log(`${now()} 🚫 ${symbol}[${interval}] SHORT bloccato da trend filter`);
      s.lastClosedBarTime = lastClosedBarTime;
      return;
    }
  }

  // Conferma EMA12 vs BB opzionale
  if (REQUIRE_EMA12_BB_CONFIRM) {
    if (direction === 'long' && ema12 <= bbMid) {
      console.log(`${now()} 🚫 ${symbol}[${interval}] LONG bloccato da EMA12/BB`);
      s.lastClosedBarTime = lastClosedBarTime;
      return;
    }
    if (direction === 'short' && ema12 >= bbMid) {
      console.log(`${now()} 🚫 ${symbol}[${interval}] SHORT bloccato da EMA12/BB`);
      s.lastClosedBarTime = lastClosedBarTime;
      return;
    }
  }

  const alertKey = `${symbol}-${interval}-${lastClosedBarTime}-${direction}-CONFIRMED`;

  if (s.lastConfirmedAlertKey === alertKey) {
    s.lastClosedBarTime = lastClosedBarTime;
    return;
  }

  if (s.lastSignal === direction) {
    s.lastClosedBarTime = lastClosedBarTime;
    return;
  }

  s.lastSignal = direction;
  s.lastConfirmedAlertKey = alertKey;
  s.lastClosedBarTime = lastClosedBarTime;

  if (!SEND_CONFIRMED_ALERT) return;

  const box = getRangeBox(klines, 20);
  const size = box.size || lastClose * 0.01;

  const entryPrice = currentPrice ?? lastClose;

  const tp = direction === 'long'
    ? entryPrice + size
    : entryPrice - size;

  const sl = direction === 'long'
    ? entryPrice - size * 0.5
    : entryPrice + size * 0.5;

  const msg = buildMessage({
    symbol,
    interval,
    direction,
    entryPrice,
    breakoutPrice: lastClose,
    triangle,
    box,
    ema12,
    ema50,
    ema200,
    bbMid,
    emaBbCross,
    tp,
    sl,
    mode: 'CONFIRMED'
  });

  console.log(
    `${now()} 🔺 CONFIRMED ${symbol}[${interval}] ${direction.toUpperCase()} | ` +
    `close=${formatPrice(lastClose)} upper=${formatPrice(triangle.upper)} lower=${formatPrice(triangle.lower)}`
  );

  await sendTelegram(msg);
}

/* ───────── LOOP ───────── */
async function checkMarket() {
  if (isChecking) {
    console.log(`${now()} ⏳ Scan già in corso, skip.`);
    return;
  }

  isChecking = true;

  try {
    for (const c of coins) {
      for (const tf of intervals) {
        try {
          await analyze(c, tf);
        } catch (err) {
          console.error(`${now()} ❌ Analyze error ${c}[${tf}]`, err.response?.data || err.message);
        }

        await sleep(REQUEST_DELAY_MS);
      }
    }
  } finally {
    isChecking = false;
  }
}

/* ───────── SERVER ───────── */
app.get('/', (_, res) => res.send('✅ Triangle Breakout bot ATTIVO'));

app.listen(PORT, () => {
  console.log(`🚀 Server avviato su porta ${PORT}`);
  console.log(`🕒 Timeframes attivi: ${intervals.join(', ')}`);
  console.log(`📡 LIVE pre-alert: ${SEND_LIVE_PREALERT ? 'ON' : 'OFF'}`);
  console.log(`✅ Confirmed alert: ${SEND_CONFIRMED_ALERT ? 'ON' : 'OFF'}`);
  console.log(`📈 Trend filter EMA50/EMA200: ${USE_TREND_FILTER ? 'ON' : 'OFF'}`);

  checkMarket(); // prima scansione immediata
  setInterval(checkMarket, LOOP_EVERY_MS);
});