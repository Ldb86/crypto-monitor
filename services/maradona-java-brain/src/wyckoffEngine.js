// Wyckoff Core Engine 2.0 per Maradona Brain Node.js.
// Obiettivo: leggere fase A/B/C/D/E + eventi principali senza bloccare da solo le entry.

const avg = (a, b) => (a + b) / 2;
const pct = (a, b) => b ? Math.abs(a - b) / Math.abs(b) * 100 : 0;
const highest = (arr) => arr.length ? Math.max(...arr) : null;
const lowest = (arr) => arr.length ? Math.min(...arr) : null;
const sma = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

function rangeSlice(candles, len, offset = 1) {
  const end = Math.max(0, candles.length - offset);
  const start = Math.max(0, end - len);
  return candles.slice(start, end);
}

function detectPivot(candles, i, len) {
  const c = candles[i];
  let isHigh = true;
  let isLow = true;
  for (let j = i - len; j <= i + len; j++) {
    if (j < 0 || j >= candles.length || j === i) continue;
    if (candles[j].high >= c.high) isHigh = false;
    if (candles[j].low <= c.low) isLow = false;
  }
  if (isHigh) return { type: 'H', index: i, price: c.high, time: c.time };
  if (isLow) return { type: 'L', index: i, price: c.low, time: c.time };
  return null;
}

function getSwings(candles, len = 6, maxSwings = 14) {
  const raw = [];
  for (let i = len; i < candles.length - len; i++) {
    const p = detectPivot(candles, i, len);
    if (!p) continue;
    const last = raw[raw.length - 1];
    if (!last || last.type !== p.type) raw.push(p);
    else if (p.type === 'H' && p.price > last.price) raw[raw.length - 1] = p;
    else if (p.type === 'L' && p.price < last.price) raw[raw.length - 1] = p;
  }
  return raw.slice(-maxSwings);
}

export function evaluateWyckoff(candles, options = {}) {
  const cfg = {
    enabled: true,
    rangeLen: 100,
    pivotLen: 6,
    maxSwings: 14,
    volumeSpikeMult: 1.30,
    compressionMult: 0.70,
    testBars: 20,
    minCandles: 120,
    ...options
  };

  if (!cfg.enabled) {
    return { enabled: false, phase: 'OFF', event: 'OFF', bias: 'OFF', scoreLong: 0, scoreShort: 0, warning: null };
  }
  if (!Array.isArray(candles) || candles.length < cfg.minCandles) {
    return { enabled: true, phase: 'WARMUP', event: 'WARMUP', bias: 'NEUTRO', scoreLong: 0, scoreShort: 0, warning: null };
  }

  const c = candles[candles.length - 1];
  const p = candles[candles.length - 2] ?? c;
  const range = rangeSlice(candles, cfg.rangeLen, 1);
  const prevRange = rangeSlice(candles, cfg.rangeLen, cfg.rangeLen + 1);
  const highs = range.map(x => x.high);
  const lows = range.map(x => x.low);
  const vols = range.map(x => x.volume);
  const rangeHigh = highest(highs);
  const rangeLow = lowest(lows);
  const rangeMid = avg(rangeHigh, rangeLow);
  const rangeSize = Math.max(rangeHigh - rangeLow, options.mintick ?? 0.1);
  const prevSize = prevRange.length ? Math.max(highest(prevRange.map(x => x.high)) - lowest(prevRange.map(x => x.low)), options.mintick ?? 0.1) : rangeSize;
  const volumeMA = sma(vols) ?? c.volume;
  const volumeSpike = c.volume > volumeMA * cfg.volumeSpikeMult;
  const body = Math.abs(c.close - c.open);
  const spread = Math.max(c.high - c.low, options.mintick ?? 0.1);
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const closeNearHigh = c.close > c.low + spread * 0.65;
  const closeNearLow = c.close < c.high - spread * 0.65;
  const compression = prevSize > 0 && rangeSize < prevSize * cfg.compressionMult;
  const inRange = c.close >= rangeLow && c.close <= rangeHigh;
  const premium = c.close > rangeMid;
  const discount = c.close < rangeMid;

  const swings = getSwings(candles, cfg.pivotLen, cfg.maxSwings);
  const lastHigh = swings.filter(x => x.type === 'H').slice(-1)[0];
  const lastLow = swings.filter(x => x.type === 'L').slice(-1)[0];

  const spring = c.low < rangeLow && c.close > rangeLow && volumeSpike && lowerWick > body * 0.8;
  const upthrust = c.high > rangeHigh && c.close < rangeHigh && volumeSpike && upperWick > body * 0.8;
  const sellingClimax = c.low <= rangeLow + rangeSize * 0.08 && volumeSpike && lowerWick > body * 0.6 && closeNearHigh;
  const buyingClimax = c.high >= rangeHigh - rangeSize * 0.08 && volumeSpike && upperWick > body * 0.6 && closeNearLow;
  const automaticRally = lastLow && c.close > rangeMid && c.close > p.close && c.volume < volumeMA * 1.15;
  const automaticReaction = lastHigh && c.close < rangeMid && c.close < p.close && c.volume < volumeMA * 1.15;
  const secondaryTestLow = inRange && discount && Math.abs(c.low - rangeLow) / c.close * 100 < 0.45 && c.volume < volumeMA && !spring;
  const secondaryTestHigh = inRange && premium && Math.abs(c.high - rangeHigh) / c.close * 100 < 0.45 && c.volume < volumeMA && !upthrust;
  const sos = c.close > rangeHigh && volumeSpike && closeNearHigh;
  const sow = c.close < rangeLow && volumeSpike && closeNearLow;
  const lps = inRange && discount && c.close > p.close && c.volume <= volumeMA && c.low > rangeLow;
  const lpsy = inRange && premium && c.close < p.close && c.volume <= volumeMA && c.high < rangeHigh;

  let phase = 'B';
  let event = 'RANGE';
  let bias = 'NEUTRO';
  let scoreLong = 0;
  let scoreShort = 0;
  let warning = null;

  if (sellingClimax) { phase = 'A'; event = 'SC'; bias = 'ACCUMULATION_POSSIBLE'; scoreLong += 1; }
  if (buyingClimax) { phase = 'A'; event = 'BC'; bias = 'DISTRIBUTION_POSSIBLE'; scoreShort += 1; }
  if (automaticRally) { phase = 'A'; event = 'AR'; scoreLong += 1; }
  if (automaticReaction) { phase = 'A'; event = 'AR_DOWN'; scoreShort += 1; }
  if (secondaryTestLow) { phase = 'B'; event = 'ST_LOW'; bias = 'ACCUMULATION_TEST'; scoreLong += 1; }
  if (secondaryTestHigh) { phase = 'B'; event = 'ST_HIGH'; bias = 'DISTRIBUTION_TEST'; scoreShort += 1; }
  if (spring) { phase = 'C'; event = 'SPRING'; bias = 'ACCUMULATION'; scoreLong += 3; warning = compression ? null : 'SPRING_WITHOUT_CLEAR_COMPRESSION'; }
  if (upthrust) { phase = 'C'; event = 'UTAD'; bias = 'DISTRIBUTION'; scoreShort += 3; warning = compression ? null : 'UTAD_WITHOUT_CLEAR_COMPRESSION'; }
  if (sos) { phase = 'D'; event = 'SOS'; bias = 'ACCUMULATION_MARKUP'; scoreLong += 3; }
  if (sow) { phase = 'D'; event = 'SOW'; bias = 'DISTRIBUTION_MARKDOWN'; scoreShort += 3; }
  if (lps && !spring && !sos) { phase = 'D'; event = 'LPS'; bias = 'RE_ACCUMULATION'; scoreLong += 2; }
  if (lpsy && !upthrust && !sow) { phase = 'D'; event = 'LPSY'; bias = 'RE_DISTRIBUTION'; scoreShort += 2; }

  const markup = c.close > rangeHigh && c.close > p.close && !sow;
  const markdown = c.close < rangeLow && c.close < p.close && !sos;
  if (markup) { phase = 'E'; event = sos ? 'SOS_MARKUP' : 'MARKUP'; bias = 'MARKUP'; scoreLong += 2; }
  if (markdown) { phase = 'E'; event = sow ? 'SOW_MARKDOWN' : 'MARKDOWN'; bias = 'MARKDOWN'; scoreShort += 2; }

  if (compression && discount && bias === 'NEUTRO') { bias = 'ACCUMULATION_BUILDING'; scoreLong += 1; }
  if (compression && premium && bias === 'NEUTRO') { bias = 'DISTRIBUTION_BUILDING'; scoreShort += 1; }

  return {
    enabled: true,
    phase,
    event,
    bias,
    scoreLong,
    scoreShort,
    warning,
    compression,
    rangeHigh,
    rangeLow,
    rangeMid,
    premiumDiscount: premium ? 'PREMIUM' : discount ? 'DISCOUNT' : 'MID',
    flags: { sellingClimax, buyingClimax, automaticRally, automaticReaction, secondaryTestLow, secondaryTestHigh, spring, upthrust, sos, sow, lps, lpsy, markup, markdown },
    swings: swings.map(x => ({ type: x.type, price: Number(x.price.toFixed(2)), index: x.index }))
  };
}
