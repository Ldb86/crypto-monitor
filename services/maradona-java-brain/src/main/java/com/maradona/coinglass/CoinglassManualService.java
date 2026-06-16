package com.maradona.coinglass;

import com.maradona.model.TradingViewSignal;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
public class CoinglassManualService {
    private final Map<String, ManualLevels> levelsBySymbol = new ConcurrentHashMap<>();
    private final Set<String> consumedManualClusters = ConcurrentHashMap.newKeySet();

    public ManualLevels setLevels(String symbol, List<Double> above, List<Double> below) {
        String s = normalizeSymbol(symbol);
        ManualLevels levels = new ManualLevels(s, cleanLevels(above), cleanLevels(below), Instant.now());
        levelsBySymbol.put(s, levels);
        consumedManualClusters.removeIf(k -> k.startsWith(s + "|"));
        return levels;
    }

    public ManualLevels getLevels(String symbol) {
        return levelsBySymbol.get(normalizeSymbol(symbol));
    }

    public ManualLevels clear(String symbol) {
        String s = normalizeSymbol(symbol);
        consumedManualClusters.removeIf(k -> k.startsWith(s + "|"));
        return levelsBySymbol.remove(s);
    }

    public List<String> checkTouchedLevels(String symbol, double price, String tf) {
        ManualLevels levels = getLevels(symbol);
        if (levels == null || price <= 0) return List.of();
        List<String> alerts = new ArrayList<>();
        double tolerancePct = 0.08;

        List<Double> above = levels.above() == null ? List.of() : levels.above();
        for (int i = 0; i < above.size(); i++) {
            double level = above.get(i);
            if (price >= level * (1.0 - tolerancePct / 100.0)) {
                String key = levels.symbol() + "|ABOVE|" + i + "|" + fmt(level);
                if (consumedManualClusters.add(key)) {
                    alerts.add(clusterTouchedMessage(levels.symbol(), tf, level, "ABOVE", i + 1));
                }
            }
        }

        List<Double> below = levels.below() == null ? List.of() : levels.below().stream()
                .sorted(Comparator.reverseOrder())
                .toList();
        for (int i = 0; i < below.size(); i++) {
            double level = below.get(i);
            if (price <= level * (1.0 + tolerancePct / 100.0)) {
                String key = levels.symbol() + "|BELOW|" + i + "|" + fmt(level);
                if (consumedManualClusters.add(key)) {
                    alerts.add(clusterTouchedMessage(levels.symbol(), tf, level, "BELOW", i + 1));
                }
            }
        }
        return alerts;
    }

    private String clusterTouchedMessage(String symbol, String tf, double level, String type, int index) {
        return "⚠️ CLUSTER MANUALE RAGGIUNTO / CONSUMATO\n\n" +
                "PAIR: " + symbol + "\n" +
                "TF/CONTESTO: " + (tf == null || tf.isBlank() ? "-" : tf) + "\n" +
                "LIVELLO: " + fmt(level) + "\n" +
                "TIPO: " + type + " " + index + "\n\n" +
                "AZIONE:\n" +
                "Liquidità manuale raggiunta/consumata. Aggiornare heatmap e /setcg " + shortSymbol(symbol) + ".";
    }

    private String shortSymbol(String symbol) {
        String s = normalizeSymbol(symbol);
        if (s.startsWith("BTC")) return "BTC";
        if (s.startsWith("ETH")) return "ETH";
        return s;
    }

    public CoinglassCheck evaluate(TradingViewSignal signal, double brainEntry) {
        if (signal == null) return CoinglassCheck.none();
        ManualLevels levels = getLevels(signal.symbol());
        if (levels == null) return CoinglassCheck.none();

        String side = signal.safeSide().toUpperCase(Locale.ROOT);
        boolean isLong = side.contains("LONG");
        boolean isShort = side.contains("SHORT");
        if (!isLong && !isShort) return new CoinglassCheck("NEUTRO", "COINGLASS: NEUTRO", 0.0, "Direzione non chiara.", false, levels);

        double entryLow = signal.safeEntryRangeLow();
        double entryHigh = signal.safeEntryRangeHigh();
        double entry = brainEntry > 0 ? brainEntry : signal.safeEntry();
        double tp1 = signal.safeTp1();
        double tp2 = signal.safeTp2();
        double tp3 = signal.safeTp3();
        double sl = signal.safeSl();

        Double clusterInRange = clusterInsideRange(isShort ? levels.above() : levels.below(), entryLow, entryHigh);
        Double targetCluster = nearestClusterToAny(isShort ? levels.below() : levels.above(), List.of(tp1, tp2, tp3), 0.45);
        Double riskCluster = nearestClusterTo(sl, isShort ? levels.above() : levels.below(), 0.45);

        if (targetCluster != null) {
            String dir = isShort ? "SHORT" : "LONG";
            return new CoinglassCheck("CONFERMA_" + dir, "COINGLASS: CONFERMA " + dir, targetCluster,
                    "Cluster manuale vicino ai target: liquidita coerente con il trade.", true, levels);
        }
        if (clusterInRange != null) {
            String dir = isShort ? "SHORT" : "LONG";
            return new CoinglassCheck("CONFERMA_ENTRY_RANGE", "COINGLASS: CONFERMA ZONA ENTRY", clusterInRange,
                    "Cluster manuale dentro l'entry range: zona utile per entry/retest.", true, levels);
        }
        if (riskCluster != null) {
            return new CoinglassCheck("WARNING", "COINGLASS: WARNING", riskCluster,
                    "Cluster manuale vicino allo stop: attenzione a squeeze/fakeout.", false, levels);
        }
        return new CoinglassCheck("NEUTRO", "COINGLASS: NEUTRO", 0.0,
                "Nessun cluster manuale vicino a entry range, target o stop.", false, levels);
    }

    public double entryCandidateFromCoinglass(TradingViewSignal signal) {
        if (signal == null) return 0.0;
        ManualLevels levels = getLevels(signal.symbol());
        if (levels == null) return 0.0;
        double low = signal.safeEntryRangeLow();
        double high = signal.safeEntryRangeHigh();
        if (low <= 0 || high <= 0 || high < low) return 0.0;
        String side = signal.safeSide().toUpperCase(Locale.ROOT);
        List<Double> relevant = side.contains("SHORT") ? levels.above() : side.contains("LONG") ? levels.below() : List.of();
        Double inside = clusterInsideRange(relevant, low, high);
        return inside == null ? 0.0 : inside;
    }

    public String normalizeSymbol(String symbol) {
        if (symbol == null) return "";
        String s = symbol.trim().toUpperCase(Locale.ROOT)
                .replace("BYBIT:", "")
                .replace("BINANCE:", "")
                .replace("OKX:", "")
                .replace(".P", "")
                .replace("PERP", "")
                .replace("/", "")
                .replace("-USDT-SWAP", "USDT")
                .replace("-", "");
        if (s.equals("BTC")) return "BTCUSDT";
        if (s.equals("ETH")) return "ETHUSDT";
        return s;
    }

    public String formatLevels(ManualLevels levels) {
        if (levels == null) return "Nessun livello Coinglass manuale salvato.";
        return "COINGLASS " + levels.symbol() + "\n" +
                "Above: " + fmtList(levels.above()) + "\n" +
                "Below: " + fmtList(levels.below()) + "\n" +
                "Aggiornato: " + levels.updatedAt();
    }

    private List<Double> cleanLevels(List<Double> raw) {
        if (raw == null) return List.of();
        return raw.stream()
                .filter(Objects::nonNull)
                .filter(v -> v > 0)
                .distinct()
                .sorted()
                .collect(Collectors.toUnmodifiableList());
    }

    private Double clusterInsideRange(List<Double> levels, double low, double high) {
        if (levels == null || levels.isEmpty() || low <= 0 || high <= 0 || high < low) return null;
        double mid = (low + high) / 2.0;
        return levels.stream()
                .filter(v -> v >= low && v <= high)
                .min(Comparator.comparingDouble(v -> Math.abs(v - mid)))
                .orElse(null);
    }

    private Double nearestClusterToAny(List<Double> clusters, List<Double> targets, double maxPct) {
        if (clusters == null || targets == null) return null;
        Double best = null;
        double bestPct = Double.MAX_VALUE;
        for (Double t : targets) {
            if (t == null || t <= 0) continue;
            Double c = nearestClusterTo(t, clusters, maxPct);
            if (c == null) continue;
            double pct = pctDistance(t, c);
            if (pct < bestPct) {
                best = c;
                bestPct = pct;
            }
        }
        return best;
    }

    private Double nearestClusterTo(double target, List<Double> clusters, double maxPct) {
        if (target <= 0 || clusters == null || clusters.isEmpty()) return null;
        Double best = null;
        double bestPct = Double.MAX_VALUE;
        for (Double c : clusters) {
            if (c == null || c <= 0) continue;
            double pct = pctDistance(target, c);
            if (pct <= maxPct && pct < bestPct) {
                best = c;
                bestPct = pct;
            }
        }
        return best;
    }

    private double pctDistance(double a, double b) {
        double base = Math.max(1.0, Math.abs(a));
        return Math.abs(a - b) / base * 100.0;
    }

    private String fmtList(List<Double> values) {
        if (values == null || values.isEmpty()) return "-";
        return values.stream().map(this::fmt).collect(Collectors.joining(", "));
    }

    private String fmt(double v) {
        return String.format(Locale.US, "%.4f", v);
    }

    public record ManualLevels(String symbol, List<Double> above, List<Double> below, Instant updatedAt) {}

    public record CoinglassCheck(String status, String friendlyLine, double nearestLevel, String reason, boolean confirms, ManualLevels levels) {
        public static CoinglassCheck none() {
            return new CoinglassCheck("NOT_SET", "COINGLASS: NON IMPOSTATO", 0.0,
                    "Nessun livello Coinglass manuale salvato per questo simbolo.", false, null);
        }
    }
}
