package com.maradona.core;

import com.maradona.model.MarketSnapshot;
import com.maradona.model.TradingViewSignal;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class MaradonaBrain {
    private final Map<String, ActiveSetup> activeSetups = new ConcurrentHashMap<>();

    public Decision evaluate(TradingViewSignal tv, MarketSnapshot m) {
        if (tv == null) return new Decision("NO_TV", "Manca segnale TradingView", 0, "⚪ MARADONA NO TV", false);
        String symbol = clean(tv.symbol(), "UNKNOWN");
        String signal = clean(tv.safeSignal(), "UNKNOWN").toUpperCase();
        String side = clean(tv.safeSide(), "UNKNOWN").toUpperCase();
        String compression = clean(tv.compression(), "UNKNOWN").toUpperCase();
        String entryType = clean(tv.entryType(), "UNKNOWN").toUpperCase();

        boolean isLong = side.contains("LONG");
        boolean isShort = side.contains("SHORT");
        boolean isPre = signal.contains("PRE");
        boolean isReady = signal.contains("READY");
        boolean isMaster = signal.contains("MASTER");
        boolean isWarning = signal.contains("WARNING") || signal.contains("RISK") || signal.contains("PROTECT");
        boolean isFlip = signal.contains("FLIP");
        TargetValidation targetValidation = TargetValidation.validate(tv);

        if (m == null) {
            if (isMaster) {
                rememberMaster(symbol, side, tv);
                return new Decision("TV_MASTER_NO_BYBIT", "MASTER ricevuto ma manca snapshot Bybit: non valido per auto-entry, solo notifica", tv.safeScore() * 6, "🚨 MARADONA MASTER - NO BYBIT", false);
            }
            return new Decision("MONITOR_NO_BYBIT", "Segnale TW ricevuto ma manca snapshot Bybit", tv.safeScore() * 5, "🟡 MARADONA MONITOR - NO BYBIT", false);
        }

        Flow flow = scoreFlow(isLong, isShort, m);
        int confidence = Math.min(100, tv.safeScore() * 6 + flow.score * 7);
        boolean extremeCompression = compression.contains("EXTREME") || compression.contains("HARD");
        boolean allowedCompression = !extremeCompression || entryType.contains("BREAKDOWN") || entryType.contains("SWEEP") || flow.score >= 5;

        ActiveSetup active = activeSetups.get(symbol);
        boolean oppositePreAfterMaster = active != null && active.isOpposite(side) && !isMaster && !isFlip && active.isFresh(Duration.ofHours(6));
        if (oppositePreAfterMaster) {
            return new Decision("WARNING_PROTECT_" + active.side,
                    "Segnale opposto dopo MASTER " + active.side + ": trattalo come WARNING/PROTECT, non nuova entry finché non arriva FLIP o MASTER opposto confermato",
                    confidence,
                    "⚠️ MARADONA WARNING / PROTECT",
                    false);
        }

        if (isWarning) {
            return new Decision("WARNING", "Avviso rischio/pressione opposta: proteggi o monitora, non è entry", confidence, "⚠️ MARADONA WARNING", false);
        }

        if (isPre) {
            return new Decision("MONITOR_PRE_" + side, "PRE: radar acceso, Java monitora book/delta/pressure", confidence, "🟡 MARADONA PRE " + side, false);
        }

        if (isReady) {
            return new Decision("MONITOR_READY_" + side, "READY: setup quasi operativo, attesa Pelé REJECTION/BREAKDOWN/SWEEP", confidence, "🟠 MARADONA READY " + side, false);
        }

        if (isFlip) {
            if (flow.score >= 4 && allowedCompression) {
                rememberMaster(symbol, side, tv);
                return new Decision("FLIP_VALIDATED_" + side, "FLIP confermato da TW + Bybit flow favorevole", confidence, "🔁 MARADONA FLIP VALIDATED " + side, true);
            }
            return new Decision("FLIP_BLOCKED", "TW segnala FLIP ma Bybit non conferma abbastanza", confidence, "⚠️ MARADONA FLIP BLOCCATO", false);
        }

        if (isMaster) {
            if (!targetValidation.valid()) {
                rememberMaster(symbol, side, tv);
                return new Decision("MASTER_WATCH_TARGET_ERROR_" + side,
                        "TW MASTER ricevuto, ma i TP sono incoerenti per la direzione. " + targetValidation.warning(),
                        confidence,
                        "🟨 MARADONA MASTER WATCH - TP DA CORREGGERE " + side,
                        false);
            }
            if (!allowedCompression) {
                return new Decision("MASTER_BLOCKED_COMPRESSION", "MASTER bloccato: compressione estrema senza displacement/flow sufficiente", confidence, "⛔ MARADONA MASTER BLOCCATO", false);
            }
            if (flow.score >= 5) {
                rememberMaster(symbol, side, tv);
                return new Decision("ENTRY_VALIDATED_" + side,
                        "TW MASTER + Bybit conferma: " + flow.reason,
                        confidence,
                        "✅ MARADONA ENTRY VALIDATA " + side,
                        true);
            }
            if (flow.score >= 3) {
                rememberMaster(symbol, side, tv);
                return new Decision("ENTRY_WATCH_" + side,
                        "TW MASTER valido ma Bybit solo parziale: entrata manuale prudente / attendere retest",
                        confidence,
                        "🟨 MARADONA MASTER WATCH " + side,
                        false);
            }
            return new Decision("ENTRY_BLOCKED_" + side,
                    "TW MASTER ma Bybit NON conferma: " + flow.reason,
                    confidence,
                    "⛔ MARADONA ENTRY BLOCCATA " + side,
                    false);
        }

        return new Decision("MONITOR", "Segnale non classificato: monitor", confidence, "⚪ MARADONA MONITOR", false);
    }

    private Flow scoreFlow(boolean isLong, boolean isShort, MarketSnapshot m) {
        int s = 0;
        StringBuilder r = new StringBuilder();
        double bid = m.bidPressure();
        double ask = m.askPressure();
        double delta = m.deltaProxy();
        double spread = m.spreadPct();
        double velocity = m.velocity();

        if (isShort) {
            if (ask > bid * 1.10) { s += 3; r.append("ask pressure forte; "); }
            if (delta < 0) { s += 2; r.append("delta proxy negativo; "); }
        }
        if (isLong) {
            if (bid > ask * 1.10) { s += 3; r.append("bid pressure forte; "); }
            if (delta > 0) { s += 2; r.append("delta proxy positivo; "); }
        }
        if (velocity > 0.35) { s += 2; r.append("velocity attiva; "); }
        if (spread < 0.08) { s += 1; r.append("spread ok; "); }
        if (r.isEmpty()) r.append("flow debole/misto");
        return new Flow(s, r.toString());
    }

    private void rememberMaster(String symbol, String side, TradingViewSignal tv) {
        if (side == null || side.equalsIgnoreCase("UNKNOWN")) return;
        activeSetups.put(symbol, new ActiveSetup(side.toUpperCase(), Instant.now(), tv.safeEntry(), tv.safeSl()));
    }

    private String clean(String v, String fallback) { return v == null || v.isBlank() ? fallback : v.trim(); }

    private record Flow(int score, String reason) {}
    private record ActiveSetup(String side, Instant time, double entry, double sl) {
        boolean isOpposite(String other) {
            if (other == null) return false;
            return (side.equals("LONG") && other.toUpperCase().contains("SHORT")) || (side.equals("SHORT") && other.toUpperCase().contains("LONG"));
        }
        boolean isFresh(Duration d) { return Instant.now().minus(d).isBefore(time); }
    }
}
