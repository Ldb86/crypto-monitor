package com.maradona.bybit;

import com.maradona.model.MarketSnapshot;
import org.springframework.stereotype.Component;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class MarketState {
    private final Map<String, MarketSnapshot> snapshots = new ConcurrentHashMap<>();

    public void put(MarketSnapshot snapshot) {
        if (snapshot == null || snapshot.symbol() == null) return;
        snapshots.put(normalizeBybitSymbol(snapshot.symbol()), snapshot);
    }

    public MarketSnapshot get(String symbol) {
        return snapshots.get(normalizeBybitSymbol(symbol));
    }

    public String normalizeBybitSymbol(String symbol) {
        if (symbol == null) return "";
        return symbol
                .replace("BYBIT:", "")
                .replace("BINANCE:", "")
                .replace(".P", "")
                .replace("PERP", "")
                .replace("/", "")
                .trim()
                .toUpperCase();
    }

    public boolean hasSnapshot(String symbol) {
        return get(symbol) != null;
    }
}
