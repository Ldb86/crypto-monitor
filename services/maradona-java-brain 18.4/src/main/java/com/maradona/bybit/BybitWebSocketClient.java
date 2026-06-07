package com.maradona.bybit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.maradona.config.MaradonaProperties;
import com.maradona.model.MarketSnapshot;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.net.URI;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

@Component
public class BybitWebSocketClient extends TextWebSocketHandler {
    private final MaradonaProperties props;
    private final MarketState state;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, NavigableMap<Double, Double>> bids = new ConcurrentHashMap<>();
    private final Map<String, NavigableMap<Double, Double>> asks = new ConcurrentHashMap<>();
    private final Map<String, Double> tradeDelta = new ConcurrentHashMap<>();
    private WebSocketSession session;

    public BybitWebSocketClient(MaradonaProperties props, MarketState state) {
        this.props = props;
        this.state = state;
    }

    @PostConstruct
    public void start() {
        connect();
        Executors.newSingleThreadScheduledExecutor().scheduleAtFixedRate(() -> {
            try { if (session != null && session.isOpen()) session.sendMessage(new TextMessage("{\"op\":\"ping\"}")); }
            catch (Exception ignored) {}
        }, 20, 20, TimeUnit.SECONDS);
    }

    private void connect() {
        try {
            new StandardWebSocketClient().execute(this, null, URI.create(props.getBybit().getWsUrl()));
        } catch (Exception e) {
            System.err.println("Bybit WS connect error: " + e.getMessage());
        }
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        this.session = session;
        List<String> args = props.getSymbols().stream()
                .flatMap(s -> List.of("orderbook.50." + s, "publicTrade." + s, "allLiquidation." + s).stream())
                .toList();
        String msg = mapper.writeValueAsString(new Subscribe("subscribe", args));
        session.sendMessage(new TextMessage(msg));
        System.out.println("Subscribed Bybit: " + args);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        JsonNode root = mapper.readTree(message.getPayload());
        String topic = root.path("topic").asText("");
        if (topic.startsWith("orderbook.")) handleOrderbook(topic, root);
        if (topic.startsWith("publicTrade.")) handleTrade(topic, root.path("data"));
    }

    private void handleOrderbook(String topic, JsonNode root) {
        String symbol = topic.split("\\.")[2];
        JsonNode data = root.path("data");
        String type = root.path("type").asText("snapshot");
        bids.computeIfAbsent(symbol, s -> new TreeMap<>(Comparator.reverseOrder()));
        asks.computeIfAbsent(symbol, s -> new TreeMap<>());
        if ("snapshot".equals(type)) {
            bids.get(symbol).clear();
            asks.get(symbol).clear();
        }
        applyLevels(bids.get(symbol), data.path("b"));
        applyLevels(asks.get(symbol), data.path("a"));
        publishSnapshot(symbol);
    }

    private void applyLevels(NavigableMap<Double, Double> book, JsonNode levels) {
        if (!levels.isArray()) return;
        for (JsonNode lvl : levels) {
            double price = lvl.get(0).asDouble();
            double qty = lvl.get(1).asDouble();
            if (qty <= 0) book.remove(price); else book.put(price, qty);
        }
        while (book.size() > 50) book.pollLastEntry();
    }

    private void handleTrade(String topic, JsonNode data) {
        String symbol = topic.split("\\.")[1];
        if (!data.isArray()) return;
        double d = tradeDelta.getOrDefault(symbol, 0.0) * 0.85;
        for (JsonNode t : data) {
            double qty = t.path("v").asDouble(0.0);
            String side = t.path("S").asText("");
            d += "Buy".equalsIgnoreCase(side) ? qty : -qty;
        }
        tradeDelta.put(symbol, d);
        publishSnapshot(symbol);
    }

    private void publishSnapshot(String symbol) {
        NavigableMap<Double, Double> b = bids.get(symbol);
        NavigableMap<Double, Double> a = asks.get(symbol);
        if (b == null || a == null || b.isEmpty() || a.isEmpty()) return;
        double bestBid = b.firstKey();
        double bestAsk = a.firstKey();
        double bidQty = b.values().stream().limit(10).mapToDouble(Double::doubleValue).sum();
        double askQty = a.values().stream().limit(10).mapToDouble(Double::doubleValue).sum();
        double mid = (bestBid + bestAsk) / 2.0;
        double spreadPct = mid > 0 ? Math.abs(bestAsk - bestBid) / mid * 100.0 : 99;
        double bookImbalance = bidQty - askQty;
        double td = tradeDelta.getOrDefault(symbol, 0.0);
        double deltaProxy = bookImbalance + td;
        double velocity = Math.abs(bookImbalance) / Math.max(1.0, bidQty + askQty);
        state.put(new MarketSnapshot(symbol, mid, bidQty, askQty, deltaProxy, velocity, spreadPct, Instant.now()));
    }

    private record Subscribe(String op, List<String> args) {}
}
