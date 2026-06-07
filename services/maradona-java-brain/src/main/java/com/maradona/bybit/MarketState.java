package com.maradona.bybit;

import com.maradona.model.MarketSnapshot;
import org.springframework.stereotype.Component;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class MarketState {
    private final Map<String, MarketSnapshot> snapshots = new ConcurrentHashMap<>();
    public void put(MarketSnapshot snapshot) { snapshots.put(snapshot.symbol(), snapshot); }
    public MarketSnapshot get(String symbol) { return snapshots.get(symbol); }
}
