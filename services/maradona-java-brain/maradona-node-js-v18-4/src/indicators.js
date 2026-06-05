export const last = (arr, n = 0) => arr[arr.length - 1 - n];
export const clampNumber = (v, fallback = null) => Number.isFinite(Number(v)) ? Number(v) : fallback;

export function sma(values, len) {
  if (values.length < len) return null;
  const s = values.slice(-len).reduce((a, b) => a + b, 0);
  return s / len;
}

export function emaSeries(values, len) {
  const out = [];
  const k = 2 / (len + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) { out.push(null); continue; }
    if (prev == null) prev = v;
    else prev = v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function ema(values, len) {
  return last(emaSeries(values, len));
}

export function stdev(values, len) {
  if (values.length < len) return null;
  const xs = values.slice(-len);
  const mean = xs.reduce((a, b) => a + b, 0) / len;
  return Math.sqrt(xs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / len);
}

export function highest(values, len, offset = 0) {
  const end = values.length - offset;
  const start = end - len;
  if (start < 0 || end <= 0) return null;
  return Math.max(...values.slice(start, end));
}

export function lowest(values, len, offset = 0) {
  const end = values.length - offset;
  const start = end - len;
  if (start < 0 || end <= 0) return null;
  return Math.min(...values.slice(start, end));
}

export function crossover(aPrev, aNow, bPrev, bNow) {
  return aPrev != null && bPrev != null && aNow != null && bNow != null && aPrev <= bPrev && aNow > bNow;
}

export function crossunder(aPrev, aNow, bPrev, bNow) {
  return aPrev != null && bPrev != null && aNow != null && bNow != null && aPrev >= bPrev && aNow < bNow;
}

export function macd(values, fast = 26, slow = 50, signalLen = 9) {
  if (values.length < slow + signalLen) return { macdLine: null, signalLine: null, hist: null, prevMacdLine: null, prevSignalLine: null };
  const emaFast = emaSeries(values, fast);
  const emaSlow = emaSeries(values, slow);
  const line = values.map((_, i) => (emaFast[i] == null || emaSlow[i] == null) ? null : emaFast[i] - emaSlow[i]);
  const cleanLine = line.map(v => v == null ? 0 : v);
  const sig = emaSeries(cleanLine, signalLen);
  const i = values.length - 1;
  return {
    macdLine: line[i],
    signalLine: sig[i],
    hist: line[i] == null || sig[i] == null ? null : line[i] - sig[i],
    prevMacdLine: line[i - 1] ?? null,
    prevSignalLine: sig[i - 1] ?? null
  };
}

export function trueRanges(candles) {
  const out = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = i > 0 ? candles[i - 1].close : c.close;
    out.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  return out;
}

export function atr(candles, len = 14) {
  return sma(trueRanges(candles), len);
}

export function dmiAdx(candles, len = 14) {
  if (candles.length < len + 2) return { plusDI: null, minusDI: null, adx: null };
  const plusDM = [], minusDM = [], tr = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i], prev = candles[i - 1];
    const upMove = cur.high - prev.high;
    const downMove = prev.low - cur.low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close)));
  }
  const trN = sma(tr, len);
  const plusN = sma(plusDM, len);
  const minusN = sma(minusDM, len);
  if (!trN) return { plusDI: null, minusDI: null, adx: null };
  const plusDI = 100 * plusN / trN;
  const minusDI = 100 * minusN / trN;
  const dxValues = [];
  for (let i = len; i < tr.length; i++) {
    const trSlice = tr.slice(i - len + 1, i + 1).reduce((a, b) => a + b, 0) / len;
    const pSlice = plusDM.slice(i - len + 1, i + 1).reduce((a, b) => a + b, 0) / len;
    const mSlice = minusDM.slice(i - len + 1, i + 1).reduce((a, b) => a + b, 0) / len;
    const pdi = trSlice ? 100 * pSlice / trSlice : 0;
    const mdi = trSlice ? 100 * mSlice / trSlice : 0;
    dxValues.push((pdi + mdi) ? 100 * Math.abs(pdi - mdi) / (pdi + mdi) : 0);
  }
  return { plusDI, minusDI, adx: sma(dxValues, Math.min(len, dxValues.length)) };
}

export function timeframeToMinutes(tf) {
  const s = String(tf).toLowerCase().trim();
  if (s.endsWith('m')) return Number(s.replace('m',''));
  if (s.endsWith('h')) return Number(s.replace('h','')) * 60;
  if (s === 'd' || s === '1d') return 1440;
  if (s === 'w' || s === '1w') return 10080;
  const n = Number(s);
  return Number.isFinite(n) ? n : 30;
}
