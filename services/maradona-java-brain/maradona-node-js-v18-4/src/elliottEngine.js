// Elliott Lite Engine per Maradona Brain.
// Obiettivo: conferma ciclica/strutturale, NON filtro rigido.
// Lavora sugli swing recenti e restituisce bias LONG/SHORT/NEUTRO + score.

const pct = (a, b) => b ? Math.abs(a - b) / Math.abs(b) * 100 : 0;
const fmt = (v, digits = 2) => Number.isFinite(v) ? Number(v).toFixed(digits) : 'n/a';

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

function normalizeSwings(raw) {
  const out = [];
  for (const sw of raw) {
    const last = out[out.length - 1];
    if (!last) { out.push(sw); continue; }
    if (last.type !== sw.type) { out.push(sw); continue; }
    // Se due pivot consecutivi sono dello stesso tipo, tieni il più estremo.
    if (sw.type === 'H' && sw.price > last.price) out[out.length - 1] = sw;
    if (sw.type === 'L' && sw.price < last.price) out[out.length - 1] = sw;
  }
  return out;
}

function getSwings(candles, len = 5, maxSwings = 12) {
  const raw = [];
  for (let i = len; i < candles.length - len; i++) {
    const p = detectPivot(candles, i, len);
    if (p) raw.push(p);
  }
  return normalizeSwings(raw).slice(-maxSwings);
}

function waveLegs(swings) {
  const legs = [];
  for (let i = 1; i < swings.length; i++) {
    const a = swings[i - 1], b = swings[i];
    legs.push({
      from: a,
      to: b,
      dir: b.price > a.price ? 'UP' : 'DOWN',
      size: Math.abs(b.price - a.price),
      pct: pct(b.price, a.price)
    });
  }
  return legs;
}

function isHigherHighsHigherLows(sw) {
  const highs = sw.filter(x => x.type === 'H').slice(-3);
  const lows = sw.filter(x => x.type === 'L').slice(-3);
  const hh = highs.length >= 2 && highs[highs.length - 1].price > highs[highs.length - 2].price;
  const hl = lows.length >= 2 && lows[lows.length - 1].price > lows[lows.length - 2].price;
  return hh && hl;
}

function isLowerHighsLowerLows(sw) {
  const highs = sw.filter(x => x.type === 'H').slice(-3);
  const lows = sw.filter(x => x.type === 'L').slice(-3);
  const lh = highs.length >= 2 && highs[highs.length - 1].price < highs[highs.length - 2].price;
  const ll = lows.length >= 2 && lows[lows.length - 1].price < lows[lows.length - 2].price;
  return lh && ll;
}

function classifyABC(swings, close) {
  if (swings.length < 4) return null;
  const s = swings.slice(-4);
  const [p0, a, b, c] = s;

  // ABC bullish: trend precedente giù, A rimbalza, B corregge, C tiene sopra il minimo o fa spring/reclaim.
  const bullABC = p0.type === 'L' && a.type === 'H' && b.type === 'L' && c.type === 'H' && b.price > p0.price && close > b.price;
  // ABC bearish: trend precedente su, A scende, B rimbalza, C non supera il massimo e close sotto B.
  const bearABC = p0.type === 'H' && a.type === 'L' && b.type === 'H' && c.type === 'L' && b.price < p0.price && close < b.price;

  if (bullABC) return { pattern: 'ABC_BULL_CORRECTION_ENDING', bias: 'LONG', score: 2, confidence: 0.62 };
  if (bearABC) return { pattern: 'ABC_BEAR_CORRECTION_ENDING', bias: 'SHORT', score: 2, confidence: 0.62 };
  return null;
}

function classifyImpulse(swings, close) {
  if (swings.length < 6) return null;
  const s = swings.slice(-6);
  const legs = waveLegs(s);
  const upLegs = legs.filter(x => x.dir === 'UP').length;
  const downLegs = legs.filter(x => x.dir === 'DOWN').length;
  const hhhl = isHigherHighsHigherLows(s);
  const lhll = isLowerHighsLowerLows(s);

  // Non è un conteggio Elliott accademico; è Elliott Lite operativo: sequenza di swing e struttura.
  if (upLegs >= 3 && downLegs >= 2 && hhhl && close >= s[s.length - 2].price) {
    const thirdLegStrong = legs[2]?.size >= Math.max(legs[0]?.size ?? 0, legs[4]?.size ?? 0) * 0.75;
    return {
      pattern: thirdLegStrong ? 'BULL_IMPULSE_1_2_3_4_5' : 'BULL_IMPULSE_LITE',
      bias: 'LONG',
      score: thirdLegStrong ? 2 : 1,
      confidence: thirdLegStrong ? 0.70 : 0.56
    };
  }

  if (downLegs >= 3 && upLegs >= 2 && lhll && close <= s[s.length - 2].price) {
    const thirdLegStrong = legs[2]?.size >= Math.max(legs[0]?.size ?? 0, legs[4]?.size ?? 0) * 0.75;
    return {
      pattern: thirdLegStrong ? 'BEAR_IMPULSE_1_2_3_4_5' : 'BEAR_IMPULSE_LITE',
      bias: 'SHORT',
      score: thirdLegStrong ? 2 : 1,
      confidence: thirdLegStrong ? 0.70 : 0.56
    };
  }
  return null;
}

function classifyRisk(swings, close) {
  if (swings.length < 5) return null;
  const s = swings.slice(-5);
  const highs = s.filter(x => x.type === 'H');
  const lows = s.filter(x => x.type === 'L');
  const last = s[s.length - 1];

  const potentialBullExhaustion = highs.length >= 2 && last.type === 'H' && close < last.price && pct(last.price, highs[highs.length - 2].price) < 0.35;
  const potentialBearExhaustion = lows.length >= 2 && last.type === 'L' && close > last.price && pct(last.price, lows[lows.length - 2].price) < 0.35;

  if (potentialBullExhaustion) return { pattern: 'POSSIBLE_WAVE_5_EXHAUSTION_TOP', bias: 'SHORT', score: -1, confidence: 0.50 };
  if (potentialBearExhaustion) return { pattern: 'POSSIBLE_WAVE_5_EXHAUSTION_BOTTOM', bias: 'LONG', score: -1, confidence: 0.50 };
  return null;
}

export function evaluateElliott(candles, options = {}) {
  const cfg = {
    enabled: true,
    swingLen: 5,
    maxSwings: 12,
    minCandles: 80,
    ...options
  };

  if (!cfg.enabled) {
    return { enabled: false, bias: 'OFF', pattern: 'OFF', scoreLong: 0, scoreShort: 0, warning: null, confidence: 0, swings: [] };
  }
  if (!Array.isArray(candles) || candles.length < cfg.minCandles) {
    return { enabled: true, bias: 'WARMUP', pattern: 'WARMUP', scoreLong: 0, scoreShort: 0, warning: null, confidence: 0, swings: [] };
  }

  const swings = getSwings(candles, cfg.swingLen, cfg.maxSwings);
  const close = candles[candles.length - 1].close;
  const abc = classifyABC(swings, close);
  const impulse = classifyImpulse(swings, close);
  const risk = classifyRisk(swings, close);
  const chosen = abc ?? impulse ?? null;

  let bias = 'NEUTRO';
  let pattern = 'NEUTRO';
  let scoreLong = 0;
  let scoreShort = 0;
  let confidence = 0;
  let warning = null;

  if (chosen) {
    bias = chosen.bias;
    pattern = chosen.pattern;
    confidence = chosen.confidence;
    if (chosen.bias === 'LONG') scoreLong += chosen.score;
    if (chosen.bias === 'SHORT') scoreShort += chosen.score;
  }

  if (risk) {
    warning = risk.pattern;
    // Risk non blocca: penalizza leggermente la direzione opposta alla warning.
    if (risk.bias === 'SHORT') scoreLong -= 1;
    if (risk.bias === 'LONG') scoreShort -= 1;
    if (!chosen) {
      bias = risk.bias;
      pattern = risk.pattern;
      confidence = risk.confidence;
    }
  }

  return {
    enabled: true,
    bias,
    pattern,
    scoreLong,
    scoreShort,
    warning,
    confidence,
    swings: swings.map(x => ({ type: x.type, price: Number(fmt(x.price)), index: x.index }))
  };
}
