export function buildDirectionalTargets({ side, entry, rawTargets = [], rawSL, range, multipliers = [0.5, 1.0, 1.5], mintick = 0.1 }) {
  const safeRange = Math.max(Number(range) || 0, mintick);
  const isLong = side === 'LONG';
  const corrected = [];
  let warning = false;

  for (let i = 0; i < 3; i++) {
    const raw = rawTargets[i];
    const mult = multipliers[i] ?? (i + 1) * 0.5;
    let tp = Number.isFinite(raw) ? raw : null;
    const valid = isLong ? tp != null && tp > entry : tp != null && tp < entry;
    if (!valid) {
      warning = warning || tp != null;
      tp = isLong ? entry + safeRange * mult : entry - safeRange * mult;
    }
    if (i > 0) {
      const prev = corrected[i - 1];
      if (isLong && tp <= prev) tp = entry + safeRange * Math.max(mult, multipliers[i - 1] + 0.1);
      if (!isLong && tp >= prev) tp = entry - safeRange * Math.max(mult, multipliers[i - 1] + 0.1);
    }
    corrected.push(tp);
  }

  let sl = Number.isFinite(rawSL) ? rawSL : (isLong ? entry - safeRange : entry + safeRange);
  if (isLong && sl >= entry) { warning = true; sl = entry - safeRange; }
  if (!isLong && sl <= entry) { warning = true; sl = entry + safeRange; }

  return {
    entry,
    sl,
    tp1: corrected[0],
    tp2: corrected[1],
    tp3: corrected[2],
    guard: warning ? 'YES - TP/SL RAW CORRECTED' : 'OK'
  };
}
