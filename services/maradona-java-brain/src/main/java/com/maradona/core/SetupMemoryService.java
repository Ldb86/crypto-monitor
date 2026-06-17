package com.maradona.core;

import com.maradona.model.LiquidityDecision;
import com.maradona.model.TradingViewSignal;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class SetupMemoryService {
    @Value("${maradona.setupMemory.enabled:true}")
    private boolean enabled;

    @Value("${maradona.setupMemory.maxCandles:100}")
    private int maxCandles;

    private final Map<String, ReadySetup> readySetups = new ConcurrentHashMap<>();

    public void rememberIfReady(TradingViewSignal signal) {
        if (!enabled || signal == null) return;
        String sig = signal.safeSignal().toUpperCase();
        if (!sig.contains("READY")) return;

        String side = signal.safeSide().toUpperCase();
        if (!side.contains("LONG") && !side.contains("SHORT")) return;

        String key = key(signal.symbol(), signal.tf(), side, setupName(signal));
        ReadySetup setup = new ReadySetup(
                key,
                cleanSymbol(signal.symbol()),
                cleanTf(signal.tf()),
                side,
                setupName(signal),
                signal.safeEntry(),
                signal.safeEntryRangeLow(),
                signal.safeEntryRangeHigh(),
                signal.safeSl(),
                signal.safeTp1(),
                signal.safeTp2(),
                signal.safeTp3(),
                Instant.now(),
                signal.safeSignal()
        );
        readySetups.put(key, setup);
        System.out.println("SETUP MEMORY: READY remembered " + key + " validForCandles=" + maxCandles);
    }

    public void promoteIfConfirmedMaster(TradingViewSignal signal, LiquidityDecision liquidity) {
        if (!enabled || signal == null || liquidity == null || !liquidity.confirmed()) return;
        String sig = signal.safeSignal().toUpperCase();
        if (!sig.contains("MASTER")) return;
        String side = signal.safeSide().toUpperCase();
        String key = key(signal.symbol(), signal.tf(), side, setupName(signal));
        ReadySetup setup = readySetups.remove(key);
        if (setup != null) {
            System.out.println("SETUP MEMORY: promoted READY -> MASTER confirmed " + key + " liquidity=" + liquidity.status());
        } else {
            System.out.println("SETUP MEMORY: MASTER confirmed without previous READY " + key + " liquidity=" + liquidity.status());
        }
    }

    @Scheduled(fixedDelayString = "${maradona.setupMemory.cleanPollMs:60000}")
    public void cleanExpiredSetups() {
        if (!enabled || readySetups.isEmpty()) return;
        Instant now = Instant.now();
        for (ReadySetup setup : readySetups.values()) {
            long maxAgeMs = timeframeMs(setup.tf()) * Math.max(1, maxCandles);
            if (Duration.between(setup.createdAt(), now).toMillis() > maxAgeMs) {
                readySetups.remove(setup.key());
                System.out.println("SETUP MEMORY: expired " + setup.key() + " after " + maxCandles + " candles");
            }
        }
    }

    private long timeframeMs(String tf) {
        if (tf == null || tf.isBlank()) return 5L * 60_000L;
        String s = tf.trim().toLowerCase();
        try {
            if (s.endsWith("m")) return Long.parseLong(s.replace("m", "")) * 60_000L;
            if (s.endsWith("h")) return Long.parseLong(s.replace("h", "")) * 60L * 60_000L;
            if (s.endsWith("d")) return Long.parseLong(s.replace("d", "")) * 24L * 60L * 60_000L;
            return Long.parseLong(s) * 60_000L;
        } catch (Exception ignored) {
            return 5L * 60_000L;
        }
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

    private record ReadySetup(
            String key,
            String symbol,
            String tf,
            String side,
            String setup,
            double entry,
            double entryRangeLow,
            double entryRangeHigh,
            double sl,
            double tp1,
            double tp2,
            double tp3,
            Instant createdAt,
            String sourceSignal
    ) {}
}
