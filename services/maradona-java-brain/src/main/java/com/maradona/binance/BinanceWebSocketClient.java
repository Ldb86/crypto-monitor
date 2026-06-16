package com.maradona.binance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.maradona.bybit.MarketState;
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
public class BinanceWebSocketClient extends TextWebSocketHandler {
    private final MaradonaProperties props;
    private final MarketState state;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, NavigableMap<Double, Double>> bids = new ConcurrentHashMap<>();
    private final Map<String, NavigableMap<Double, Double>> asks = new ConcurrentHashMap<>();
    private final Map<String, Double> tradeDelta = new ConcurrentHashMap<>();
    private final Map<String, LiquidationEvent> liquidations = new ConcurrentHashMap<>();
    private WebSocketSession session;

    public BinanceWebSocketClient(MaradonaProperties props, MarketState state) {
        this.props = props;
        this.state = state;
    }

    @PostConstruct
    public void start() {
        if (!props.getBinance().isEnabled()) {
            System.out.println("Binance WS disabled");
            return;
        }
        connect();
    }

    private void connect() {
        try {
            new StandardWebSocketClient().execute(this, null, URI.create(props.getBinance().getWsUrl()));
        } catch (Exception e) {
            System.err.println("Binance WS connect error: " + e.getMessage());
        }
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        this.session = session;
        List<String> params = new ArrayList<>();
        for (String s : props.symbolsForMultiExchange()) {
            String lc = s.toLowerCase(Locale.ROOT);
            params.add(lc + "@depth20@100ms");
            params.add(lc + "@aggTrade");
            params.add(lc + "@forceOrder");
        }
        String msg = mapper.writeValueAsString(Map.of("method", "SUBSCRIBE", "params", params, "id", 1));
        session.sendMessage(new TextMessage(msg));
        System.out.println("Subscribed Binance: " + params);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        JsonNode root = mapper.readTree(message.getPayload());
        String event = root.path("e").asText("");
        if ("depthUpdate".equals(event) || root.has("bids") || root.has("lastUpdateId")) handleDepth(root);
        if ("aggTrade".equals(event)) handleTrade(root);
        if ("forceOrder".equals(event)) handleForceOrder(root.path("o"));
    }

    private void handleDepth(JsonNode root) {
        String symbol = root.path("s").asText("");
        if (symbol.isBlank() && root.has("stream")) symbol = root.path("stream").asText("").split("@")[0].toUpperCase(Locale.ROOT);
        if (symbol.isBlank()) return;
        bids.computeIfAbsent(symbol, s -> new TreeMap<>(Comparator.reverseOrder()));
        asks.computeIfAbsent(symbol, s -> new TreeMap<>());
        applyLevels(bids.get(symbol), root.has("b") ? root.path("b") : root.path("bids"));
        applyLevels(asks.get(symbol), root.has("a") ? root.path("a") : root.path("asks"));
        publishSnapshot(symbol);
    }

    private void applyLevels(NavigableMap<Double, Double> book, JsonNode levels) {
        if (!levels.isArray()) return;
        book.clear();
        for (JsonNode lvl : levels) {
            double price = lvl.get(0).asDouble();
            double qty = lvl.get(1).asDouble();
            if (qty > 0) book.put(price, qty);
        }
        while (book.size() > 50) book.pollLastEntry();
    }

    private void handleTrade(JsonNode t) {
        String symbol = t.path("s").asText("");
        if (symbol.isBlank()) return;
        double qty = t.path("q").asDouble(0.0);
        boolean buyerIsMaker = t.path("m").asBoolean(false);
        double d = tradeDelta.getOrDefault(symbol, 0.0) * 0.85;
        d += buyerIsMaker ? -qty : qty;
        tradeDelta.put(symbol, d);
        publishSnapshot(symbol);
    }

    private void handleForceOrder(JsonNode o) {
        String symbol = o.path("s").asText("");
        if (symbol.isBlank()) return;
        String side = o.path("S").asText("");
        double price = o.path("ap").asDouble(o.path("p").asDouble(0.0));
        String bias = "SELL".equalsIgnoreCase(side) ? "LONG_LIQ" : "SHORT_LIQ";
        liquidations.put(symbol, new LiquidationEvent(bias, price, Instant.now()));
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
        double deltaProxy = bookImbalance + tradeDelta.getOrDefault(symbol, 0.0);
        double velocity = Math.abs(bookImbalance) / Math.max(1.0, bidQty + askQty);
        Map.Entry<Double, Double> strongestBid = strongestLevel(b, mid);
        Map.Entry<Double, Double> strongestAsk = strongestLevel(a, mid);
        LiquidationEvent liq = liquidations.get(symbol);
        state.put("BINANCE", new MarketSnapshot(symbol, mid, bidQty, askQty, deltaProxy, velocity, spreadPct,
                strongestBid == null ? 0.0 : strongestBid.getKey(), strongestBid == null ? 0.0 : strongestBid.getValue(),
                strongestAsk == null ? 0.0 : strongestAsk.getKey(), strongestAsk == null ? 0.0 : strongestAsk.getValue(), Instant.now()),
                liq == null ? null : liq.bias(), liq == null ? 0.0 : liq.price(), liq == null ? null : liq.time());
    }

    private Map.Entry<Double, Double> strongestLevel(NavigableMap<Double, Double> book, double mid) {
        Map.Entry<Double, Double> best = null;
        for (Map.Entry<Double, Double> e : book.entrySet()) {
            double distancePct = Math.abs(e.getKey() - mid) / mid * 100.0;
            if (distancePct > 1.25) continue;
            if (best == null || e.getValue() > best.getValue()) best = e;
        }
        return best;
    }

    private record LiquidationEvent(String bias, double price, Instant time) {}
}
