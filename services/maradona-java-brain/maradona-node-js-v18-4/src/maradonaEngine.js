import { defaultConfig } from './config.js';
import { atr, crossover, crossunder, dmiAdx, ema, highest, lowest, macd, sma, stdev, timeframeToMinutes } from './indicators.js';
import { buildDirectionalTargets } from './targetValidation.js';
import { evaluateElliott } from './elliottEngine.js';
import { evaluateWyckoff } from './wyckoffEngine.js';

const fmt = (v, digits = 2) => Number.isFinite(v) ? Number(v).toFixed(digits) : 'n/a';
const avg = (a, b) => (a + b) / 2;
const isBull = c => c.close > c.open;
const isBear = c => c.close < c.open;

export class MaradonaPeleEngine {
  constructor(config = {}) {
    this.cfg = { ...defaultConfig, ...config };
    this.candles = [];
    this.state = {
      barIndex: -1,
      macdState: 0,
      macdSearchLong: false,
      macdSearchShort: false,
      macdPreAlertBar: null,
      macdCrossHistory: [],
      v18MonitorDir: 0,
      v18MonitorBar: null,
      v182MacdLongSeen: false,
      v182TlLongSeen: false,
      v182MacdShortSeen: false,
      v182TlShortSeen: false,
      v182LongPreBar: null,
      v182ShortPreBar: null,
      microLongActive: false,
      microShortActive: false,
      microLongBar: null,
      microShortBar: null,
      microLongHigh: null,
      microLongLow: null,
      microShortHigh: null,
      microShortLow: null,
      retailSLLong: null,
      retailSLShort: null,
      longSLSwept: false,
      shortSLSwept: false,
      lastMasterDir: 0,
      lastMasterBar: null,
      lastMasterSL: null,
      prevFlags: {}
    };
  }

  addCandle(candle, meta = {}) {
    const c = this.normalizeCandle(candle);
    this.candles.push(c);
    this.state.barIndex += 1;
    return this.evaluate(meta);
  }

  normalizeCandle(c) {
    for (const k of ['open','high','low','close','volume']) {
      if (!Number.isFinite(Number(c[k]))) throw new Error(`Candle invalid: ${k} missing/non numerico`);
    }
    return { time: c.time ?? Date.now(), open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume };
  }

  evaluate(meta = {}) {
    const cfg = this.cfg, s = this.state, candles = this.candles;
    const i = candles.length - 1;
    const c = candles[i], p = candles[i - 1] ?? c;
    const closes = candles.map(x => x.close), highs = candles.map(x => x.high), lows = candles.map(x => x.low), vols = candles.map(x => x.volume);
    if (candles.length < Math.max(80, cfg.lookback + 55)) {
      return this.result('WARMUP', meta, { reason: `servono più candele (${candles.length}/80+)` });
    }

    const tfMin = timeframeToMinutes(meta.timeframe ?? '30m');
    const v18IsHTF = cfg.useV18UnifiedMode && tfMin >= cfg.v18HTFMinutes;
    const v18IsLTF = !v18IsHTF;
    const v18ModeTxt = v18IsHTF ? 'MARADONA HTF' : 'PELE LTF';

    const m = macd(closes, 26, 50, 9);
    const macdCrossUp = crossover(m.prevMacdLine, m.macdLine, m.prevSignalLine, m.signalLine);
    const macdCrossDown = crossunder(m.prevMacdLine, m.macdLine, m.prevSignalLine, m.signalLine);
    const ema21 = ema(closes, 21), ema50 = ema(closes, 50), ema55 = ema(closes, 55);
    const { adx } = dmiAdx(candles, cfg.adxLen);
    const volMA = sma(vols, cfg.volLen);
    const volSTD = stdev(vols, cfg.volLen) ?? 0;
    const volSignificativo = c.volume > (volMA ?? 0) + volSTD * 0.5;
    const boxHigh = highest(highs, cfg.lookback, 1);
    const boxLow = lowest(lows, cfg.lookback, 1);
    const boxRng = Math.max((boxHigh ?? c.high) - (boxLow ?? c.low), cfg.mintick);
    const rangeBreakLong20 = c.close > (highest(highs, 20, 1) ?? Infinity);
    const rangeBreakShort20 = c.close < (lowest(lows, 20, 1) ?? -Infinity);

    const miniTrendBull = c.close > ema21 && ema21 > ema50;
    const miniTrendBear = c.close < ema21 && ema21 < ema50;
    const macdDistanceOK = Math.abs((m.macdLine ?? 0) - (m.signalLine ?? 0)) > cfg.macdMinDistance;
    s.macdCrossHistory.push(macdCrossUp || macdCrossDown ? 1 : 0);
    if (s.macdCrossHistory.length > cfg.macdChopLookback) s.macdCrossHistory.shift();
    const macdChoppy = s.macdCrossHistory.reduce((a,b)=>a+b,0) > cfg.macdMaxCrossInChop;
    const macdBoxRange = (highest(highs, 20, 0) ?? 0) - (lowest(lows, 20, 0) ?? 0);
    const macdBoxRangePrev = candles.length >= 40 ? Math.max(...highs.slice(-40, -20)) - Math.min(...lows.slice(-40, -20)) : macdBoxRange;
    const macdBoxCompressed = macdBoxRangePrev > 0 && macdBoxRange < macdBoxRangePrev * 0.70;
    const macdNoChop = !macdChoppy && !macdBoxCompressed;
    const macdHTFLongPermission = c.close > ema50;
    const macdHTFShortPermission = c.close < ema50;
    const macdBreakLongOK = !cfg.macdUseBoxBreak || rangeBreakLong20 || macdHTFLongPermission;
    const macdBreakShortOK = !cfg.macdUseBoxBreak || rangeBreakShort20 || macdHTFShortPermission;
    const macdResetLongVotes = [miniTrendBull, rangeBreakLong20, (m.macdLine ?? 0) > 0, macdHTFLongPermission].filter(Boolean).length;
    const macdResetShortVotes = [miniTrendBear, rangeBreakShort20, (m.macdLine ?? 0) < 0, macdHTFShortPermission].filter(Boolean).length;
    const macdRealLongShift = macdResetLongVotes >= cfg.macdResetVotesNeeded;
    const macdRealShortShift = macdResetShortVotes >= cfg.macdResetVotesNeeded;
    const macdLongPreAlert = cfg.useMacdStateEngine ? (macdCrossUp && s.macdState !== 1 && macdDistanceOK && macdNoChop && macdBreakLongOK && macdRealLongShift) : macdCrossUp;
    const macdShortPreAlert = cfg.useMacdStateEngine ? (macdCrossDown && s.macdState !== -1 && macdDistanceOK && macdNoChop && macdBreakShortOK && macdRealShortShift) : macdCrossDown;

    if (macdLongPreAlert) Object.assign(s, { macdState: 1, macdSearchLong: true, macdSearchShort: false, macdPreAlertBar: s.barIndex });
    if (macdShortPreAlert) Object.assign(s, { macdState: -1, macdSearchShort: true, macdSearchLong: false, macdPreAlertBar: s.barIndex });
    if (s.macdPreAlertBar != null && s.barIndex - s.macdPreAlertBar > cfg.macdSearchBars) Object.assign(s, { macdSearchLong: false, macdSearchShort: false });

    const v181TlBreakLong = c.close > (highest(highs, 10, 1) ?? Infinity) || c.close > boxHigh;
    const v181TlBreakShort = c.close < (lowest(lows, 10, 1) ?? -Infinity) || c.close < boxLow;
    const v182MacdLongSignal = v18IsLTF && macdCrossUp;
    const v182MacdShortSignal = v18IsLTF && macdCrossDown;
    const v182TlLongSignal = v18IsLTF && v181TlBreakLong;
    const v182TlShortSignal = v18IsLTF && v181TlBreakShort;
    const v182PreLong = cfg.useV182DualPrealert && (v182MacdLongSignal || v182TlLongSignal);
    const v182PreShort = cfg.useV182DualPrealert && (v182MacdShortSignal || v182TlShortSignal);

    if (v182PreLong) Object.assign(s, { v182MacdLongSeen: s.v182MacdLongSeen || v182MacdLongSignal, v182TlLongSeen: s.v182TlLongSeen || v182TlLongSignal, v182MacdShortSeen: false, v182TlShortSeen: false, v182LongPreBar: s.barIndex });
    if (v182PreShort) Object.assign(s, { v182MacdShortSeen: s.v182MacdShortSeen || v182MacdShortSignal, v182TlShortSeen: s.v182TlShortSeen || v182TlShortSignal, v182MacdLongSeen: false, v182TlLongSeen: false, v182ShortPreBar: s.barIndex });
    if (s.v182LongPreBar != null && s.barIndex - s.v182LongPreBar > cfg.macdSearchBars) Object.assign(s, { v182MacdLongSeen: false, v182TlLongSeen: false });
    if (s.v182ShortPreBar != null && s.barIndex - s.v182ShortPreBar > cfg.macdSearchBars) Object.assign(s, { v182MacdShortSeen: false, v182TlShortSeen: false });

    const v181LongAuthorized = v18IsLTF && (cfg.useV182DualPrealert ? (s.v182MacdLongSeen && s.v182TlLongSeen) : (s.macdSearchLong && v181TlBreakLong));
    const v181ShortAuthorized = v18IsLTF && (cfg.useV182DualPrealert ? (s.v182MacdShortSeen && s.v182TlShortSeen) : (s.macdSearchShort && v181TlBreakShort));

    const bullFVG = candles.length > 2 && c.low > candles[i - 2].high;
    const bearFVG = candles.length > 2 && c.high < candles[i - 2].low;
    const opLongTrigger = v18IsLTF && cfg.useOperationalClassicTrigger && (cfg.useV181EntryAuth ? (v181LongAuthorized && c.close > boxHigh) : ((macdCrossUp && c.close > boxHigh) || (s.macdSearchLong && c.close > boxHigh)));
    const opShortTrigger = v18IsLTF && cfg.useOperationalClassicTrigger && (cfg.useV181EntryAuth ? (v181ShortAuthorized && c.close < boxLow) : ((macdCrossDown && c.close < boxLow) || (s.macdSearchShort && c.close < boxLow)));

    if (cfg.useMicroGZAfterTrigger && (opLongTrigger || v182PreLong || (cfg.useV181EntryAuth && v181LongAuthorized && !s.microLongActive))) {
      Object.assign(s, { microLongActive: true, microShortActive: false, microLongBar: s.barIndex, microLongHigh: c.close, microLongLow: boxLow });
    }
    if (cfg.useMicroGZAfterTrigger && (opShortTrigger || v182PreShort || (cfg.useV181EntryAuth && v181ShortAuthorized && !s.microShortActive))) {
      Object.assign(s, { microShortActive: true, microLongActive: false, microShortBar: s.barIndex, microShortHigh: boxHigh, microShortLow: c.close });
    }
    if (cfg.microGZUseFVG && s.microLongActive && s.barIndex - s.microLongBar <= 20 && bullFVG) Object.assign(s, { microLongHigh: c.low, microLongLow: candles[i - 2].high });
    if (cfg.microGZUseFVG && s.microShortActive && s.barIndex - s.microShortBar <= 20 && bearFVG) Object.assign(s, { microShortHigh: candles[i - 2].low, microShortLow: c.high });
    if (s.microLongActive && s.barIndex - s.microLongBar > cfg.microGZBars) s.microLongActive = false;
    if (s.microShortActive && s.barIndex - s.microShortBar > cfg.microGZBars) s.microShortActive = false;

    const microLongValid = s.microLongActive && s.microLongHigh > s.microLongLow;
    const microShortValid = s.microShortActive && s.microShortHigh > s.microShortLow;
    const microFib50Long = microLongValid ? s.microLongHigh - (s.microLongHigh - s.microLongLow) * 0.5 : null;
    const microFib705Long = microLongValid ? s.microLongHigh - (s.microLongHigh - s.microLongLow) * cfg.gzDeepFib : null;
    const microFib50Short = microShortValid ? s.microShortLow + (s.microShortHigh - s.microShortLow) * 0.5 : null;
    const microFib705Short = microShortValid ? s.microShortLow + (s.microShortHigh - s.microShortLow) * cfg.gzDeepFib : null;
    const microInZoneLong = microLongValid && c.close <= microFib50Long && c.close >= microFib705Long;
    const microInZoneShort = microShortValid && c.close >= microFib50Short && c.close <= microFib705Short;
    const microEntryLong = microLongValid ? avg(microFib50Long, microFib705Long) : null;
    const microEntryShort = microShortValid ? avg(microFib50Short, microFib705Short) : null;
    const microLongSL = microLongValid ? boxLow : null;
    const microShortSL = microShortValid ? boxHigh : null;
    const microLongTPs = microLongValid ? [microEntryLong + boxRng * cfg.microTP1Mult, microEntryLong + boxRng * cfg.microTP2Mult, microEntryLong + boxRng * cfg.microTP3Mult] : [];
    const microShortTPs = microShortValid ? [microEntryShort - boxRng * cfg.microTP1Mult, microEntryShort - boxRng * cfg.microTP2Mult, microEntryShort - boxRng * cfg.microTP3Mult] : [];

    // Struttura/liquidità compatta: equivalente operativo del Pine, non grafico.
    const bosLong = c.close > (highest(highs, cfg.structureLen * 2, 1) ?? Infinity);
    const bosShort = c.close < (lowest(lows, cfg.structureLen * 2, 1) ?? -Infinity);
    const chochLong = bosLong && c.close > ema21;
    const chochShort = bosShort && c.close < ema21;
    if (lows.length > cfg.structureLen) s.retailSLLong = lowest(lows, cfg.structureLen, 1);
    if (highs.length > cfg.structureLen) s.retailSLShort = highest(highs, cfg.structureLen, 1);
    const longLiquiditySweep = s.retailSLLong != null && c.low < s.retailSLLong && c.close > s.retailSLLong;
    const shortLiquiditySweep = s.retailSLShort != null && c.high > s.retailSLShort && c.close < s.retailSLShort;
    const sweptLongCluster = (cfg.longLiq ?? []).some(x => x > 0 && c.low < x && c.close > x);
    const sweptShortCluster = (cfg.shortLiq ?? []).some(x => x > 0 && c.high > x && c.close < x);
    const nearLongLiq = (cfg.longLiq ?? []).some(x => x > 0 && Math.abs(c.close - x) / c.close * 100 <= cfg.liqClusterTolerancePct);
    const nearShortLiq = (cfg.shortLiq ?? []).some(x => x > 0 && Math.abs(c.close - x) / c.close * 100 <= cfg.liqClusterTolerancePct);

    const phaseRange = (highest(highs, 34) ?? c.high) - (lowest(lows, 34) ?? c.low);
    const prev34Highs = highs.slice(Math.max(0, highs.length - 68), Math.max(0, highs.length - 34));
    const prev34Lows = lows.slice(Math.max(0, lows.length - 68), Math.max(0, lows.length - 34));
    const phaseRangePrev = prev34Highs.length ? Math.max(...prev34Highs) - Math.min(...prev34Lows) : phaseRange;
    const phaseTrendBull = c.close > ema21 && ema21 > ema55 && adx > cfg.adxThresh;
    const phaseTrendBear = c.close < ema21 && ema21 < ema55 && adx > cfg.adxThresh;
    const phaseCompression = phaseRangePrev > 0 && phaseRange < phaseRangePrev * 0.70 && adx < cfg.adxThresh;
    const compression = phaseRangePrev > 0 && phaseRange < phaseRangePrev * 0.65;
    const marketPhase = phaseCompression ? 'COMPRESSIONE' : phaseTrendBull ? 'TREND BULL' : phaseTrendBear ? 'TREND BEAR' : adx < cfg.adxThresh ? 'RANGE' : 'NEUTRO';

    const body = Math.abs(c.close - c.open);
    const spread = Math.max(c.high - c.low, cfg.mintick);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    const wyckoff = evaluateWyckoff(candles, {
      enabled: cfg.useWyckoffEngine,
      rangeLen: cfg.wyckoffRangeLen,
      pivotLen: cfg.wyckoffPivotLen,
      maxSwings: cfg.wyckoffMaxSwings,
      volumeSpikeMult: cfg.wyckoffVolumeSpikeMult,
      compressionMult: cfg.wyckoffCompressionMult,
      minCandles: cfg.wyckoffMinCandles,
      mintick: cfg.mintick
    });
    const wySpring = Boolean(wyckoff.flags?.spring);
    const wyUpthrust = Boolean(wyckoff.flags?.upthrust);
    const wySOS = Boolean(wyckoff.flags?.sos);
    const wySOW = Boolean(wyckoff.flags?.sow);

    const smartLiqLong = longLiquiditySweep || nearLongLiq || sweptLongCluster || bullFVG || bosLong || chochLong || wySpring || wySOS;
    const smartLiqShort = shortLiquiditySweep || nearShortLiq || sweptShortCluster || bearFVG || bosShort || chochShort || wyUpthrust || wySOW;

    const elliott = evaluateElliott(candles, {
      enabled: cfg.useElliottEngine,
      swingLen: cfg.elliottSwingLen,
      maxSwings: cfg.elliottMaxSwings,
      minCandles: 80
    });
    const elliottLongScore = Math.trunc((elliott.scoreLong ?? 0) * cfg.elliottScoreWeight);
    const elliottShortScore = Math.trunc((elliott.scoreShort ?? 0) * cfg.elliottScoreWeight);
    const wyckoffLongScore = Math.trunc((wyckoff.scoreLong ?? 0) * cfg.wyckoffScoreWeight);
    const wyckoffShortScore = Math.trunc((wyckoff.scoreShort ?? 0) * cfg.wyckoffScoreWeight);

    const brainLongScore = [phaseTrendBull, c.close > ema50, s.macdSearchLong, v181LongAuthorized, microLongValid, microInZoneLong, smartLiqLong, bosLong || chochLong, bullFVG, volSignificativo].filter(Boolean).length + elliottLongScore + wyckoffLongScore;
    const brainShortScore = [phaseTrendBear, c.close < ema50, s.macdSearchShort, v181ShortAuthorized, microShortValid, microInZoneShort, smartLiqShort, bosShort || chochShort, bearFVG, volSignificativo].filter(Boolean).length + elliottShortScore + wyckoffShortScore;
    const coreLongAuthorized = brainLongScore >= cfg.brainMinScore && brainLongScore > brainShortScore;
    const coreShortAuthorized = brainShortScore >= cfg.brainMinScore && brainShortScore > brainLongScore;
    const brainState = coreLongAuthorized ? 'LONG AUTH' : coreShortAuthorized ? 'SHORT AUTH' : brainLongScore > brainShortScore ? 'LONG WATCH' : brainShortScore > brainLongScore ? 'SHORT WATCH' : 'NEUTRO';

    const v183RangeCompression = phaseCompression || compression || macdBoxCompressed;
    const v183MomentumChop = macdChoppy || marketPhase === 'RANGE' || marketPhase === 'COMPRESSIONE';
    const v183CompressionMedium = v183RangeCompression || v183MomentumChop;
    const v183CompressionExtreme = (phaseCompression && compression) || (macdChoppy && macdBoxCompressed) || (marketPhase === 'COMPRESSIONE' && adx < cfg.adxThresh);
    const candleATR = atr(candles, 14) ?? spread;
    const closeNearHigh = c.close >= c.high - spread * 0.25;
    const closeNearLow = c.close <= c.low + spread * 0.25;
    const displacementLong = isBull(c) && body >= candleATR * cfg.v183MinDisplacementATR && closeNearHigh && volSignificativo;
    const displacementShort = isBear(c) && body >= candleATR * cfg.v183MinDisplacementATR && closeNearLow && volSignificativo;
    const longSweepStrong = longLiquiditySweep || sweptLongCluster || wySpring;
    const shortSweepStrong = shortLiquiditySweep || sweptShortCluster || wyUpthrust;
    const compressionNow = cfg.v183CompressionMode === 'Strict' ? v183CompressionMedium : v183CompressionExtreme;
    const noCompressionLongOK = cfg.v183CompressionMode === 'Off' || !cfg.v183UseNoCompression || !compressionNow || (cfg.v183AllowCompressionOverrideWithSweep && (longSweepStrong || displacementLong));
    const noCompressionShortOK = cfg.v183CompressionMode === 'Off' || !cfg.v183UseNoCompression || !compressionNow || (cfg.v183AllowCompressionOverrideWithSweep && (shortSweepStrong || displacementShort));

    const brainLongOK = !cfg.v183UseBrainAuthorization || coreLongAuthorized || (brainLongScore > brainShortScore && brainLongScore >= cfg.brainMinScore);
    const brainShortOK = !cfg.v183UseBrainAuthorization || coreShortAuthorized || (brainShortScore > brainLongScore && brainShortScore >= cfg.brainMinScore);
    const macdArmedLong = !cfg.v183UseMacdArming || s.macdSearchLong || s.v182MacdLongSeen || s.v182TlLongSeen || v181LongAuthorized;
    const macdArmedShort = !cfg.v183UseMacdArming || s.macdSearchShort || s.v182MacdShortSeen || s.v182TlShortSeen || v181ShortAuthorized;

    const longRejectionCandle = isBull(c) && c.close > p.close && lowerWick >= body * cfg.v183RejectionWickMult;
    const shortRejectionCandle = isBear(c) && c.close < p.close && upperWick >= body * cfg.v183RejectionWickMult;
    const rejectionLong = cfg.v183UseRejectionEntry && (microInZoneLong || bullFVG) && longRejectionCandle;
    const rejectionShort = cfg.v183UseRejectionEntry && (microInZoneShort || bearFVG) && shortRejectionCandle;
    const breakoutLongConfirm = cfg.v183UseBreakdownConfirm && ((c.close > boxHigh && p.close <= boxHigh) || (c.close > boxHigh && p.close > boxHigh && c.low > boxHigh)) && (displacementLong || volSignificativo || bosLong || chochLong);
    const breakdownShortConfirm = cfg.v183UseBreakdownConfirm && ((c.close < boxLow && p.close >= boxLow) || (c.close < boxLow && p.close < boxLow && c.high < boxLow)) && (displacementShort || volSignificativo || bosShort || chochShort);
    const sweepLongEntry = cfg.v183UseSweepEntry && (longLiquiditySweep || sweptLongCluster || wySpring) && isBull(c) && (chochLong || bosLong || c.close > p.close || displacementLong);
    const sweepShortEntry = cfg.v183UseSweepEntry && (shortLiquiditySweep || sweptShortCluster || wyUpthrust) && isBear(c) && (chochShort || bosShort || c.close < p.close || displacementShort);
    const entryTypeLong = sweepLongEntry ? 'SWEEP' : rejectionLong ? 'REJECTION' : breakoutLongConfirm ? 'BREAKOUT_CONFIRM' : 'NONE';
    const entryTypeShort = sweepShortEntry ? 'SWEEP' : rejectionShort ? 'REJECTION' : breakdownShortConfirm ? 'BREAKDOWN_CONFIRM' : 'NONE';
    const peleLongConfirm = rejectionLong || breakoutLongConfirm || sweepLongEntry;
    const peleShortConfirm = rejectionShort || breakdownShortConfirm || sweepShortEntry;

    const preLongRaw = cfg.useV183ExecutionEngine && v18IsLTF && macdArmedLong && !brainLongOK;
    const preShortRaw = cfg.useV183ExecutionEngine && v18IsLTF && macdArmedShort && !brainShortOK;
    const readyLongRaw = cfg.useV183ExecutionEngine && v18IsLTF && brainLongOK && macdArmedLong;
    const readyShortRaw = cfg.useV183ExecutionEngine && v18IsLTF && brainShortOK && macdArmedShort;
    const recentMasterLong = s.lastMasterDir === 1 && s.lastMasterBar != null && s.barIndex - s.lastMasterBar <= cfg.v183OppositePreBlockBars;
    const recentMasterShort = s.lastMasterDir === -1 && s.lastMasterBar != null && s.barIndex - s.lastMasterBar <= cfg.v183OppositePreBlockBars;
    const flipShortValid = recentMasterLong && peleShortConfirm && ((s.lastMasterSL != null && c.close < s.lastMasterSL) || displacementShort || shortSweepStrong);
    const flipLongValid = recentMasterShort && peleLongConfirm && ((s.lastMasterSL != null && c.close > s.lastMasterSL) || displacementLong || longSweepStrong);
    const oppositeShortBlocked = recentMasterLong && (preShortRaw || readyShortRaw) && !flipShortValid;
    const oppositeLongBlocked = recentMasterShort && (preLongRaw || readyLongRaw) && !flipLongValid;
    const readyLong = readyLongRaw && !oppositeLongBlocked;
    const readyShort = readyShortRaw && !oppositeShortBlocked;
    const masterLong = cfg.useV183ExecutionEngine && readyLongRaw && peleLongConfirm && noCompressionLongOK && !(recentMasterShort && !flipLongValid);
    const masterShort = cfg.useV183ExecutionEngine && readyShortRaw && peleShortConfirm && noCompressionShortOK && !(recentMasterLong && !flipShortValid);
    const warnLongRisk = recentMasterShort && (macdArmedLong || preLongRaw || readyLongRaw) && !flipLongValid && !masterLong;
    const warnShortRisk = recentMasterLong && (macdArmedShort || preShortRaw || readyShortRaw) && !flipShortValid && !masterShort;

    const rawLongTPs = microLongTPs.length ? microLongTPs : [c.close + boxRng * cfg.microTP1Mult, c.close + boxRng * cfg.microTP2Mult, c.close + boxRng * cfg.microTP3Mult];
    const rawShortTPs = microShortTPs.length ? microShortTPs : [c.close - boxRng * cfg.microTP1Mult, c.close - boxRng * cfg.microTP2Mult, c.close - boxRng * cfg.microTP3Mult];
    const longTargets = buildDirectionalTargets({ side: 'LONG', entry: c.close, rawTargets: rawLongTPs, rawSL: microLongSL ?? boxLow, range: boxRng, multipliers: [cfg.microTP1Mult, cfg.microTP2Mult, cfg.microTP3Mult], mintick: cfg.mintick });
    const shortTargets = buildDirectionalTargets({ side: 'SHORT', entry: c.close, rawTargets: rawShortTPs, rawSL: microShortSL ?? boxHigh, range: boxRng, multipliers: [cfg.microTP1Mult, cfg.microTP2Mult, cfg.microTP3Mult], mintick: cfg.mintick });

    const longRange = { low: c.close - boxRng * cfg.v183EntryRangeMult, high: c.close, noChaseAbove: c.close + boxRng * cfg.v183NoChaseMult };
    const shortRange = { low: c.close, high: c.close + boxRng * cfg.v183EntryRangeMult, noChaseBelow: c.close - boxRng * cfg.v183NoChaseMult };

    const flags = { preLongRaw, preShortRaw, readyLong, readyShort, masterLong, masterShort, warnLongRisk, warnShortRisk };
    const fires = Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, Boolean(v && !s.prevFlags[k])]));
    s.prevFlags = flags;

    let signal = 'WAIT', side = null, alert = null, targets = null, entryRange = null;
    if (fires.masterLong) { signal = 'MASTER'; side = 'LONG'; targets = longTargets; entryRange = longRange; }
    else if (fires.masterShort) { signal = 'MASTER'; side = 'SHORT'; targets = shortTargets; entryRange = shortRange; }
    else if (fires.readyLong) { signal = 'READY'; side = 'LONG'; }
    else if (fires.readyShort) { signal = 'READY'; side = 'SHORT'; }
    else if (fires.warnShortRisk) { signal = 'WARNING'; side = 'SHORT_PRESSURE'; }
    else if (fires.warnLongRisk) { signal = 'WARNING'; side = 'LONG_PRESSURE'; }
    else if (fires.preLongRaw) { signal = 'RADAR'; side = 'LONG'; }
    else if (fires.preShortRaw) { signal = 'RADAR'; side = 'SHORT'; }

    if (signal !== 'WAIT') {
      alert = this.buildAlert({ signal, side, symbol: meta.symbol ?? 'SYMBOL', timeframe: meta.timeframe ?? 'TF', brainState, brainLongScore, brainShortScore, compressionNow, entryType: side === 'LONG' ? entryTypeLong : entryTypeShort, targets, entryRange, lastSL: s.lastMasterSL, v18ModeTxt, elliott, wyckoff });
    }

    if (fires.masterLong) Object.assign(s, { lastMasterDir: 1, lastMasterBar: s.barIndex, lastMasterSL: longTargets.sl, microLongActive: false });
    if (fires.masterShort) Object.assign(s, { lastMasterDir: -1, lastMasterBar: s.barIndex, lastMasterSL: shortTargets.sl, microShortActive: false });
    if (s.lastMasterDir === 1 && s.lastMasterBar != null && s.barIndex > s.lastMasterBar && c.low <= s.lastMasterSL) Object.assign(s, { microLongActive: false, microShortActive: false, lastMasterDir: 0 });
    if (s.lastMasterDir === -1 && s.lastMasterBar != null && s.barIndex > s.lastMasterBar && c.high >= s.lastMasterSL) Object.assign(s, { microLongActive: false, microShortActive: false, lastMasterDir: 0 });

    return {
      signal, side, alert,
      diagnostics: {
        symbol: meta.symbol, timeframe: meta.timeframe, mode: v18ModeTxt,
        close: c.close, adx, macdLine: m.macdLine, signalLine: m.signalLine,
        boxHigh, boxLow, boxRng, volSignificativo,
        brainState, brainLongScore, brainShortScore, marketPhase, wyckoff, elliott,
        macdArmedLong, macdArmedShort, readyLong, readyShort, masterLong, masterShort,
        entryTypeLong, entryTypeShort, compressionNow,
        micro: { longValid: microLongValid, shortValid: microShortValid, microEntryLong, microEntryShort, microInZoneLong, microInZoneShort },
        liquidity: { longLiquiditySweep, shortLiquiditySweep, sweptLongCluster, sweptShortCluster, nearLongLiq, nearShortLiq },
        targets: signal === 'MASTER' ? targets : null
      }
    };
  }

  buildAlert({ signal, side, symbol, timeframe, brainState, brainLongScore, brainShortScore, compressionNow, entryType, targets, entryRange, lastSL, v18ModeTxt, elliott, wyckoff }) {
    if (signal === 'MASTER') {
      const isLong = side === 'LONG';
      return [
        `🚨 MARADONA MASTER ${side}`,
        `PAIR: ${symbol}`,
        `TF: ${timeframe}`,
        `ENTRY: ${fmt(targets.entry)}`,
        `ENTRY RANGE: ${fmt(entryRange.low)} - ${fmt(entryRange.high)}`,
        isLong ? `NO CHASE ABOVE: ${fmt(entryRange.noChaseAbove)}` : `NO CHASE BELOW: ${fmt(entryRange.noChaseBelow)}`,
        `SL: ${fmt(targets.sl)}`,
        `TP1: ${fmt(targets.tp1)}`,
        `TP2: ${fmt(targets.tp2)}`,
        `TP3: ${fmt(targets.tp3)}`,
        `TP GUARD: ${targets.guard}`,
        `BRAIN: ${brainState}`,
        `MACD/TL: ARMED ${side}`,
        `ENTRY TYPE: ${entryType}`,
        `COMPRESSION: ${compressionNow ? 'YES' : 'NO'}`,
        `SCORE L/S: ${brainLongScore}/${brainShortScore}`,
        `WYCKOFF: PHASE ${wyckoff?.phase ?? 'n/a'} - ${wyckoff?.event ?? 'n/a'} (${wyckoff?.bias ?? 'n/a'})`,
        wyckoff?.warning ? `WYCKOFF WARNING: ${wyckoff.warning}` : null,
        `ELLIOTT: ${elliott?.pattern ?? 'n/a'} (${elliott?.bias ?? 'n/a'})`,
        elliott?.warning ? `ELLIOTT WARNING: ${elliott.warning}` : null,
        `MODE: ${v18ModeTxt}`
      ].filter(Boolean).join('\n');
    }
    if (signal === 'READY') {
      return [`🟠 MARADONA READY ${side}`, `PAIR: ${symbol}`, `TF: ${timeframe}`, `BRAIN: ${brainState}`, `MACD/TL: ARMED ${side}`, `WAITING: REJECTION / ${side === 'LONG' ? 'BREAKOUT' : 'BREAKDOWN'} / SWEEP`, `COMPRESSION: ${compressionNow ? 'YES' : 'NO'}`, `SCORE L/S: ${brainLongScore}/${brainShortScore}`, `WYCKOFF: PHASE ${wyckoff?.phase ?? 'n/a'} - ${wyckoff?.event ?? 'n/a'} (${wyckoff?.bias ?? 'n/a'})`, wyckoff?.warning ? `WYCKOFF WARNING: ${wyckoff.warning}` : null, `ELLIOTT: ${elliott?.pattern ?? 'n/a'} (${elliott?.bias ?? 'n/a'})`, elliott?.warning ? `ELLIOTT WARNING: ${elliott.warning}` : null, `MODE: ${v18ModeTxt}`].filter(Boolean).join('\n');
    }
    if (signal === 'WARNING') {
      return [`⚠️ MARADONA ${side}`, `PAIR: ${symbol}`, `TF: ${timeframe}`, `ACTIVE: MASTER RECENTE`, `ACTION: gestisci posizione, non aprire contrario finché non c'è FLIP`, `INVALIDATION SL: ${fmt(lastSL)}`, `COMPRESSION: ${compressionNow ? 'YES' : 'NO'}`].join('\n');
    }
    return [`🟡 MARADONA RADAR ${side}`, `PAIR: ${symbol}`, `TF: ${timeframe}`, `MACD/TL: ARMED ${side}`, `BRAIN: WAIT`, `COMPRESSION: ${compressionNow ? 'YES' : 'NO'}`, `ACTION: Node/Java monitor book/delta`].join('\n');
  }

  result(signal, meta, extra = {}) {
    return { signal, side: null, alert: null, diagnostics: { symbol: meta.symbol, timeframe: meta.timeframe, ...extra } };
  }
}
