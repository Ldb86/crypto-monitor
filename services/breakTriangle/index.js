require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { EMA, BollingerBands } = require("technicalindicators");

/* ───────── CONFIG ───────── */
const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.BOT_TOKENS || !process.env.CHAT_IDS) {
  throw new Error("❌ BOT_TOKENS o CHAT_IDS mancanti nel file .env");
}

const TELEGRAM_TOKENS = process.env.BOT_TOKENS.split(",").map((s) => s.trim());
const TELEGRAM_CHAT_IDS = process.env.CHAT_IDS.split(",").map((s) => s.trim());

if (TELEGRAM_TOKENS.length !== TELEGRAM_CHAT_IDS.length) {
  throw new Error(
    "❌ BOT_TOKENS e CHAT_IDS devono avere lo stesso numero di elementi",
  );
}

/* ───────── COINS ───────── */
const coins = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "UNIUSDT",
  "XRPUSDT",
  "LTCUSDT",
  "AAVEUSDT",
  "SUIUSDT",
  "ENAUSDT",
  "ONDOUSDT",
  "DOGEUSDT",
  "PEPEUSDT",
  "DOTUSDT",
  "ATOMUSDT",
  "HBARUSDT",
  "TIAUSDT",
  "SHIBUSDT",
  "ICPUSDT",
  "BCHUSDT",
  "LINKUSDT",
  "AVAXUSDT",
  "TONUSDT",
];

const coinEmojis = {
  BTCUSDT: "🟠",
  ETHUSDT: "⚫",
  SOLUSDT: "🌞",
  BNBUSDT: "🌈",
  UNIUSDT: "🟣",
  XRPUSDT: "🔵",
  LTCUSDT: "⚪",
  AAVEUSDT: "🔷",
  SUIUSDT: "🔹",
  ENAUSDT: "🟪",
  ONDOUSDT: "🟤",
  DOGEUSDT: "🐶",
  DOTUSDT: "⚪",
  ATOMUSDT: "🌌",
  HBARUSDT: "🚀",
  TIAUSDT: "🟡",
  SHIBUSDT: "🐕",
  PEPEUSDT: "🐸",
  ICPUSDT: "🌪",
  BCHUSDT: "⭐️",
  LINKUSDT: "⚡️",
  AVAXUSDT: "🔥",
  TONUSDT: "🌦",
};

/* ───────── TIMEFRAMES ───────── */
const intervals = ["30m"];

const intervalMap = {
  "30m": "30",
  "2h": "120",
  "4h": "240",
  "6h": "360",
  "12h": "720",
  "1d": "D",
  "1w": "W",
};

/* ───────── PARAMETRI ───────── */
const FETCH_LIMIT = 260;

const PATTERN_WINDOW = 25;

/* TRIANGOLO PIÙ STABILE */
const TRIANGLE_LENGTH = 8;
const TRIANGLE_MULT = 1;

/* BREAKOUT DINAMICO */
const ATR_PERIOD = 14;
const ATR_MULTIPLIER = 0.25;

/* LOOP */
const LOOP_EVERY_MS = 60 * 1000;
const REQUEST_DELAY_MS = 250;

/* FILTRI */
const USE_TREND_FILTER = false;
const REQUIRE_EMA12_BB_CONFIRM = false;

/* FILTRI ANTI FAKE BREAKOUT */
const REQUIRE_VOLUME_CONFIRM = true;
const VOLUME_MULTIPLIER = 1.5;
const MIN_CANDLE_STRENGTH = 0.6;
const MAX_CANDLE_SIZE = 0.04;
/* ALERT */
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
      lastSignal: null,
    };
  }
}

let isChecking = false;

/* ───────── HELPERS ───────── */
const now = () => `[${new Date().toLocaleTimeString()}]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function formatPrice(p) {
  if (p == null || isNaN(p)) return "N/A";
  if (p < 0.0001) return p.toFixed(10);
  if (p < 0.01) return p.toFixed(8);
  if (p < 1) return p.toFixed(4);

  return p.toFixed(2);
}

function getRangeBox(klines, lookback = 20) {
  const slice = klines.slice(-lookback);
  const highs = slice.map((k) => k.high);
  const lows = slice.map((k) => k.low);
  const high = Math.max(...highs);
  const low = Math.min(...lows);
  return {
    high,
    low,
    size: high - low,
  };
}

/* ───────── CANDLE FILTERS ───────── */
function candleStrength(candle) {
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  if (range === 0) return 0;
  return body / range;
}

function candleSize(candle) {
  return (candle.high - candle.low) / candle.close;
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
      Math.abs(low[j] - close[j - 1]),
    );
  }

  return sum / len;
}

function calculateTriangle(
  klines,
  length = TRIANGLE_LENGTH,
  mult = TRIANGLE_MULT,
) {
  let upper = null;
  let lower = null;

  let slopePH = 0;
  let slopePL = 0;

  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  const closes = klines.map((k) => k.close);
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
  const firstRange =
    Math.max(...first.map((k) => k.high)) -
    Math.min(...first.map((k) => k.low));
  const lastRange =
    Math.max(...last.map((k) => k.high)) - Math.min(...last.map((k) => k.low));
  return lastRange < firstRange * 0.75;
}

/* ───────── BREAKOUT ───────── */
function triangleBreakoutClosed(prevClose, lastClose, triangle, atrValue) {
  if (triangle.upper == null || triangle.lower == null) {
    return null;
  }

  const dynamicBuffer = atrValue * ATR_MULTIPLIER;
  const upperBreak = triangle.upper + dynamicBuffer;
  const lowerBreak = triangle.lower - dynamicBuffer;
  if (prevClose <= triangle.upper && lastClose > upperBreak) {
    return "long";
  }
  if (prevClose >= triangle.lower && lastClose < lowerBreak) {
    return "short";
  }
  return null;
}

function triangleBreakoutLive(currentPrice, triangle, atrValue) {
  if (triangle.upper == null || triangle.lower == null) {
    return null;
  }

  const dynamicBuffer = atrValue * ATR_MULTIPLIER;
  const upperBreak = triangle.upper + dynamicBuffer;
  const lowerBreak = triangle.lower - dynamicBuffer;
  if (currentPrice > upperBreak) {
    return "long";
  }
  if (currentPrice < lowerBreak) {
    return "short";
  }
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
          parse_mode: "Markdown",
        },
        {
          timeout: 10000,
        },
      );
    } catch (err) {
      console.error(
        `${now()} ❌ Telegram error`,
        err.response?.data || err.message,
      );
    }
  }
}

/* ───────── BYBIT ───────── */
async function fetchKlines(symbol, interval, limit = FETCH_LIMIT) {
  try {
    const r = await axios.get("https://api.bybit.com/v5/market/kline", {
      params: {
        category: "spot",
        symbol,
        interval: intervalMap[interval],
        limit,
      },
      timeout: 10000,
    });

    const list = r?.data?.result?.list || [];

    return list.reverse().map((k) => ({
      time: +k[0],
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4],
      volume: +k[5],
    }));
  } catch (err) {
    console.error(
      `${now()} ❌ Bybit Klines`,
      err.response?.data || err.message,
    );

    return [];
  }
}

async function fetchCurrentPrice(symbol) {
  try {
    const r = await axios.get("https://api.bybit.com/v5/market/tickers", {
      params: {
        category: "spot",
        symbol,
      },
      timeout: 10000,
    });

    return +(r?.data?.result?.list?.[0]?.lastPrice || NaN);
  } catch (err) {
    console.error(
      `${now()} ❌ Bybit Ticker`,
      err.response?.data || err.message,
    );

    return null;
  }
}

/* ───────── MESSAGE ───────── */
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
  tp,
  sl,
  mode = "LIVE",
}) {
  const emoji = coinEmojis[symbol] || "🔸";

  return `
${emoji} *TRIANGLE BREAKOUT ${mode}*

*${symbol}* [${interval}]

${direction === "long" ? "🟢 LONG" : "🔴 SHORT"} @ $${formatPrice(entryPrice)}

📌 Breakout:
$${formatPrice(breakoutPrice)}

📐 Triangle
• Upper: $${formatPrice(triangle.upper)}
• Lower: $${formatPrice(triangle.lower)}

📦 Range
• High: $${formatPrice(box.high)}
• Low: $${formatPrice(box.low)}

📈 EMA
• EMA12: $${formatPrice(ema12)}
• EMA50: $${formatPrice(ema50)}
• EMA200: $${formatPrice(ema200)}

📊 BB Mid:
$${formatPrice(bbMid)}

🎯 TP:
$${formatPrice(tp)}

🛑 SL:
$${formatPrice(sl)}
`.trim();
}

/* ───────── ANALYSIS ───────── */
async function analyze(symbol, interval) {
  const raw = await fetchKlines(symbol, interval, FETCH_LIMIT);
  if (raw.length < 220) return;
  const currentPrice = await fetchCurrentPrice(symbol);
  const s = state[symbol][interval];
  const liveBar = raw.at(-1);
  const closed = raw.slice(0, -1);
  if (closed.length < PATTERN_WINDOW) {
    return;
  }

  const klines = closed.slice(-PATTERN_WINDOW);
  const closes = closed.map((k) => k.close);
  const highs = closed.map((k) => k.high);
  const lows = closed.map((k) => k.low);
  const volumes = closed.map((k) => k.volume);
  const prevClose = closes.at(-2);
  const lastClose = closes.at(-1);
  const lastClosedBarTime = klines.at(-1).time;
  const lastCandle = klines.at(-1);

  /* ───────── EMA ───────── */
  const ema12 = EMA.calculate({
    period: 12,
    values: closes,
  }).at(-1);

  const ema50 = EMA.calculate({
    period: 50,
    values: closes,
  }).at(-1);

  const ema200 = EMA.calculate({
    period: 200,
    values: closes,
  }).at(-1);

  /* ───────── BB ───────── */
  const bb = BollingerBands.calculate({
    period: 20,
    values: closes,
    stdDev: 2,
  }).at(-1);

  const bbMid = bb.middle;

  /* ───────── TRIANGLE ───────── */
  const triangle = calculateTriangle(klines);

  if (triangle.upper == null || triangle.lower == null) {
    return;
  }

  /* ───────── ATR ───────── */
  const atrValue = atr(highs, lows, closes, ATR_PERIOD, closes.length - 1);

  if (!atrValue) return;

  /* ───────── COMPRESSION ───────── */
  if (!hasCompression(klines)) {
    return;
  }

  /* ───────── CANDLE FILTER ───────── */
  const strength = candleStrength(lastCandle);

  if (strength < MIN_CANDLE_STRENGTH) {
    console.log(`${now()} 🚫 Weak candle ${symbol}`);

    return;
  }

  /* ───────── HUGE CANDLE FILTER ───────── */
  const sizePerc = candleSize(lastCandle);

  if (sizePerc > MAX_CANDLE_SIZE) {
    console.log(`${now()} 🚫 Huge candle ${symbol}`);

    return;
  }

  /* ───────── VOLUME FILTER ───────── */
  if (REQUIRE_VOLUME_CONFIRM) {
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;

    const currentVolume = volumes.at(-1);

    if (currentVolume < avgVolume * VOLUME_MULTIPLIER) {
      console.log(`${now()} 🚫 Low volume ${symbol}`);

      return;
    }
  }

  /* ───────── LIVE BREAKOUT ───────── */
  const sendLiveAlert =
    interval === "30m" ? !SEND_CONFIRMED_ALERT : SEND_LIVE_PREALERT;

  if (sendLiveAlert && currentPrice != null) {
    const liveDirection = triangleBreakoutLive(
      currentPrice,
      triangle,
      atrValue,
    );

    if (liveDirection) {
      const liveAlertKey = `${symbol}-${interval}-${liveBar.time}-${liveDirection}`;

      if (s.lastLiveAlertKey !== liveAlertKey) {
        s.lastLiveAlertKey = liveAlertKey;

        const box = getRangeBox(klines);

        const size = box.size || lastClose * 0.01;

        const tp =
          liveDirection === "long" ? currentPrice + size : currentPrice - size;

        const sl =
          liveDirection === "long"
            ? currentPrice - size * 0.5
            : currentPrice + size * 0.5;

        const msg = buildMessage({
          symbol,
          interval,
          direction: liveDirection,
          entryPrice: currentPrice,
          breakoutPrice: currentPrice,
          triangle,
          box,
          ema12,
          ema50,
          ema200,
          bbMid,
          tp,
          sl,
          mode: "LIVE",
        });

        console.log(
          `${now()} ⚡ LIVE ${symbol} ${liveDirection.toUpperCase()}`,
        );

        await sendTelegram(msg);
      }
    }
  }

  /* ───────── CLOSED BREAKOUT ───────── */
  if (s.lastClosedBarTime === lastClosedBarTime) {
    return;
  }

  const direction = triangleBreakoutClosed(
    prevClose,
    lastClose,
    triangle,
    atrValue,
  );

  s.lastClosedBarTime = lastClosedBarTime;

  if (!direction) {
    s.lastSignal = null;
    return;
  }

  /* ───────── TREND FILTER ───────── */
  if (USE_TREND_FILTER) {
    if (direction === "long" && ema50 < ema200) {
      return;
    }

    if (direction === "short" && ema50 > ema200) {
      return;
    }
  }

  /* ───────── EMA BB FILTER ───────── */
  if (REQUIRE_EMA12_BB_CONFIRM) {
    if (direction === "long" && ema12 <= bbMid) {
      return;
    }

    if (direction === "short" && ema12 >= bbMid) {
      return;
    }
  }

  if (s.lastSignal === direction) {
    return;
  }

  s.lastSignal = direction;

  const sendConfirmedAlert =
    interval === "30m" ? SEND_CONFIRMED_ALERT : SEND_CONFIRMED_ALERT;

  if (!sendConfirmedAlert) {
    return;
  }

  const box = getRangeBox(klines);

  const size = box.size || lastClose * 0.01;

  const entryPrice = currentPrice || lastClose;

  const tp = direction === "long" ? entryPrice + size : entryPrice - size;

  const sl =
    direction === "long" ? entryPrice - size * 0.5 : entryPrice + size * 0.5;

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
    tp,
    sl,
    mode: "CONFIRMED",
  });

  console.log(`${now()} ✅ CONFIRMED ${symbol} ${direction.toUpperCase()}`);

  await sendTelegram(msg);
}

/* ───────── LOOP ───────── */
async function checkMarket() {
  if (isChecking) {
    console.log(`${now()} ⏳ Scan già in corso`);

    return;
  }

  isChecking = true;

  try {
    for (const c of coins) {
      for (const tf of intervals) {
        try {
          await analyze(c, tf);
        } catch (err) {
          console.error(
            `${now()} ❌ Analyze error`,
            err.response?.data || err.message,
          );
        }

        await sleep(REQUEST_DELAY_MS);
      }
    }
  } finally {
    isChecking = false;
  }
}

/* ───────── SERVER ───────── */
app.get("/", (_, res) => res.send("✅ Triangle Breakout Bot ATTIVO"));

app.listen(PORT, () => {
  console.log(`🚀 Server avviato su porta ${PORT}`);
  console.log(`📡 Live Alerts: ${SEND_LIVE_PREALERT ? "ON" : "OFF"}`);
  console.log(`✅ Confirmed Alerts: ${SEND_CONFIRMED_ALERT ? "ON" : "OFF"}`);
  console.log(`🧠 Anti Fake Breakout Filters ATTIVI`);
  checkMarket();
  setInterval(checkMarket, LOOP_EVERY_MS);
});
