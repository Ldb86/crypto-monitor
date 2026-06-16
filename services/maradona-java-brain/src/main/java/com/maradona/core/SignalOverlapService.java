package com.maradona.core;

import com.maradona.config.MaradonaProperties;
import com.maradona.model.LiquidityDecision;
import com.maradona.model.TradingViewSignal;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class SignalOverlapService {
    private final MaradonaProperties props;
    private final Map<String, ActiveSignal> active = new ConcurrentHashMap<>();

    public SignalOverlapService(MaradonaProperties props) {
        this.props = props;
    }

    public OverlapCheck evaluateAndRemember(TradingViewSignal signal, Decision decision, LiquidityDecision liquidity) {
        if (signal == null) return OverlapCheck.notDuplicate();
        String sig = clean(signal.safeSignal()).toUpperCase(Locale.ROOT);
        boolean master = sig.contains("MASTER");
        if (!master) return OverlapCheck.notDuplicate();
        if (liquidity == null || !liquidity.confirmed()) return OverlapCheck.notDuplicate();
        if (decision == null || !decision.operative()) {
            // Micro GZ can be operative by liquidity confirmation even if the base decision title is not enough.
            if (!isMicro(signal)) return OverlapCheck.notDuplicate();
        }

        ActiveSignal current = ActiveSignal.from(signal);
        if (current.symbol().isBlank() || current.tf().isBlank() || current.side().isBlank()) return OverlapCheck.notDuplicate();
        String key = current.key();
        ActiveSignal previous = active.get(key);
        Instant now = Instant.now();
        int windowMinutes = Math.max(5, props.getNotifications().getDuplicateOverlapWindowMinutes());

        if (previous != null && previous.isFresh(now, Duration.ofMinutes(windowMinutes))) {
            OverlapMetrics metrics = compare(previous, current);
            boolean closeEntry = metrics.entryDistancePct() >= 0 && metrics.entryDistancePct() <= Math.max(0.01, props.getNotifications().getDuplicateEntryDistancePct());
            boolean overlapRange = metrics.rangeOverlapPct() >= Math.max(1.0, props.getNotifications().getDuplicateRangeOverlapPct());
            boolean closeStopsOrTargets = metrics.slDistancePct() >= 0 && metrics.slDistancePct() <= 0.35;
            boolean peleVsMaradona = previous.microGz() != current.microGz();
            boolean sameTradeIdea = closeEntry || overlapRange || closeStopsOrTargets;

            if (sameTradeIdea && (peleVsMaradona || props.getNotifications().isSuppressDuplicateEntries())) {
                String relation;
                if (previous.microGz() && !current.microGz()) relation = "Maradona conferma Pelé già attivo";
                else if (!previous.microGz() && current.microGz()) relation = "Pelé conferma Maradona già attivo";
                else relation = "Segnale duplicato su setup già attivo";
                return new OverlapCheck(true, relation, previous, current, metrics);
            }
        }

        active.put(key, current.withUpdatedAt(now));
        return OverlapCheck.notDuplicate();
    }

    public String formatDuplicateNote(OverlapCheck check) {
        if (check == null || !check.duplicate()) return "";
        ActiveSignal p = check.previous();
        ActiveSignal c = check.current();
        OverlapMetrics m = check.metrics();
        StringBuilder b = new StringBuilder();
        b.append("🔁 DUPLICATO / CONFLUENZA SETUP\n\n");
        b.append("PAIR: ").append(c.symbol()).append("\n");
        b.append("TF: ").append(c.tf()).append("\n");
        b.append("DIREZIONE: ").append(c.side()).append("\n\n");
        b.append(check.message()).append(".\n");
        b.append("Nessuna nuova entry completa inviata. Gestire il trade già attivo.\n\n");
        b.append("SETUP ATTIVO: ").append(p.setupName()).append("\n");
        b.append("Entry attiva: ").append(round(p.entry())).append(" | Range: ").append(round(p.rangeLow())).append(" - ").append(round(p.rangeHigh())).append("\n");
        b.append("SL attivo: ").append(round(p.sl())).append(" | TP1: ").append(round(p.tp1())).append("\n\n");
        b.append("NUOVO SEGNALE: ").append(c.setupName()).append("\n");
        b.append("Entry nuova: ").append(round(c.entry())).append(" | Range: ").append(round(c.rangeLow())).append(" - ").append(round(c.rangeHigh())).append("\n");
        b.append("Distanza entry: ").append(m.entryDistancePct() < 0 ? "n/d" : round(m.entryDistancePct()) + "%").append("\n");
        b.append("Overlap range: ").append(m.rangeOverlapPct() < 0 ? "n/d" : round(m.rangeOverlapPct()) + "%").append("\n\n");
        b.append("AZIONE:\nNon doppiare esposizione. Se il primo trade è già in profitto, proteggere/gestire TP.");
        return b.toString();
    }

    private OverlapMetrics compare(ActiveSignal p, ActiveSignal c) {
        double entryPct = pctDistance(p.entry(), c.entry());
        double slPct = pctDistance(p.sl(), c.sl());
        double rangeOverlap = rangeOverlapPct(p.rangeLow(), p.rangeHigh(), c.rangeLow(), c.rangeHigh());
        return new OverlapMetrics(entryPct, slPct, rangeOverlap);
    }

    private double rangeOverlapPct(double aLow, double aHigh, double bLow, double bHigh) {
        if (aLow <= 0 || aHigh <= 0 || bLow <= 0 || bHigh <= 0) return -1.0;
        if (aHigh < aLow) { double t = aLow; aLow = aHigh; aHigh = t; }
        if (bHigh < bLow) { double t = bLow; bLow = bHigh; bHigh = t; }
        double overlap = Math.max(0.0, Math.min(aHigh, bHigh) - Math.max(aLow, bLow));
        double minWidth = Math.max(0.0000001, Math.min(aHigh - aLow, bHigh - bLow));
        return Math.min(100.0, (overlap / minWidth) * 100.0);
    }

    private double pctDistance(double a, double b) {
        if (a <= 0 || b <= 0) return -1.0;
        double base = Math.max(1.0, Math.abs(a));
        return Math.abs(a - b) / base * 100.0;
    }

    private static boolean isMicro(TradingViewSignal s) {
        String sig = s.safeSignal().toUpperCase(Locale.ROOT);
        String setup = s.safeSetupFamily().toUpperCase(Locale.ROOT);
        return sig.contains("MASTER_PELE_MICRO_GZ") || setup.contains("MICRO_GZ");
    }

    private String clean(String v) { return v == null ? "" : v.trim(); }
    private String round(double v) { return String.format(Locale.US, "%.4f", v); }

    public record ActiveSignal(String symbol, String tf, String side, String signal, String setupName, boolean microGz,
                               double entry, double rangeLow, double rangeHigh, double sl, double tp1, double tp2, double tp3,
                               Instant updatedAt) {
        static ActiveSignal from(TradingViewSignal s) {
            String signal = s.safeSignal().toUpperCase(Locale.ROOT);
            boolean micro = isMicro(s);
            String setup = micro ? "MASTER_PELE_MICRO_GZ" : signal.contains("MASTER") ? "MARADONA_MASTER" : signal;
            double entry = s.safeEntry();
            double low = s.safeEntryRangeLow();
            double high = s.safeEntryRangeHigh();
            if (entry <= 0 && low > 0 && high > 0) entry = (low + high) / 2.0;
            return new ActiveSignal(norm(s.symbol()), cleanStatic(s.tf()), s.safeSide().toUpperCase(Locale.ROOT), signal, setup, micro,
                    entry, low, high, s.safeSl(), s.safeTp1(), s.safeTp2(), s.safeTp3(), Instant.now());
        }
        String key() { return symbol + "|" + tf + "|" + side; }
        boolean isFresh(Instant now, Duration maxAge) { return updatedAt != null && updatedAt.plus(maxAge).isAfter(now); }
        ActiveSignal withUpdatedAt(Instant now) { return new ActiveSignal(symbol, tf, side, signal, setupName, microGz, entry, rangeLow, rangeHigh, sl, tp1, tp2, tp3, now); }
        private static String norm(String s) {
            if (s == null) return "";
            return s.replace("BYBIT:", "").replace("BINANCE:", "").replace("OKX:", "")
                    .replace(".P", "").replace("PERP", "").replace("/", "")
                    .replace("-USDT-SWAP", "USDT").replace("-", "")
                    .trim().toUpperCase(Locale.ROOT);
        }
        private static String cleanStatic(String s) { return s == null ? "" : s.trim().toUpperCase(Locale.ROOT); }
    }

    public record OverlapMetrics(double entryDistancePct, double slDistancePct, double rangeOverlapPct) {}
    public record OverlapCheck(boolean duplicate, String message, ActiveSignal previous, ActiveSignal current, OverlapMetrics metrics) {
        static OverlapCheck notDuplicate() { return new OverlapCheck(false, "", null, null, new OverlapMetrics(-1.0, -1.0, -1.0)); }
    }
}
