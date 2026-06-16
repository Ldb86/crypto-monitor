package com.maradona.okx;

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
public class OkxWebSocketClient extends TextWebSocketHandler {
    private final MaradonaProperties props;
    private final MarketState state;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, NavigableMap<Double, Double>> bids = new ConcurrentHashMap<>();
    private final Map<String, NavigableMap<Double, Double>> asks = new ConcurrentHashMap<>();
    private final Map<String, Double> tradeDelta = new ConcurrentHashMap<>();
    private final Map<String, LiquidationEvent> liquidations = new ConcurrentHashMap<>();
    private WebSocketSession session;

    public OkxWebSocketClient(MaradonaProperties props, MarketState state) {
        this.props = props;
        this.state = state;
    }

    @PostConstruct
    public void start() {
        if (!props.getOkx().isEnabled()) {
            System.out.println("OKX WS disabled");
            return;
        }
        connect();
    }

    private void connect() {
        try {
            new StandardWebSocketClient().execute(this, null, URI.create(props.getOkx().getWsUrl()));
        } catch (Exception e) {
            System.err.println("OKX WS connect error: " + e.getMessage());
        }
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        this.session = session;
        List<Map<String, String>> args = new ArrayList<>();
        for (String s : props.symbolsForMultiExchange()) {
            String instId = toOkxInstId(s);
            args.add(Map.of("channel", "books5", "instId", instId));
            args.add(Map.of("channel", "trades", "instId", instId));
        }
        args.add(Map.of("channel", "liquidation-orders", "instType", "SWAP"));
        String msg = mapper.writeValueAsString(Map.of("op", "subscribe", "args", args));
        session.sendMessage(new TextMessage(msg));
        System.out.println("Subscribed OKX: " + args);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        JsonNode root = mapper.readTree(message.getPayload());
        JsonNode arg = root.path("arg");
        String channel = arg.path("channel").asText("");
        String instId = arg.path("instId").asText("");
        JsonNode data = root.path("data");
        if ("books5".equals(channel)) handleBooks(instId, data);
        if ("trades".equals(channel)) handleTrades(instId, data);
        if ("liquidation-orders".equals(channel)) handleLiquidations(data);
    }

    private void handleBooks(String instId, JsonNode data) {
        String symbol = fromOkxInstId(instId);
        if (symbol.isBlank() || !data.isArray() || data.isEmpty()) return;
        JsonNode d = data.get(0);
        bids.computeIfAbsent(symbol, s -> new TreeMap<>(Comparator.reverseOrder()));
        asks.computeIfAbsent(symbol, s -> new TreeMap<>());
        applyLevels(bids.get(symbol), d.path("bids"));
        applyLevels(asks.get(symbol), d.path("asks"));
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

    private void handleTrades(String instId, JsonNode data) {
        String symbol = fromOkxInstId(instId);
        if (symbol.isBlank() || !data.isArray()) return;
        double d = tradeDelta.getOrDefault(symbol, 0.0) * 0.85;
        for (JsonNode t : data) {
            double qty = t.path("sz").asDouble(0.0);
            String side = t.path("side").asText("");
            d += "buy".equalsIgnoreCase(side) ? qty : -qty;
        }
        tradeDelta.put(symbol, d);
        publishSnapshot(symbol);
    }

    private void handleLiquidations(JsonNode data) {
        if (!data.isArray()) return;
        for (JsonNode item : data) {
            String instId = item.path("instId").asText("");
            String symbol = fromOkxInstId(instId);
            if (symbol.isBlank()) continue;
            JsonNode details = item.path("details");
            if (!details.isArray()) continue;
            for (JsonNode d : details) {
                String side = d.path("side").asText("");
                double price = d.path("bkPx").asDouble(d.path("price").asDouble(0.0));
                String bias = "sell".equalsIgnoreCase(side) ? "LONG_LIQ" : "SHORT_LIQ";
                liquidations.put(symbol, new LiquidationEvent(bias, price, Instant.now()));
            }
            publishSnapshot(symbol);
        }
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
        state.put("OKX", new MarketSnapshot(symbol, mid, bidQty, askQty, deltaProxy, velocity, spreadPct,
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

    private String toOkxInstId(String symbol) {
        String s = symbol == null ? "" : symbol.replace(".P", "").replace("PERP", "").replace("/", "").toUpperCase(Locale.ROOT);
        if (s.endsWith("USDT")) return s.replace("USDT", "-USDT-SWAP");
        return s;
    }

    private String fromOkxInstId(String instId) {
        if (instId == null) return "";
        return instId.replace("-USDT-SWAP", "USDT").replace("-", "").toUpperCase(Locale.ROOT);
    }

    private record LiquidationEvent(String bias, double price, Instant time) {}
}
