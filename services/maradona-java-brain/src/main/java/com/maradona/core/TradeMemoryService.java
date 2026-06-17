package com.maradona.core;

import com.maradona.bybit.MarketState;
import com.maradona.model.LiquidityDecision;
import com.maradona.model.MarketSnapshot;
import com.maradona.model.TradingViewSignal;
import com.maradona.telegram.TelegramNotifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
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
        ActiveTrade current = activeTrades.get(key);
        ActiveTrade next = new ActiveTrade(key, cleanSymbol(signal.symbol()), cleanTf(signal.tf()), side, setup,
                entry, sl, tp1, tp2, tp3, false, false, false, false, Instant.now(), source == null ? sig : source);

        activeTrades.put(key, next);
        if (current == null) {
            System.out.println("ACTIVE TRADE MEMORY: remembered " + key + " entry=" + round(entry) + " sl=" + round(sl));
        } else {
            System.out.println("ACTIVE TRADE MEMORY: refreshed " + key + " entry=" + round(entry) + " sl=" + round(sl));
        }
    }

    @Scheduled(fixedDelayString = "${maradona.tradeMemory.pollMs:10000}")
    public void checkTpSlHits() {
        if (!enabled || !notifyTpSl || activeTrades.isEmpty()) return;
        for (ActiveTrade trade : activeTrades.values()) {
            try {
                MarketSnapshot snapshot = marketState.get(trade.symbol());
                if (snapshot == null || snapshot.mid() <= 0) continue;
                double price = snapshot.mid();
                if (trade.side().contains("LONG")) checkLong(trade, price);
                else if (trade.side().contains("SHORT")) checkShort(trade, price);
            } catch (Exception e) {
                System.out.println("ACTIVE TRADE MEMORY ERROR: " + e.getMessage());
            }
        }
    }

    private void checkLong(ActiveTrade t, double price) {
        if (!t.tp1Hit() && t.tp1() > 0 && price >= t.tp1()) markAndNotify(t, "TP1", price);
        if (!t.tp2Hit() && t.tp2() > 0 && price >= t.tp2()) markAndNotify(t, "TP2", price);
        if (!t.tp3Hit() && t.tp3() > 0 && price >= t.tp3()) markAndNotify(t, "TP3", price);
        if (!t.slHit() && t.sl() > 0 && price <= t.sl()) markAndNotify(t, "SL", price);
    }

    private void checkShort(ActiveTrade t, double price) {
        if (!t.tp1Hit() && t.tp1() > 0 && price <= t.tp1()) markAndNotify(t, "TP1", price);
        if (!t.tp2Hit() && t.tp2() > 0 && price <= t.tp2()) markAndNotify(t, "TP2", price);
        if (!t.tp3Hit() && t.tp3() > 0 && price <= t.tp3()) markAndNotify(t, "TP3", price);
        if (!t.slHit() && t.sl() > 0 && price >= t.sl()) markAndNotify(t, "SL", price);
    }

    private void markAndNotify(ActiveTrade old, String event, double price) {
        ActiveTrade updated = switch (event) {
            case "TP1" -> old.withTp1Hit();
            case "TP2" -> old.withTp2Hit();
            case "TP3" -> old.withTp3Hit();
            case "SL" -> old.withSlHit();
            default -> old;
        };
        activeTrades.put(old.key(), updated);
        String msg = formatEvent(updated, event, price);
        System.out.println("ACTIVE TRADE MEMORY HIT: " + event + " " + updated.key() + " price=" + round(price));
        telegram.send(msg);
        if ("SL".equals(event) || "TP3".equals(event)) {
            activeTrades.remove(old.key());
            System.out.println("ACTIVE TRADE MEMORY: closed " + old.key() + " after " + event);
        }
    }

    private String formatEvent(ActiveTrade t, String event, double price) {
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
            String source
    ) {
        ActiveTrade withTp1Hit() { return new ActiveTrade(key, symbol, tf, side, setup, entry, sl, tp1, tp2, tp3, true, tp2Hit, tp3Hit, slHit, createdAt, source); }
        ActiveTrade withTp2Hit() { return new ActiveTrade(key, symbol, tf, side, setup, entry, sl, tp1, tp2, tp3, tp1Hit, true, tp3Hit, slHit, createdAt, source); }
        ActiveTrade withTp3Hit() { return new ActiveTrade(key, symbol, tf, side, setup, entry, sl, tp1, tp2, tp3, tp1Hit, tp2Hit, true, slHit, createdAt, source); }
        ActiveTrade withSlHit() { return new ActiveTrade(key, symbol, tf, side, setup, entry, sl, tp1, tp2, tp3, tp1Hit, tp2Hit, tp3Hit, true, createdAt, source); }
    }
}
