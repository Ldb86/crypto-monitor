require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { EMA, MACD, BollingerBands } = require('technicalindicators');

/* ───────── CONFIG ───────── */
const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKENS = process.env.BOT_TOKENS.split(',');
const TELEGRAM_CHAT_IDS = process.env.CHAT_IDS.split(',');

const coins = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',
  'DOGEUSDT','LINKUSDT','AVAXUSDT','DOTUSDT','ATOMUSDT'
];

const intervals = ['15m','30m','1h','4h','1d'];

const intervalMap = {
  '15m':'15','30m':'30','1h':'60','4h':'240','1d':'D'
};

const coinEmojis = {
  BTCUSDT:'🟠', ETHUSDT:'⚫', SOLUSDT:'🌞', BNBUSDT:'🌈',
  XRPUSDT:'🔵', DOGEUSDT:'🐶', LINKUSDT:'⚡️',
  AVAXUSDT:'🔥', DOTUSDT:'⚪', ATOMUSDT:'🌌'
};

/* ───────── STATE ───────── */
const state = {};
coins.forEach(c => {
  state[c] = {};
  intervals.forEach(tf => {
    state[c][tf] = {
      breakoutDone: false,
      lastDirection: null
    };
  });
});

/* ───────── HELPERS ───────── */
const now = () => `[${new Date().toLocaleTimeString()}]`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const formatPrice = p => {
  if (!p || isNaN(p)) return 'N/A';
  if (p < 0.01) return p.toFixed(8);
  if (p < 1) return p.toFixed(4);
  return p.toFixed(2);
};

function getRangeBox(klines, lookback = 20) {
  const slice = klines.slice(-(lookback + 1), -1);
  const highs = slice.map(k => k.high);
  const lows = slice.map(k => k.low);
  return {
    high: Math.max(...highs),
    low: Math.min(...lows),
    size: Math.max(...highs) - Math.min(...lows)
  };
}

/* ───────── TELEGRAM ───────── */
async function sendTelegram(msg, symbol, interval) {
  for (let i = 0; i < TELEGRAM_TOKENS.length; i++) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKENS[i]}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_IDS[i],
          text: msg,
          parse_mode: 'Markdown'
        }
      );
      console.log(`${now()} 📬 Telegram ${symbol}[${interval}] bot ${i+1}`);
    } catch (err) {
      console.error(`${now()} ❌ Telegram error`, err.message);
    }
  }
}

/* ───────── BYBIT ───────── */
async function fetchKlines(symbol, interval, limit = 300) {
  try {
    const res = await axios.get(
      'https://api.bybit.com/v5/market/kline',
      {
        params: {
          category: 'spot',
          symbol,
          interval: intervalMap[interval],
          limit
        },
        timeout: 20000
      }
    );

    return res.data.result.list.reverse().map(k => ({
      time: +k[0],
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4],
      volume: +k[5]
    }));
  } catch (e) {
    console.error(`${now()} ❌ fetchKlines ${symbol}[${interval}]`);
    return [];
  }
}

/* ───────── ANALYSIS ───────── */
async function analyze(symbol, interval) {
  const klines = await fetchKlines(symbol, interval);
  if (klines.length < 60) return;

  const prices = klines.map(k => k.close);
  const lastPrice = prices.at(-1);

  /* EMA */
  const ema12Arr = EMA.calculate({ period: 12, values: prices });
  const ema50Arr = EMA.calculate({ period: 50, values: prices });
  const ema200Arr = EMA.calculate({ period: 200, values: prices });

  if (ema12Arr.length < 2) return;

  const ema12 = ema12Arr.at(-1);
  const prevEma12 = ema12Arr.at(-2);

  /* Bollinger */
  const bbArr = BollingerBands.calculate({
    period: 20,
    values: prices,
    stdDev: 2
  });
  if (bbArr.length < 2) return;

  const bbMid = bbArr.at(-1).middle;
  const prevBbMid = bbArr.at(-2).middle;

  /* EMA12 x BB mid cross */
  const emaBbCross =
    prevEma12 < prevBbMid && ema12 > bbMid ? 'bullish' :
    prevEma12 > prevBbMid && ema12 < bbMid ? 'bearish' :
    null;

  /* Range Box */
  const box = getRangeBox(klines);
  const breakout =
    lastPrice > box.high ? 'up' :
    lastPrice < box.low ? 'down' : null;

  const s = state[symbol][interval];

  /* reset se rientra */
  if (lastPrice <= box.high && lastPrice >= box.low) {
    s.breakoutDone = false;
  }

  /* SIGNAL */
  if (
    breakout &&
    emaBbCross &&
    !s.breakoutDone &&
    (
      (breakout === 'up' && emaBbCross === 'bullish') ||
      (breakout === 'down' && emaBbCross === 'bearish')
    )
  ) {
    const direction = breakout === 'up' ? 'long' : 'short';
    s.breakoutDone = true;
    s.lastDirection = direction;

    console.log(`${now()} 🚀 ${symbol}[${interval}] ${direction.toUpperCase()}`);

    await sendSignal(
      symbol, interval, direction,
      lastPrice, box, ema12,
      ema50Arr.at(-1), ema200Arr.at(-1), bbMid
    );
  }
}

/* ───────── MESSAGE ───────── */
async function sendSignal(
  symbol, interval, direction,
  price, box, ema12, ema50, ema200, bbMid
) {
  const emoji = coinEmojis[symbol] || '🔸';
  const boxSize = box.size || price * 0.01;

  const tp = direction === 'long'
    ? price + boxSize
    : price - boxSize;

  const sl = direction === 'long'
    ? price - boxSize * 0.5
    : price + boxSize * 0.5;

  const msg = `
${emoji} *BREAKOUT + EMA12 x BB*
*${symbol}* [${interval}]

${direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} @ $${formatPrice(price)}

📦 Range Box
• High: $${formatPrice(box.high)}
• Low:  $${formatPrice(box.low)}

📈 EMA
• EMA12:  $${formatPrice(ema12)}
• EMA50:  $${formatPrice(ema50)}
• EMA200: $${formatPrice(ema200)}

📊 BB Middle: $${formatPrice(bbMid)}

🎯 TP: $${formatPrice(tp)}
🛑 SL: $${formatPrice(sl)}

`.trim();

  await sendTelegram(msg, symbol, interval);require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { EMA, MACD, SMA } = require('technicalindicators');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.BOT_TOKENS.split(',');
const TELEGRAM_CHAT_ID = process.env.CHAT_IDS.split(',');

const coins = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','UNIUSDT','XRPUSDT',
  'LTCUSDT','AAVEUSDT','SUIUSDT','ENAUSDT','ONDOUSDT',
  'DOGEUSDT','PEPEUSDT','DOTUSDT','ATOMUSDT','HBARUSDT',
  'TIAUSDT','SHIBUSDT'
];

const coinEmojis = {
  BTCUSDT:'🟠', ETHUSDT:'⚫', SOLUSDT:'🟢', BNBUSDT:'🟡', UNIUSDT:'🟣',
  XRPUSDT:'🔵', LTCUSDT:'⚪', AAVEUSDT:'🔷', SUIUSDT:'🔹', ENAUSDT:'🟪',
  ONDOUSDT:'🟤', DOGEUSDT:'🐶', DOTUSDT:'⚪', ATOMUSDT:'🌌',
  HBARUSDT:'🔴', TIAUSDT:'🟡', SHIBUSDT:'🐕', PEPEUSDT:'🐸', ICPUSDT: '🌪', BCHUSDT:'⭐️', LINKUSDT:'⚡️', 
  AVAXUSDT:'🔥', TONUSDT:'🌦'
};

const intervals = ['5m','15m','30m','1h','2h','4h', 
  '6h','12h','1d','1w'];
const intervalMap = {
  '5m':'5','15m':'15','30m':'30','1h':'60','2h':'120',
  '4h':'240','6h':'360','12h':'720','1d':'D','1w':'W'
};

const lastSignals = {};
coins.forEach(c => {
  lastSignals[c] = {};
  intervals.forEach(tf => {
    lastSignals[c][tf] = { macd: null, notified: false };
  });
});

app.get('/', (_, res) => res.send('✅ MACD + BB + Breakout Bot attivo'));
app.listen(PORT, () => console.log(`🚀 Server su porta ${PORT}`));

// ───────── TELEGRAM ─────────
async function sendTelegramMessage(msg) {
  for (let i = 0; i < TELEGRAM_TOKEN.length; i++) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN[i].trim()}/sendMessage`,
        { chat_id: TELEGRAM_CHAT_ID[i].trim(), text: msg, parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.error('Telegram error:', e.message);
    }
  }
}

// ───────── BYBIT DATA ─────────
async function fetchKlines(symbol, interval, limit = 300) {
  try {
    const res = await axios.get('https://api.bybit.com/v5/market/kline', {
      params: { category:'spot', symbol, interval: intervalMap[interval], limit }
    });
    return res.data.result.list.reverse().map(k => ({
      open:+k[1], high:+k[2], low:+k[3], close:+k[4]
    }));
  } catch {
    return [];
  }
}

// ───────── HELPERS ─────────
function formatPrice(p) {
  if (!p || isNaN(p)) return 'N/A';
  if (p < 0.01) return p.toFixed(8);
  if (p < 1) return p.toFixed(4);
  return p.toFixed(2);
}

function getRangeBox(klines, lookback = 20) {
  const slice = klines.slice(-(lookback + 1), -1);
  const highs = slice.map(k => k.high);
  const lows = slice.map(k => k.low);
  return {
    high: Math.max(...highs),
    low: Math.min(...lows),
    size: Math.max(...highs) - Math.min(...lows)
  };
}

// ───────── ANALISI ─────────
async function analyze(symbol, interval) {
  const klines = await fetchKlines(symbol, interval);
  if (klines.length < 60) return;

  const prices = klines.map(k => k.close);

  const ema12Arr = EMA.calculate({ period:12, values:prices });
  const ema26Arr = EMA.calculate({ period:26, values:prices });
  const ema50 = EMA.calculate({ period:50, values:prices }).at(-1);
  const ema200 = EMA.calculate({ period:200, values:prices }).at(-1);

  const ema12 = ema12Arr.at(-1);
  const ema26 = ema26Arr.at(-1);
  const prevEma12 = ema12Arr.at(-2);
  const prevEma26 = ema26Arr.at(-2);

  const bbArr = SMA.calculate({ period:20, values:prices });
  const bbMiddle = bbArr.at(-1);
  const prevBbMiddle = bbArr.at(-2);

  const bbEmaCross =
    prevBbMiddle < prevEma12 && prevBbMiddle < prevEma26 &&
    bbMiddle > ema12 && bbMiddle > ema26 ? 'bullish' :
    prevBbMiddle > prevEma12 && prevBbMiddle > prevEma26 &&
    bbMiddle < ema12 && bbMiddle < ema26 ? 'bearish' : null;

  const macdArr = MACD.calculate({
    values:prices, fastPeriod:26, slowPeriod:50, signalPeriod:9
  });

  const last = macdArr.at(-1);
  const prev = macdArr.at(-2);

  const macdCross =
    prev.MACD < prev.signal && last.MACD > last.signal ? 'bullish' :
    prev.MACD > prev.signal && last.MACD < last.signal ? 'bearish' : null;

  const lastPrice = prices.at(-1);
  const box = getRangeBox(klines);

  const breakout =
    lastPrice > box.high ? 'up' :
    lastPrice < box.low ? 'down' : null;

  const state = lastSignals[symbol][interval];

  if (macdCross && macdCross === bbEmaCross) {
    state.macd = macdCross;
    state.notified = false;
  }

  if (state.macd && !state.notified) {
    if (
      bbEmaCross === state.macd &&
      ((state.macd === 'bullish' && breakout === 'up') ||
       (state.macd === 'bearish' && breakout === 'down'))
    ) {
      await sendSignal(symbol, interval, lastPrice, box, state.macd,
        ema12, ema26, ema50, ema200, bbMiddle);
      state.notified = true;
    }
  }
}

// ───────── INVIO SEGNALE ─────────
async function sendSignal(symbol, interval, price, box, macd,
  ema12, ema26, ema50, ema200, bbMiddle) {

  const dir = macd === 'bullish' ? 'LONG' : 'SHORT';
  const emoji = coinEmojis[symbol] || '🔸';

  const msg = `
${emoji} *${symbol}* [${interval}]
${dir === 'LONG' ? '🟢 LONG' : '🔴 SHORT'} @ $${formatPrice(price)}

📦 Box:
High: $${formatPrice(box.high)}
Low:  $${formatPrice(box.low)}

📊 EMA:
12: $${formatPrice(ema12)}
26: $${formatPrice(ema26)}
50: $${formatPrice(ema50)}
200:$${formatPrice(ema200)}

📈 Bollinger:
Middle (20): $${formatPrice(bbMiddle)}

⚡ MACD + BB + BREAKOUT
`.trim();

  await sendTelegramMessage(msg);
}

// ───────── LOOP ─────────
async function checkMarket() {
  for (const c of coins) {
    for (const tf of intervals) {
      await analyze(c, tf);
      await new Promise(r => setTimeout(r, 350));
    }
  }
}

setInterval(checkMarket, 60 * 1000);

}

/* ───────── LOOP ───────── */
async function marketLoop() {
  for (const c of coins) {
    for (const tf of intervals) {
      await analyze(c, tf);
      await sleep(400);
    }
  }
}

setInterval(marketLoop, 60 * 1000);

/* ───────── SERVER ───────── */
app.get('/', (_, res) => res.send('✅ Breakout + EMA12 x BB bot ATTIVO'));
app.listen(PORT, () =>
  console.log(`🚀 Server avviato su porta ${PORT}`)
);
