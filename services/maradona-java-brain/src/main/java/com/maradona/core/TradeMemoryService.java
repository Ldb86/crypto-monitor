package com.maradona.core;

import com.maradona.bybit.MarketState;
import com.maradona.model.ExchangeSnapshot;
import com.maradona.model.LiquidityDecision;
import com.maradona.model.MarketSnapshot;
import com.maradona.model.TradingViewSignal;
import com.maradona.telegram.TelegramNotifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class TradeMemoryService {
    private final MarketState marketState;
    private final TelegramNotifier telegram;

    @Value("${maradona.tradeMemory.enabled:true}")
    private boolean enabled;

    @Value("${maradona.notifications.notifyTpSl:true}")
    private boolean notifyTpSl;

    // J4 safety: never validate TP/SL on the same webhook event that created the trade.
    @Value("${maradona.tradeMemory.activationDelayMs:30000}")
    private long activationDelayMs;

    // J4 safety: a market price older than this is not valid for TP/SL.
    @Value("${maradona.tradeMemory.maxPriceAgeSeconds:15}")
    private long maxPriceAgeSeconds;

    // J4 safety: for BTC/ETH we prefer at least 2 fresh exchanges for hit validation.
    @Value("${maradona.tradeMemory.minPriceSources:2}")
    private int minPriceSources;

    // J4 safety: if MASTER entry is already too far from current market, do not activate trade memory.
    @Value("${maradona.tradeMemory.maxEntryDistancePct:1.50}")
    private double maxEntryDistancePct;

    // J4 safety: if true, active trade is created only when price is still in entry/no-chase zone.
    @Value("${maradona.tradeMemory.activateOnlyInEntryZone:true}")
    private boolean activateOnlyInEntryZone;

    // J4 safety tolerance around entry range when no-chase is missing.
    @Value("${maradona.tradeMemory.entryZoneTolerancePct:0.15}")
    private double entryZoneTolerancePct;

    private final Map<String, ActiveTrade> activeTrades = new ConcurrentHashMap<>();

    public TradeMemoryService(MarketState marketState, TelegramNotifier telegram) {
        this.marketState = marketState;
        this.telegram = telegram;
    }

    public void rememberIfConfirmedMaster(TradingViewSignal signal, LiquidityDecision liquidity, String source) {
        if (!enabled || signal == null || liquidity == null || !liquidity.confirmed()) return;
        String sig = signal.safeSignal().toUpperCase();
        if (!sig.contains("MASTER")) return;
        String side = signal.safeSide().toUpperCase();
        if (!side.contains("LONG") && !side.contains("SHORT")) return;
        double entry = signal.safeEntry();
        double sl = signal.safeSl();
        double tp1 = signal.safeTp1();
        double tp2 = signal.safeTp2();
        double tp3 = signal.safeTp3();
        if (entry <= 0 || sl <= 0) return;

        String setup = setupName(signal);
        String key = key(signal.symbol(), signal.tf(), side, setup);

        ValidationResult validation = validateBeforeActivation(signal, side, entry, sl, tp1, tp2, tp3);
        if (!validation.ok()) {
            System.out.println("ACTIVE TRADE MEMORY SKIPPED: " + key + " reason=" + validation.reason()
                    + " livePrice=" + round(validation.price())
                    + " sources=" + validation.sources()
                    + " entry=" + round(entry) + " sl=" + round(sl));
            return;
        }

        ActiveTrade current = activeTrades.get(key);
        Instant now = Instant.now();
        ActiveTrade next = new ActiveTrade(key, cleanSymbol(signal.symbol()), cleanTf(signal.tf()), side, setup,
                entry, sl, tp1, tp2, tp3, false, false, false, false,
                now, now.plusMillis(Math.max(0, activationDelayMs)), source == null ? sig : source,
                validation.price(), validation.sources());

        activeTrades.put(key, next);
        if (current == null) {
            System.out.println("ACTIVE TRADE MEMORY: remembered " + key + " entry=" + round(entry) + " sl=" + round(sl)
                    + " activationDelayMs=" + activationDelayMs
                    + " validationPrice=" + round(validation.price())
                    + " sources=" + validation.sources());
        } else {
            System.out.println("ACTIVE TRADE MEMORY: refreshed " + key + " entry=" + round(entry) + " sl=" + round(sl)
                    + " activationDelayMs=" + activationDelayMs
                    + " validationPrice=" + round(validation.price())
                    + " sources=" + validation.sources());
        }
    }

    @Scheduled(fixedDelayString = "${maradona.tradeMemory.pollMs:10000}")
    public void checkTpSlHits() {
        if (!enabled || !notifyTpSl || activeTrades.isEmpty()) return;
        Instant now = Instant.now();
        for (ActiveTrade trade : activeTrades.values()) {
            try {
                if (now.isBefore(trade.eligibleFrom())) {
                    continue;
                }
                PriceRead priceRead = consensusPrice(trade.symbol());
                if (!priceRead.valid()) {
                    System.out.println("ACTIVE TRADE MEMORY PRICE SKIPPED: " + trade.key()
                            + " reason=" + priceRead.reason()
                            + " sources=" + priceRead.sources());
                    continue;
                }
                double price = priceRead.price();
                if (trade.side().contains("LONG")) checkLong(trade, price, priceRead);
                else if (trade.side().contains("SHORT")) checkShort(trade, price, priceRead);
            } catch (Exception e) {
                System.out.println("ACTIVE TRADE MEMORY ERROR: " + e.getMessage());
            }
        }
    }

    private ValidationResult validateBeforeActivation(TradingViewSignal signal, String side, double entry, double sl, double tp1, double tp2, double tp3) {
        // Directional sanity first. If payload levels are impossible, do not start active trade memory.
        if (side.contains("LONG")) {
            if (sl >= entry) return ValidationResult.fail("LONG_SL_NOT_BELOW_ENTRY", 0, 0);
            if (tp1 > 0 && tp1 <= entry) return ValidationResult.fail("LONG_TP1_NOT_ABOVE_ENTRY", 0, 0);
            if (tp2 > 0 && tp2 <= entry) return ValidationResult.fail("LONG_TP2_NOT_ABOVE_ENTRY", 0, 0);
            if (tp3 > 0 && tp3 <= entry) return ValidationResult.fail("LONG_TP3_NOT_ABOVE_ENTRY", 0, 0);
        } else if (side.contains("SHORT")) {
            if (sl <= entry) return ValidationResult.fail("SHORT_SL_NOT_ABOVE_ENTRY", 0, 0);
            if (tp1 > 0 && tp1 >= entry) return ValidationResult.fail("SHORT_TP1_NOT_BELOW_ENTRY", 0, 0);
            if (tp2 > 0 && tp2 >= entry) return ValidationResult.fail("SHORT_TP2_NOT_BELOW_ENTRY", 0, 0);
            if (tp3 > 0 && tp3 >= entry) return ValidationResult.fail("SHORT_TP3_NOT_BELOW_ENTRY", 0, 0);
        }

        PriceRead live = consensusPrice(cleanSymbol(signal.symbol()));
        if (!live.valid()) return ValidationResult.fail("NO_FRESH_CONSENSUS_PRICE_" + live.reason(), live.price(), live.sources());
        double price = live.price();

        // Never create active memory if market is already beyond SL.
        if (side.contains("LONG") && price <= sl) return ValidationResult.fail("LIVE_PRICE_ALREADY_BELOW_SL", price, live.sources());
        if (side.contains("SHORT") && price >= sl) return ValidationResult.fail("LIVE_PRICE_ALREADY_ABOVE_SL", price, live.sources());

        double distPct = Math.abs(price - entry) / Math.max(1e-9, entry) * 100.0;
        if (distPct > maxEntryDistancePct) {
            return ValidationResult.fail("LIVE_PRICE_TOO_FAR_FROM_ENTRY_" + round(distPct) + "pct", price, live.sources());
        }

        if (activateOnlyInEntryZone) {
            if (side.contains("LONG")) {
                double upper = upperEntryGuard(signal, entry);
                if (upper > 0 && price > upper) return ValidationResult.fail("LIVE_PRICE_ABOVE_ENTRY_NO_CHASE_ZONE", price, live.sources());
            } else if (side.contains("SHORT")) {
                double lower = lowerEntryGuard(signal, entry);
                if (lower > 0 && price < lower) return ValidationResult.fail("LIVE_PRICE_BELOW_ENTRY_NO_CHASE_ZONE", price, live.sources());
            }
        }
        return ValidationResult.ok(price, live.sources());
    }

    private double upperEntryGuard(TradingViewSignal signal, double entry) {
        if (signal.safeNoChaseAbove() > 0) return signal.safeNoChaseAbove();
        if (signal.safeEntryRangeHigh() > 0) return signal.safeEntryRangeHigh() * (1.0 + entryZoneTolerancePct / 100.0);
        return entry * (1.0 + entryZoneTolerancePct / 100.0);
    }

    private double lowerEntryGuard(TradingViewSignal signal, double entry) {
        if (signal.safeNoChaseBelow() > 0) return signal.safeNoChaseBelow();
        if (signal.safeEntryRangeLow() > 0) return signal.safeEntryRangeLow() * (1.0 - entryZoneTolerancePct / 100.0);
        return entry * (1.0 - entryZoneTolerancePct / 100.0);
    }

    private PriceRead consensusPrice(String symbol) {
        String normalized = cleanSymbol(symbol);
        Collection<ExchangeSnapshot> all = marketState.getAllExchanges(normalized);
        List<Double> prices = new ArrayList<>();
        Instant now = Instant.now();
        if (all != null) {
            for (ExchangeSnapshot ex : all) {
                if (ex == null || ex.market() == null) continue;
                MarketSnapshot s = ex.market();
                if (s.mid() <= 0 || s.time() == null) continue;
                long age = Math.abs(Duration.between(s.time(), now).getSeconds());
                if (age > maxPriceAgeSeconds) continue;
                prices.add(s.mid());
            }
        }

        // Fallback to Bybit state only when minPriceSources allows one source.
        if (prices.isEmpty() && minPriceSources <= 1) {
            MarketSnapshot s = marketState.get(normalized);
            if (s != null && s.mid() > 0 && s.time() != null) {
                long age = Math.abs(Duration.between(s.time(), now).getSeconds());
                if (age <= maxPriceAgeSeconds) prices.add(s.mid());
            }
        }

        if (prices.size() < Math.max(1, minPriceSources)) {
            return PriceRead.invalid(prices.isEmpty() ? 0.0 : median(prices), prices.size(), "NOT_ENOUGH_FRESH_SOURCES");
        }
        return PriceRead.valid(median(prices), prices.size());
    }

    private double median(List<Double> values) {
        if (values == null || values.isEmpty()) return 0.0;
        Collections.sort(values);
        int n = values.size();
        if (n % 2 == 1) return values.get(n / 2);
        return (values.get(n / 2 - 1) + values.get(n / 2)) / 2.0;
    }

    private void checkLong(ActiveTrade t, double price, PriceRead priceRead) {
        if (!t.tp1Hit() && t.tp1() > 0 && price >= t.tp1()) markAndNotify(t, "TP1", price, priceRead);
        if (!t.tp2Hit() && t.tp2() > 0 && price >= t.tp2()) markAndNotify(t, "TP2", price, priceRead);
        if (!t.tp3Hit() && t.tp3() > 0 && price >= t.tp3()) markAndNotify(t, "TP3", price, priceRead);
        if (!t.slHit() && t.sl() > 0 && price <= t.sl()) markAndNotify(t, "SL", price, priceRead);
    }

    private void checkShort(ActiveTrade t, double price, PriceRead priceRead) {
        if (!t.tp1Hit() && t.tp1() > 0 && price <= t.tp1()) markAndNotify(t, "TP1", price, priceRead);
        if (!t.tp2Hit() && t.tp2() > 0 && price <= t.tp2()) markAndNotify(t, "TP2", price, priceRead);
        if (!t.tp3Hit() && t.tp3() > 0 && price <= t.tp3()) markAndNotify(t, "TP3", price, priceRead);
        if (!t.slHit() && t.sl() > 0 && price >= t.sl()) markAndNotify(t, "SL", price, priceRead);
    }

    private void markAndNotify(ActiveTrade old, String event, double price, PriceRead priceRead) {
        ActiveTrade updated = switch (event) {
            case "TP1" -> old.withTp1Hit();
            case "TP2" -> old.withTp2Hit();
            case "TP3" -> old.withTp3Hit();
            case "SL" -> old.withSlHit();
            default -> old;
        };
        activeTrades.put(old.key(), updated);
        String msg = formatEvent(updated, event, price, priceRead);
        System.out.println("ACTIVE TRADE MEMORY HIT: " + event + " " + updated.key()
                + " price=" + round(price)
                + " priceSource=CONSENSUS_MID sources=" + priceRead.sources());
        telegram.send(msg);
        if ("SL".equals(event) || "TP3".equals(event)) {
            activeTrades.remove(old.key());
            System.out.println("ACTIVE TRADE MEMORY: closed " + old.key() + " after " + event);
        }
    }

    private String formatEvent(ActiveTrade t, String event, double price, PriceRead priceRead) {
        String emoji = "SL".equals(event) ? "🛑" : "🎯";
        String label = "SL".equals(event) ? "STOP LOSS HIT" : event + " HIT";
        StringBuilder b = new StringBuilder();
        b.append(emoji).append(" MARADONA TRADE MEMORY - ").append(label).append("\n\n");
        b.append("PAIR: ").append(t.symbol()).append("\n");
        b.append("TF: ").append(t.tf()).append("\n");
        b.append("SETUP: ").append(t.setup()).append("\n");
        b.append("SIDE: ").append(t.side()).append("\n\n");
        b.append("ENTRY: ").append(round(t.entry())).append("\n");
        b.append("PRICE NOW: ").append(round(price)).append("\n");
        b.append("PRICE SOURCE: CONSENSUS_MID ").append(priceRead.sources()).append(" fresh source(s)\n");
        b.append("SL: ").append(round(t.sl())).append("\n");
        if (t.tp1() > 0) b.append("TP1: ").append(round(t.tp1())).append(t.tp1Hit() ? " ✅" : "").append("\n");
        if (t.tp2() > 0) b.append("TP2: ").append(round(t.tp2())).append(t.tp2Hit() ? " ✅" : "").append("\n");
        if (t.tp3() > 0) b.append("TP3: ").append(round(t.tp3())).append(t.tp3Hit() ? " ✅" : "").append("\n");
        b.append("\nCHIAVE TRADE: ").append(t.key()).append("\n");
        if ("SL".equals(event)) b.append("AZIONE: trade chiuso/reset memoria su questo TF.");
        else if ("TP3".equals(event)) b.append("AZIONE: target finale raggiunto, memoria trade chiusa su questo TF.");
        else b.append("AZIONE: proteggere trade / valutare BE o parziale.");
        return b.toString();
    }

    private String setupName(TradingViewSignal signal) {
        String sig = signal.safeSignal().toUpperCase();
        if (sig.contains("MASTER_PELE_MICRO_GZ") || signal.safeSetupFamily().toUpperCase().contains("MICRO_GZ")) return "PELE_MICRO_GZ";
        return "MARADONA_MASTER";
    }

    private String key(String symbol, String tf, String side, String setup) {
        return cleanSymbol(symbol) + "_" + cleanTf(tf) + "_" + side + "_" + setup;
    }

    private String cleanSymbol(String s) {
        if (s == null || s.isBlank()) return "UNKNOWN";
        return s.replace("BYBIT:", "").replace("BINANCE:", "").replace("OKX:", "").replace(".P", "").trim().toUpperCase();
    }

    private String cleanTf(String tf) {
        return tf == null || tf.isBlank() ? "TF_UNKNOWN" : tf.trim();
    }

    private String round(double v) {
        if (v == 0.0) return "0";
        return String.format(java.util.Locale.US, "%.4f", v);
    }

    private record ValidationResult(boolean ok, String reason, double price, int sources) {
        static ValidationResult ok(double price, int sources) { return new ValidationResult(true, "OK", price, sources); }
        static ValidationResult fail(String reason, double price, int sources) { return new ValidationResult(false, reason, price, sources); }
    }

    private record PriceRead(boolean valid, double price, int sources, String reason) {
        static PriceRead valid(double price, int sources) { return new PriceRead(true, price, sources, "OK"); }
        static PriceRead invalid(double price, int sources, String reason) { return new PriceRead(false, price, sources, reason); }
    }

    private record ActiveTrade(
            String key,
            String symbol,
            String tf,
            String side,
            String setup,
            double entry,
            double sl,
            double tp1,
            double tp2,
            double tp3,
            boolean tp1Hit,
            boolean tp2Hit,
            boolean tp3Hit,
            boolean slHit,
            Instant createdAt,
            Instant eligibleFrom,
            String source,
            double activationPrice,
            int activationSources
    ) {
        ActiveTrade withTp1Hit() { return new ActiveTrade(key, symbol, tf, side, setup, entry, sl, tp1, tp2, tp3, true, tp2Hit, tp3Hit, slHit, createdAt, eligibleFrom, source, activationPrice, activationSources); }
        ActiveTrade withTp2Hit() { return new ActiveTrade(key, symbol, tf, side, setup, entry, sl, tp1, tp2, tp3, tp1Hit, true, tp3Hit, slHit, createdAt, eligibleFrom, source, activationPrice, activationSources); }
        ActiveTrade withTp3Hit() { return new ActiveTrade(key, symbol, tf, side, setup, entry, sl, tp1, tp2, tp3, tp1Hit, tp2Hit, true, slHit, createdAt, eligibleFrom, source, activationPrice, activationSources); }
        ActiveTrade withSlHit() { return new ActiveTrade(key, symbol, tf, side, setup, entry, sl, tp1, tp2, tp3, tp1Hit, tp2Hit, tp3Hit, true, createdAt, eligibleFrom, source, activationPrice, activationSources); }
    }
}
