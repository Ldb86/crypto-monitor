package com.maradona.bybit;

import com.maradona.model.ExchangeSnapshot;
import com.maradona.model.MarketSnapshot;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Collection;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class MarketState {
    private final Map<String, MarketSnapshot> snapshots = new ConcurrentHashMap<>();
    private final Map<String, Map<String, ExchangeSnapshot>> exchangeSnapshots = new ConcurrentHashMap<>();

    public void put(MarketSnapshot snapshot) {
        put("BYBIT", snapshot);
    }

    public void put(String exchange, MarketSnapshot snapshot) {
        if (snapshot == null || snapshot.symbol() == null) return;
        String normalized = normalizeBybitSymbol(snapshot.symbol());
        String ex = normalizeExchange(exchange);
        if ("BYBIT".equals(ex)) snapshots.put(normalized, snapshot);
        exchangeSnapshots
                .computeIfAbsent(normalized, k -> new ConcurrentHashMap<>())
                .put(ex, new ExchangeSnapshot(ex, snapshot, null, 0.0, null));
    }

    public void put(String exchange, MarketSnapshot snapshot, String liquidationBias, double liquidationPrice, Instant liquidationTime) {
        if (snapshot == null || snapshot.symbol() == null) return;
        String normalized = normalizeBybitSymbol(snapshot.symbol());
        String ex = normalizeExchange(exchange);
        if ("BYBIT".equals(ex)) snapshots.put(normalized, snapshot);
        exchangeSnapshots
                .computeIfAbsent(normalized, k -> new ConcurrentHashMap<>())
                .put(ex, new ExchangeSnapshot(ex, snapshot, liquidationBias, liquidationPrice, liquidationTime));
    }

    public MarketSnapshot get(String symbol) {
        return snapshots.get(normalizeBybitSymbol(symbol));
    }

    public ExchangeSnapshot getExchange(String exchange, String symbol) {
        Map<String, ExchangeSnapshot> byExchange = exchangeSnapshots.get(normalizeBybitSymbol(symbol));
        if (byExchange == null) return null;
        return byExchange.get(normalizeExchange(exchange));
    }

    public Collection<ExchangeSnapshot> getAllExchanges(String symbol) {
        Map<String, ExchangeSnapshot> byExchange = exchangeSnapshots.get(normalizeBybitSymbol(symbol));
        return byExchange == null ? java.util.List.of() : byExchange.values();
    }

    public String normalizeBybitSymbol(String symbol) {
        if (symbol == null) return "";
        String n = symbol
                .replace("BYBIT:", "")
                .replace("BINANCE:", "")
                .replace("OKX:", "")
                .replace("OANDA:", "")
                .replace("FXCM:", "")
                .replace("DUKASCOPY:", "")
                .replace(".P", "")
                .replace("PERP", "")
                .replace("/", "")
                .replace("_", "")
                .replace("-USDT-SWAP", "USDT")
                .replace("-", "")
                .trim()
                .toUpperCase(Locale.ROOT);
        // Forex/metal cross mapping: TradingView may send XAUUSD/EURUSD while Bybit uses XAUUSDT/EURUSDT.
        if (n.endsWith("USD") && !n.endsWith("USDT")) n = n + "T";
        return n;
    }

    private String normalizeExchange(String exchange) {
        if (exchange == null || exchange.isBlank()) return "UNKNOWN";
        return exchange.trim().toUpperCase(Locale.ROOT);
    }
}
