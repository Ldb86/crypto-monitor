package com.maradona.cluster;

import com.maradona.bybit.MarketState;
import com.maradona.config.MaradonaProperties;
import com.maradona.model.ExchangeSnapshot;
import com.maradona.model.MarketSnapshot;
import com.maradona.model.TradingViewSignal;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
public class AutoClusterService {
    private final MarketState marketState;
    private final MaradonaProperties props;
    private final Map<String, OperationalMap> memory = new ConcurrentHashMap<>();

    public AutoClusterService(MarketState marketState, MaradonaProperties props) {
        this.marketState = marketState;
        this.props = props;
    }

    /**
     * Comando manuale/debug: costruisce live solo quando richiesto dall'utente o endpoint.
     * Non crea polling continuo.
     */
    public AutoClusterLevels buildLevels(String symbol) {
        return buildLevelsLive(symbol);
    }

    /**
     * Motore event-driven: viene chiamato solo quando arriva READY/MASTER da TradingView.
     * Usa memoria + TTL + cooldown + refresh su cambio zona prezzo.
     */
    public OperationalMap prepareForSignal(TradingViewSignal signal, String trigger) {
        if (signal == null) return OperationalMap.empty("UNKNOWN", "UNKNOWN", "UNKNOWN", "NO_SIGNAL");
        if (!props.getAutoCluster().isEnabled()) return OperationalMap.empty(signal.symbol(), signal.tf(), signal.safeSide(), "AUTO_CLUSTER_DISABLED");
        String normalized = marketState.normalizeBybitSymbol(signal.symbol());
        String tf = clean(signal.tf(), "NA");
        String side = signal.safeSide().toUpperCase(Locale.ROOT);
        String key = memoryKey(normalized, tf, side);
        Instant now = Instant.now();
        OperationalMap cached = memory.get(key);

        double currentMid = currentMid(normalized);
        if (cached != null && isUsable(cached, signal, currentMid, now)) {
            System.out.println("AUTO CLUSTER CACHE USED: " + key + " age=" + Duration.between(cached.updatedAt(), now).toMinutes() + "m");
            return cached.withSource(cached.source() + "+CACHE_REUSED");
        }

        AutoClusterLevels levels = buildLevelsLive(normalized);
        OperationalMap map = buildOperationalMap(signal, levels, trigger == null ? signal.safeSignal() : trigger);
        memory.put(key, map);
        System.out.println("AUTO CLUSTER MAP BUILT: " + shortSummary(map));
        return map;
    }

    public OperationalMap getPreparedMap(TradingViewSignal signal) {
        if (signal == null) return null;
        String normalized = marketState.normalizeBybitSymbol(signal.symbol());
        String key = memoryKey(normalized, clean(signal.tf(), "NA"), signal.safeSide().toUpperCase(Locale.ROOT));
        return memory.get(key);
    }

    public boolean shouldNotifySignal(TradingViewSignal signal) {
        if (signal == null) return false;
        String sig = signal.safeSignal().toUpperCase(Locale.ROOT);
        if (sig.contains("MASTER")) return true;
        if (sig.contains("READY")) return props.getNotifications().isNotifyReady();
        if (sig.contains("PRE")) return props.getNotifications().isNotifyPre();
        if (sig.contains("WARNING") || sig.contains("PROTECT") || sig.contains("RISK")) return props.getNotifications().isNotifyWarning();
        return props.getNotifications().isNotifyOther();
    }

    public AutoClusterCheck evaluate(TradingViewSignal signal, double brainEntry) {
        if (signal == null) return AutoClusterCheck.none();
        OperationalMap opMap = prepareForSignal(signal, "EVALUATE_" + signal.safeSignal());
        AutoClusterLevels levels = opMap.levels();
        if (levels == null || (levels.above().isEmpty() && levels.below().isEmpty())) return AutoClusterCheck.none(levels);

        String side = signal.safeSide().toUpperCase(Locale.ROOT);
        boolean isLong = side.contains("LONG");
        boolean isShort = side.contains("SHORT");
        if (!isLong && !isShort) return new AutoClusterCheck("NEUTRO", "CLUSTER AUTO: NEUTRO", 0.0, "Direzione TradingView non chiara.", false, levels, opMap);

        double entryLow = signal.safeEntryRangeLow();
        double entryHigh = signal.safeEntryRangeHigh();
        double tp1 = signal.safeTp1();
        double tp2 = signal.safeTp2();
        double tp3 = signal.safeTp3();
        double sl = signal.safeSl();

        List<Double> above = prices(levels.above());
        List<Double> below = prices(levels.below());
        Double entryCluster = clusterInsideRange(isShort ? above : below, entryLow, entryHigh);
        Double targetCluster = nearestClusterToAny(isShort ? below : above, List.of(tp1, tp2, tp3), 0.35);
        Double riskCluster = nearestClusterTo(sl, isShort ? above : below, 0.35);

        if (targetCluster != null) {
            String dir = isShort ? "SHORT" : "LONG";
            return new AutoClusterCheck("CONFERMA_" + dir, "CLUSTER AUTO: CONFERMA " + dir, targetCluster,
                    "Cluster event-driven vicino ai target. " + opMap.confluenceSummary(), true, levels, opMap);
        }
        if (entryCluster != null) {
            return new AutoClusterCheck("CONFERMA_ENTRY_RANGE", "CLUSTER AUTO: CONFERMA ZONA ENTRY", entryCluster,
                    "Cluster automatico dentro entry range: zona utile per retest/entry. " + opMap.confluenceSummary(), true, levels, opMap);
        }
        if (riskCluster != null) {
            return new AutoClusterCheck("WARNING", "CLUSTER AUTO: WARNING", riskCluster,
                    "Cluster automatico vicino allo stop: attenzione a squeeze/fakeout. " + opMap.confluenceSummary(), false, levels, opMap);
        }
        return new AutoClusterCheck("NEUTRO", "CLUSTER AUTO: NEUTRO", 0.0,
                "Nessun cluster automatico vicino a entry range, target o stop. " + opMap.confluenceSummary(), false, levels, opMap);
    }

    public double entryCandidateFromAutoClusters(TradingViewSignal signal) {
        if (signal == null) return 0.0;
        OperationalMap map = prepareForSignal(signal, "ENTRY_CANDIDATE_" + signal.safeSignal());
        AutoClusterLevels levels = map.levels();
        double low = signal.safeEntryRangeLow();
        double high = signal.safeEntryRangeHigh();
        if (levels == null || low <= 0 || high <= 0 || high < low) return 0.0;
        String side = signal.safeSide().toUpperCase(Locale.ROOT);
        List<Double> relevant = side.contains("SHORT") ? prices(levels.above()) : side.contains("LONG") ? prices(levels.below()) : List.of();
        Double inside = clusterInsideRange(relevant, low, high);
        return inside == null ? 0.0 : inside;
    }

    public String formatLevels(AutoClusterLevels levels) {
        if (levels == null) return "Cluster automatici non disponibili.";
        return "CLUSTER AUTO " + levels.symbol() + "\n" +
                "Mid: " + round(levels.mid()) + "\n" +
                "Above: " + formatClusterList(levels.above()) + "\n" +
                "Below: " + formatClusterList(levels.below()) + "\n" +
                "Fonte: " + levels.source() + "\n" +
                "Aggiornato: " + levels.updatedAt();
    }

    public String formatOperationalMap(OperationalMap map) {
        if (map == null || map.levels() == null) return "Mappa operativa AutoCluster non disponibile.";
        StringBuilder b = new StringBuilder();
        b.append("MAPPA OPERATIVA AUTOCLUSTER 0.4.7 EVENT-DRIVEN\n");
        b.append("Symbol: ").append(map.symbol()).append("\n");
        b.append("TF: ").append(map.tf()).append("\n");
        b.append("Side: ").append(map.side()).append("\n");
        b.append("Trigger: ").append(map.trigger()).append("\n");
        b.append("Mid: ").append(round(map.levels().mid())).append("\n");
        b.append("Above: ").append(formatClusterList(map.levels().above())).append("\n");
        b.append("Below: ").append(formatClusterList(map.levels().below())).append("\n");
        b.append("Target: ").append(formatMapLines(map.targets())).append("\n");
        b.append("Protection/Invalidazione: ").append(formatMapLines(map.protections())).append("\n");
        if (map.estimatedPivot() > 0) b.append("Pivot stimato TF: ").append(round(map.estimatedPivot())).append("\n");
        if (map.retailLiquidityPool() > 0) b.append("Retail liquidity pool: ").append(round(map.retailLiquidityPool())).append("\n");
        if (map.protectiveStopEstimate() > 0) b.append("Our SL protettivo stimato: ").append(round(map.protectiveStopEstimate())).append("\n");
        if (map.stopWarning() != null && !map.stopWarning().isBlank()) b.append("Warning SL: ").append(map.stopWarning()).append("\n");
        b.append("Confluenza: ").append(map.confluenceSummary()).append("\n");
        b.append("Aggiornato: ").append(map.updatedAt()).append("\n");
        b.append("Source: ").append(map.source());
        return b.toString();
    }

    public String shortSummary(OperationalMap map) {
        if (map == null || map.levels() == null) return "NO_MAP";
        return map.symbol() + " " + map.tf() + " " + map.side() + " " +
                "above=" + map.levels().above().size() + " below=" + map.levels().below().size() +
                " target=" + firstPrice(map.targets()) + " protection=" + firstPrice(map.protections()) +
                " retailPool=" + round(map.retailLiquidityPool()) + " ourSL=" + round(map.protectiveStopEstimate()) +
                " trigger=" + map.trigger();
    }

    private boolean isUsable(OperationalMap cached, TradingViewSignal signal, double currentMid, Instant now) {
        if (cached == null || cached.updatedAt() == null) return false;
        long ageMin = Duration.between(cached.updatedAt(), now).toMinutes();
        long ttl = dynamicTtlMinutes(signal);
        if (ageMin > ttl) return false;
        if (ageMin <= Math.max(0, props.getAutoCluster().getCooldownMinutes())) return true;
        double cachedMid = cached.levels() == null ? 0.0 : cached.levels().mid();
        double threshold = Math.max(0.05, props.getAutoCluster().getRefreshOnPriceMovePercent());
        if (cachedMid > 0 && currentMid > 0) {
            double movePct = Math.abs(currentMid - cachedMid) / cachedMid * 100.0;
            return movePct < threshold;
        }
        return true;
    }

    private long dynamicTtlMinutes(TradingViewSignal signal) {
        if (!props.getAutoCluster().isDynamicTtlEnabled()) return Math.max(1, props.getAutoCluster().getTtlMinutes());
        String tf = clean(signal == null ? null : signal.tf(), "").toLowerCase(Locale.ROOT).replace("m", "").replace(" ", "");
        try {
            if (tf.endsWith("h")) {
                int h = Integer.parseInt(tf.substring(0, tf.length() - 1));
                if (h >= 4) return 240;
                if (h >= 2) return 180;
                return 120;
            }
            int minutes = Integer.parseInt(tf);
            if (minutes <= 5) return 30;
            if (minutes <= 15) return 45;
            if (minutes <= 30) return 60;
            return 120;
        } catch (Exception ignored) {
            return Math.max(1, props.getAutoCluster().getTtlMinutes());
        }
    }

    private AutoClusterLevels buildLevelsLive(String symbol) {
        String normalized = marketState.normalizeBybitSymbol(symbol);
        Collection<ExchangeSnapshot> snapshots = marketState.getAllExchanges(normalized);
        if (snapshots == null || snapshots.isEmpty()) {
            return new AutoClusterLevels(normalized, 0.0, List.of(), List.of(), Instant.now(), "NO_EXCHANGE_DATA");
        }

        double mid = snapshots.stream()
                .map(ExchangeSnapshot::market)
                .filter(Objects::nonNull)
                .mapToDouble(MarketSnapshot::mid)
                .filter(v -> v > 0)
                .average()
                .orElse(0.0);

        List<Candidate> candidates = new ArrayList<>();
        for (ExchangeSnapshot snapshot : snapshots) {
            if (snapshot == null || snapshot.market() == null) continue;
            MarketSnapshot m = snapshot.market();
            addCandidate(candidates, normalized, snapshot.exchange(), m.strongestBidPrice(), m.strongestBidQty(), mid, "BID_WALL");
            addCandidate(candidates, normalized, snapshot.exchange(), m.strongestAskPrice(), m.strongestAskQty(), mid, "ASK_WALL");
            if (snapshot.hasFreshLiquidation(900) && snapshot.liquidationPrice() > 0) {
                addCandidate(candidates, normalized, snapshot.exchange(), snapshot.liquidationPrice(), 2.0, mid,
                        snapshot.liquidationBias() == null ? "LIQ" : snapshot.liquidationBias());
            }
        }

        List<ClusterLevel> merged = mergeNearby(candidates, mid, props.getAutoCluster().getMergeTolerancePct());
        int aboveN = Math.max(1, props.getAutoCluster().getLevelsAbove());
        int belowN = Math.max(1, props.getAutoCluster().getLevelsBelow());
        List<ClusterLevel> belowRaw = merged.stream()
                .filter(c -> mid <= 0 || c.price() < mid)
                .sorted(Comparator.comparingDouble(ClusterLevel::score).reversed())
                .limit(belowN)
                .collect(Collectors.toList());
        List<ClusterLevel> aboveRaw = merged.stream()
                .filter(c -> mid <= 0 || c.price() > mid)
                .sorted(Comparator.comparingDouble(ClusterLevel::score).reversed())
                .limit(aboveN)
                .collect(Collectors.toList());

        List<ClusterLevel> below = fillMissingLevels(belowRaw, mid, false, belowN).stream()
                .sorted(Comparator.comparingDouble(ClusterLevel::price).reversed())
                .collect(Collectors.toUnmodifiableList());
        List<ClusterLevel> above = fillMissingLevels(aboveRaw, mid, true, aboveN).stream()
                .sorted(Comparator.comparingDouble(ClusterLevel::price))
                .collect(Collectors.toUnmodifiableList());

        return new AutoClusterLevels(normalized, mid, above, below, Instant.now(), "EVENT_DRIVEN_LIVE_ORDERBOOK_EXCHANGE_CLUSTERS");
    }

    private OperationalMap buildOperationalMap(TradingViewSignal signal, AutoClusterLevels levels, String trigger) {
        String side = signal.safeSide().toUpperCase(Locale.ROOT);
        boolean isShort = side.contains("SHORT");
        boolean isLong = side.contains("LONG");
        double entryRef = referenceEntry(signal);
        List<ClusterLevel> targets = directionalLevels(isShort ? safeLevels(levels.below()) : safeLevels(levels.above()), entryRef, isLong, isShort, true);
        List<ClusterLevel> protections = directionalLevels(isShort ? safeLevels(levels.above()) : safeLevels(levels.below()), entryRef, isLong, isShort, false);
        double pivot = estimatePivot(signal);
        double retailPool = estimateRetailLiquidityPool(signal, protections, entryRef);
        double protectiveStop = estimateProtectiveStopBeyondRetailPool(signal, retailPool, entryRef);
        String stopWarning = buildStopWarning(signal, retailPool, protectiveStop, entryRef);

        List<MapLine> targetLines = classifyLines(targets, "TARGET_" + (isShort ? "SHORT" : "LONG"), pivot, retailPool, true);
        List<MapLine> protectionLines = classifyLines(protections, isShort ? "RESISTENZA_INVALIDAZIONE" : "SUPPORTO_INVALIDAZIONE", pivot, retailPool, false);
        String summary = buildConfluenceSummary(targetLines, protectionLines, pivot, retailPool, protectiveStop, stopWarning);
        return new OperationalMap(levels.symbol(), clean(signal.tf(), "NA"), side, trigger, levels,
                targetLines, protectionLines, pivot, retailPool, protectiveStop, stopWarning, summary, Instant.now(), "ON_SIGNAL_MEMORY");
    }

    private List<MapLine> classifyLines(List<ClusterLevel> levels, String role, double pivot, double retailStop, boolean target) {
        if (levels == null || levels.isEmpty()) return List.of();
        return levels.stream()
                .sorted(Comparator.comparingDouble(ClusterLevel::score).reversed())
                .map(c -> {
                    int score = scoreLevel(c, pivot, retailStop, target);
                    String why = c.exchangeCount() + "/3 exchange" +
                            (pivot > 0 && pctDistance(c.price(), pivot) <= 0.35 ? " + vicino pivot TF" : "") +
                            (retailStop > 0 && pctDistance(c.price(), retailStop) <= 0.35 ? " + vicino retail liquidity pool" : "") +
                            " + " + c.sources();
                    return new MapLine(c.price(), score, role, why, c.exchanges());
                })
                .limit(3)
                .toList();
    }

    private int scoreLevel(ClusterLevel c, double pivot, double retailStop, boolean target) {
        double raw = Math.min(60.0, c.score() * 10.0);
        raw += Math.min(20.0, c.exchangeCount() * 7.0);
        if (pivot > 0 && pctDistance(c.price(), pivot) <= 0.35) raw += 10.0;
        if (retailStop > 0 && pctDistance(c.price(), retailStop) <= 0.35) raw += target ? 5.0 : 12.0;
        return (int) Math.max(1, Math.min(100, Math.round(raw)));
    }

    private String buildConfluenceSummary(List<MapLine> targets, List<MapLine> protections, double pivot, double retailPool, double protectiveStop, String stopWarning) {
        String target = firstPrice(targets);
        String protection = firstPrice(protections);
        StringBuilder b = new StringBuilder();
        if (!"-".equals(target)) b.append("target ").append(target);
        if (!"-".equals(protection)) {
            if (!b.isEmpty()) b.append("; ");
            b.append("invalidazione/protezione ").append(protection);
        }
        if (pivot > 0) {
            if (!b.isEmpty()) b.append("; ");
            b.append("pivot stimato ").append(round(pivot));
        }
        if (retailPool > 0) {
            if (!b.isEmpty()) b.append("; ");
            b.append("retail liquidity pool ").append(round(retailPool));
        }
        if (protectiveStop > 0) {
            if (!b.isEmpty()) b.append("; ");
            b.append("our SL protettivo stimato ").append(round(protectiveStop));
        }
        if (stopWarning != null && !stopWarning.isBlank()) {
            if (!b.isEmpty()) b.append("; ");
            b.append(stopWarning);
        }
        return b.isEmpty() ? "nessuna confluenza forte" : b.toString();
    }

    private double estimatePivot(TradingViewSignal signal) {
        double entry = signal.safeEntry();
        double sl = signal.safeSl();
        double tp1 = signal.safeTp1();
        if (entry > 0 && sl > 0 && tp1 > 0) return (entry + sl + tp1) / 3.0;
        double low = signal.safeEntryRangeLow();
        double high = signal.safeEntryRangeHigh();
        if (low > 0 && high > 0 && high >= low) return (low + high) / 2.0;
        return entry;
    }

    private double estimateRetailLiquidityPool(TradingViewSignal signal, List<ClusterLevel> protections, double entryRef) {
        // Il retail liquidity pool NON e' il nostro stop.
        // Per LONG deve essere sotto entry; per SHORT deve essere sopra entry.
        // Se il cluster e' dalla parte opposta, diventa target/magnete, non pool per SL.
        String side = signal.safeSide().toUpperCase(Locale.ROOT);
        if (protections != null && !protections.isEmpty()) {
            for (ClusterLevel c : protections) {
                if (c == null || c.price() <= 0) continue;
                if (side.contains("LONG") && entryRef > 0 && c.price() < entryRef) return c.price();
                if (side.contains("SHORT") && entryRef > 0 && c.price() > entryRef) return c.price();
            }
        }
        double tvSl = signal.safeSl();
        if (tvSl > 0) {
            if (side.contains("LONG") && (entryRef <= 0 || tvSl < entryRef)) return tvSl;
            if (side.contains("SHORT") && (entryRef <= 0 || tvSl > entryRef)) return tvSl;
        }
        return 0.0;
    }

    private double estimateProtectiveStopBeyondRetailPool(TradingViewSignal signal, double retailPool, double entryRef) {
        String side = signal.safeSide().toUpperCase(Locale.ROOT);
        if (retailPool <= 0) return directionallyValidStop(signal.safeSl(), side, entryRef) ? signal.safeSl() : 0.0;
        double pctBuffer = 0.20; // buffer minimo 0.20% oltre la massa retail
        if (entryRef > 0 && Math.abs(entryRef - retailPool) / Math.max(1.0, entryRef) * 100.0 > 1.0) pctBuffer = 0.30;
        double candidate;
        if (side.contains("LONG")) {
            candidate = retailPool * (1.0 - pctBuffer / 100.0);
            return directionallyValidStop(candidate, side, entryRef) ? candidate : 0.0;
        }
        if (side.contains("SHORT")) {
            candidate = retailPool * (1.0 + pctBuffer / 100.0);
            return directionallyValidStop(candidate, side, entryRef) ? candidate : 0.0;
        }
        return directionallyValidStop(signal.safeSl(), side, entryRef) ? signal.safeSl() : 0.0;
    }

    private String buildStopWarning(TradingViewSignal signal, double retailPool, double protectiveStop, double entryRef) {
        double tvSl = signal.safeSl();
        String side = signal.safeSide().toUpperCase(Locale.ROOT);
        List<String> warnings = new ArrayList<>();
        if (tvSl > 0 && !directionallyValidStop(tvSl, side, entryRef)) {
            warnings.add("SL TradingView non direzionale per " + side + ": controllare prima di operare");
        }
        if (protectiveStop <= 0 && retailPool > 0) {
            warnings.add("Our SL protettivo non calcolabile in modo direzionale: pool retail dalla parte sbagliata o troppo vicino alla entry");
        }
        if (retailPool > 0 && tvSl > 0 && pctDistance(tvSl, retailPool) <= 0.12) {
            if (side.contains("LONG")) warnings.add("SL TradingView troppo vicino al retail liquidity pool: nostro SL dovrebbe stare sotto il pool, stimato " + round(protectiveStop));
            else if (side.contains("SHORT")) warnings.add("SL TradingView troppo vicino al retail liquidity pool: nostro SL dovrebbe stare sopra il pool, stimato " + round(protectiveStop));
            else warnings.add("SL TradingView vicino al retail liquidity pool: distinguere stop nostro da stop retail");
        }
        return String.join("; ", warnings);
    }

    private double referenceEntry(TradingViewSignal signal) {
        if (signal.safeEntry() > 0) return signal.safeEntry();
        double low = signal.safeEntryRangeLow();
        double high = signal.safeEntryRangeHigh();
        if (low > 0 && high > 0 && high >= low) return (low + high) / 2.0;
        return 0.0;
    }

    private boolean directionallyValidStop(double stop, String side, double entryRef) {
        if (stop <= 0 || entryRef <= 0 || side == null) return stop > 0;
        String s = side.toUpperCase(Locale.ROOT);
        if (s.contains("LONG")) return stop < entryRef;
        if (s.contains("SHORT")) return stop > entryRef;
        return true;
    }

    private List<ClusterLevel> directionalLevels(List<ClusterLevel> levels, double entryRef, boolean isLong, boolean isShort, boolean target) {
        if (levels == null || levels.isEmpty() || entryRef <= 0) return levels == null ? List.of() : levels;
        return levels.stream().filter(c -> {
                    if (c == null || c.price() <= 0) return false;
                    if (isLong && target) return c.price() > entryRef;
                    if (isLong) return c.price() < entryRef;
                    if (isShort && target) return c.price() < entryRef;
                    if (isShort) return c.price() > entryRef;
                    return true;
                })
                .toList();
    }

    private double currentMid(String symbol) {
        Collection<ExchangeSnapshot> snapshots = marketState.getAllExchanges(symbol);
        if (snapshots == null || snapshots.isEmpty()) return 0.0;
        return snapshots.stream().map(ExchangeSnapshot::market).filter(Objects::nonNull)
                .mapToDouble(MarketSnapshot::mid).filter(v -> v > 0).average().orElse(0.0);
    }

    private String memoryKey(String symbol, String tf, String side) {
        return clean(symbol, "UNKNOWN").toUpperCase(Locale.ROOT) + "|" + clean(tf, "NA").toUpperCase(Locale.ROOT) + "|" + clean(side, "UNKNOWN").toUpperCase(Locale.ROOT);
    }

    private void addCandidate(List<Candidate> out, String symbol, String exchange, double price, double qty, double mid, String source) {
        if (price <= 0 || qty <= 0) return;
        if (mid > 0) {
            double distancePct = Math.abs(price - mid) / mid * 100.0;
            if (distancePct > Math.max(0.1, props.getAutoCluster().getMaxDistancePct())) return;
        }
        double score = Math.max(0.1, qty);
        if (source != null && source.contains("LIQ")) score += 5.0;
        out.add(new Candidate(symbol, exchange == null ? "UNKNOWN" : exchange, price, score, source == null ? "BOOK" : source));
    }

    private List<ClusterLevel> fillMissingLevels(List<ClusterLevel> source, double mid, boolean above, int wanted) {
        List<ClusterLevel> out = new ArrayList<>();
        if (source != null) out.addAll(source);
        if (mid <= 0 || wanted <= 0) return out.stream().limit(Math.max(0, wanted)).toList();
        int step = 1;
        while (out.size() < wanted && step <= 8) {
            double pct = 0.35 * step;
            double price = above ? mid * (1.0 + pct / 100.0) : mid * (1.0 - pct / 100.0);
            final double p = price;
            boolean exists = out.stream().anyMatch(c -> pctDistance(c.price(), p) <= 0.05);
            if (!exists) {
                out.add(new ClusterLevel(price, 0.5, 0, "FALLBACK", "PRICE_LADDER_FILL"));
            }
            step++;
        }
        return out.stream().limit(wanted).toList();
    }

    private List<ClusterLevel> mergeNearby(List<Candidate> candidates, double mid, double tolerancePct) {
        if (candidates == null || candidates.isEmpty()) return List.of();
        List<Candidate> sorted = candidates.stream()
                .filter(c -> c.price() > 0)
                .sorted(Comparator.comparingDouble(Candidate::price))
                .toList();
        List<ClusterLevel> out = new ArrayList<>();
        List<Candidate> bucket = new ArrayList<>();
        for (Candidate c : sorted) {
            if (bucket.isEmpty()) { bucket.add(c); continue; }
            double bucketAvg = weightedPrice(bucket);
            double base = mid > 0 ? mid : Math.max(1.0, bucketAvg);
            double pct = Math.abs(c.price() - bucketAvg) / base * 100.0;
            if (pct <= tolerancePct) bucket.add(c);
            else { out.add(toCluster(bucket)); bucket.clear(); bucket.add(c); }
        }
        if (!bucket.isEmpty()) out.add(toCluster(bucket));
        return out.stream().filter(c -> c.score() >= 0.1).sorted(Comparator.comparingDouble(ClusterLevel::score).reversed()).toList();
    }

    private ClusterLevel toCluster(List<Candidate> bucket) {
        double score = bucket.stream().mapToDouble(Candidate::score).sum();
        double price = weightedPrice(bucket);
        long exchangeCount = bucket.stream().map(Candidate::exchange).distinct().count();
        String exchanges = bucket.stream().map(Candidate::exchange).distinct().sorted().collect(Collectors.joining("+"));
        String sources = bucket.stream().map(Candidate::source).distinct().sorted().collect(Collectors.joining("+"));
        return new ClusterLevel(price, score, (int) exchangeCount, exchanges, sources);
    }

    private double weightedPrice(List<Candidate> bucket) {
        double w = bucket.stream().mapToDouble(Candidate::score).sum();
        if (w <= 0) return bucket.stream().mapToDouble(Candidate::price).average().orElse(0.0);
        return bucket.stream().mapToDouble(c -> c.price() * c.score()).sum() / w;
    }

    private List<Double> prices(List<ClusterLevel> levels) {
        if (levels == null) return List.of();
        return levels.stream().map(ClusterLevel::price).toList();
    }

    private List<ClusterLevel> safeLevels(List<ClusterLevel> levels) { return levels == null ? List.of() : levels; }

    private Double clusterInsideRange(List<Double> levels, double low, double high) {
        if (levels == null || levels.isEmpty() || low <= 0 || high <= 0 || high < low) return null;
        double mid = (low + high) / 2.0;
        return levels.stream().filter(v -> v >= low && v <= high).min(Comparator.comparingDouble(v -> Math.abs(v - mid))).orElse(null);
    }

    private Double nearestClusterToAny(List<Double> clusters, List<Double> targets, double maxPct) {
        if (clusters == null || targets == null) return null;
        Double best = null; double bestPct = Double.MAX_VALUE;
        for (Double t : targets) {
            if (t == null || t <= 0) continue;
            Double c = nearestClusterTo(t, clusters, maxPct);
            if (c == null) continue;
            double pct = pctDistance(t, c);
            if (pct < bestPct) { best = c; bestPct = pct; }
        }
        return best;
    }

    private Double nearestClusterTo(double target, List<Double> clusters, double maxPct) {
        if (target <= 0 || clusters == null || clusters.isEmpty()) return null;
        Double best = null; double bestPct = Double.MAX_VALUE;
        for (Double c : clusters) {
            if (c == null || c <= 0) continue;
            double pct = pctDistance(target, c);
            if (pct <= maxPct && pct < bestPct) { best = c; bestPct = pct; }
        }
        return best;
    }

    private double pctDistance(double a, double b) {
        double base = Math.max(1.0, Math.abs(a));
        return Math.abs(a - b) / base * 100.0;
    }

    private String formatClusterList(List<ClusterLevel> levels) {
        if (levels == null || levels.isEmpty()) return "-";
        return levels.stream()
                .map(c -> round(c.price()) + " score " + Math.round(c.score()) + " [" + c.exchangeCount() + "/3 " + c.exchanges() + " " + c.sources() + "]")
                .collect(Collectors.joining(", "));
    }

    private String formatMapLines(List<MapLine> lines) {
        if (lines == null || lines.isEmpty()) return "-";
        return lines.stream().map(l -> round(l.price()) + " score " + l.score() + " (" + l.role() + ")").collect(Collectors.joining(", "));
    }

    private String firstPrice(List<MapLine> lines) {
        if (lines == null || lines.isEmpty()) return "-";
        return round(lines.get(0).price()) + " score " + lines.get(0).score();
    }

    private String clean(String v, String fallback) { return v == null || v.isBlank() ? fallback : v.trim(); }
    private String round(double v) { return String.format(Locale.US, "%.4f", v); }

    private record Candidate(String symbol, String exchange, double price, double score, String source) {}

    public record ClusterLevel(double price, double score, int exchangeCount, String exchanges, String sources) {}
    public record AutoClusterLevels(String symbol, double mid, List<ClusterLevel> above, List<ClusterLevel> below, Instant updatedAt, String source) {}
    public record MapLine(double price, int score, String role, String reason, String exchanges) {}
    public record OperationalMap(String symbol, String tf, String side, String trigger, AutoClusterLevels levels,
                                 List<MapLine> targets, List<MapLine> protections, double estimatedPivot,
                                 double retailLiquidityPool, double protectiveStopEstimate, String stopWarning, String confluenceSummary, Instant updatedAt, String source) {
        public static OperationalMap empty(String symbol, String tf, String side, String trigger) {
            return new OperationalMap(symbol, tf, side, trigger, null, List.of(), List.of(), 0.0, 0.0, 0.0, "", "nessun dato", Instant.now(), "EMPTY");
        }
        public OperationalMap withSource(String newSource) {
            return new OperationalMap(symbol, tf, side, trigger, levels, targets, protections, estimatedPivot, retailLiquidityPool, protectiveStopEstimate, stopWarning, confluenceSummary, updatedAt, newSource);
        }
    }
    public record AutoClusterCheck(String status, String friendlyLine, double nearestLevel, String reason, boolean confirms, AutoClusterLevels levels, OperationalMap map) {
        public static AutoClusterCheck none() {
            return new AutoClusterCheck("NOT_SET", "CLUSTER AUTO: NON DISPONIBILE", 0.0, "Nessun dato exchange disponibile.", false, null, null);
        }
        public static AutoClusterCheck none(AutoClusterLevels levels) {
            return new AutoClusterCheck("NOT_SET", "CLUSTER AUTO: NON DISPONIBILE", 0.0, "Nessun cluster automatico disponibile.", false, levels, null);
        }
    }
}
