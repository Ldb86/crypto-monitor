package com.maradona.forex;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.maradona.bybit.MarketState;
import com.maradona.config.MaradonaProperties;
import com.maradona.model.MarketSnapshot;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@Component
public class ForexProviderService {
    private final MaradonaProperties props;
    private final MarketState state;
    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(java.time.Duration.ofSeconds(8)).build();
    private final Map<String, Double> lastMid = new ConcurrentHashMap<>();
    private final Set<String> missingConfigLogged = ConcurrentHashMap.newKeySet();

    public ForexProviderService(MaradonaProperties props, MarketState state) {
        this.props = props;
        this.state = state;
    }

    @PostConstruct
    public void start() {
        if (props.getForex() == null || !props.getForex().isEnabled()) {
            System.out.println("FOREX PROVIDERS OFF: FOREX_ENABLED=false");
            return;
        }
        System.out.println("FOREX PROVIDERS START mode=" + props.getForex().getMode()
                + " multiProvider=" + props.getForex().isMultiProviderEnabled()
                + " providerMode=" + props.getForex().getProviderMode());
        schedule("DUKASCOPY", props.getForex().getDukascopy());
        schedule("OANDA", props.getForex().getOanda());
        schedule("FXCM", props.getForex().getFxcm());
    }

    private void schedule(String provider, MaradonaProperties.Forex.Provider cfg) {
        if (cfg == null || !cfg.isEnabled()) {
            System.out.println("FOREX PROVIDER OFF: " + provider);
            return;
        }
        int seconds = Math.max(10, cfg.getPollSeconds());
        System.out.println("FOREX PROVIDER ENABLED: " + provider + " symbols=" + cfg.getSymbols() + " poll=" + seconds + "s");
        Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "forex-provider-" + provider.toLowerCase(Locale.ROOT));
            t.setDaemon(true);
            return t;
        }).scheduleAtFixedRate(() -> pollSafe(provider, cfg), 3, seconds, TimeUnit.SECONDS);
    }

    private void pollSafe(String provider, MaradonaProperties.Forex.Provider cfg) {
        try {
            switch (provider) {
                case "DUKASCOPY" -> pollDukascopy(cfg);
                case "OANDA" -> pollOanda(cfg);
                case "FXCM" -> pollGenericProvider("FXCM", cfg);
                default -> {}
            }
        } catch (Exception e) {
            System.out.println(provider + " FOREX POLL ERROR: " + e.getMessage());
        }
    }

    private void pollDukascopy(MaradonaProperties.Forex.Provider cfg) throws Exception {
        String url = cfg.getUrl();
        if (isBlank(url)) {
            if (isBlank(cfg.getToken())) {
                logMissingOnce("DUKASCOPY", "DUKASCOPY_ENABLED=true ma mancano DUKASCOPY_URL o DUKASCOPY_API_KEY. Provider configurato ma non può scaricare quote.");
                return;
            }
            String instruments = encodeDukascopySymbols(cfg.getSymbols());
            url = "https://freeserv.dukascopy.com/2.0/?path=api/currentPrices&key="
                    + URLEncoder.encode(cfg.getToken(), StandardCharsets.UTF_8)
                    + "&instruments=" + URLEncoder.encode(instruments, StandardCharsets.UTF_8);
        }
        JsonNode root = getJson(url, null);
        int published = publishAnyQuoteTree("DUKASCOPY", root);
        System.out.println("DUKASCOPY POLL OK published=" + published);
    }

    private void pollOanda(MaradonaProperties.Forex.Provider cfg) throws Exception {
        if (isBlank(cfg.getToken()) || isBlank(cfg.getAccountId())) {
            logMissingOnce("OANDA", "OANDA_ENABLED=true ma mancano OANDA_API_TOKEN/OANDA_ACCOUNT_ID. Provider configurato ma non può scaricare pricing.");
            return;
        }
        String base = isBlank(cfg.getUrl()) ? "https://api-fxpractice.oanda.com" : cfg.getUrl();
        String instruments = String.join(",", cfg.getSymbols().stream().map(this::toOandaInstrument).toList());
        String url = base.replaceAll("/$", "") + "/v3/accounts/" + cfg.getAccountId()
                + "/pricing?instruments=" + URLEncoder.encode(instruments, StandardCharsets.UTF_8);
        JsonNode root = getJson(url, "Bearer " + cfg.getToken());
        int published = 0;
        JsonNode prices = root.path("prices");
        if (prices.isArray()) {
            for (JsonNode p : prices) {
                String symbol = p.path("instrument").asText("");
                double bid = firstPrice(p.path("bids"));
                double ask = firstPrice(p.path("asks"));
                if (bid > 0 && ask > 0 && !symbol.isBlank()) {
                    publishQuote("OANDA", symbol, bid, ask, 0.0);
                    published++;
                }
            }
        }
        System.out.println("OANDA POLL OK published=" + published);
    }

    private void pollGenericProvider(String provider, MaradonaProperties.Forex.Provider cfg) throws Exception {
        if (isBlank(cfg.getUrl())) {
            logMissingOnce(provider, provider + "_ENABLED=true ma manca " + provider + "_QUOTES_URL. Provider configurato ma non può scaricare quote.");
            return;
        }
        JsonNode root = getJson(cfg.getUrl(), isBlank(cfg.getToken()) ? null : "Bearer " + cfg.getToken());
        int published = publishAnyQuoteTree(provider, root);
        System.out.println(provider + " POLL OK published=" + published);
    }

    private JsonNode getJson(String url, String authHeader) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
                .timeout(java.time.Duration.ofSeconds(10))
                .GET()
                .header("Accept", "application/json")
                .header("User-Agent", "Maradona-Forex-Provider/0.4.9F");
        if (authHeader != null && !authHeader.isBlank()) b.header("Authorization", authHeader);
        HttpResponse<String> resp = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
            throw new IllegalStateException("HTTP " + resp.statusCode() + " from " + url + " body=" + trim(resp.body(), 220));
        }
        return mapper.readTree(resp.body());
    }

    public void publishQuote(String provider, String rawSymbol, double bid, double ask, double externalDeltaBias) {
        if (bid <= 0 || ask <= 0 || ask < bid || isBlank(rawSymbol)) return;
        String symbol = normalizeForexSymbol(rawSymbol);
        double mid = (bid + ask) / 2.0;
        double spreadPct = mid > 0 ? Math.abs(ask - bid) / mid * 100.0 : 99.0;
        String key = provider.toUpperCase(Locale.ROOT) + ":" + symbol;
        double prev = lastMid.getOrDefault(key, mid);
        double change = mid - prev;
        double changePct = prev > 0 ? change / prev * 100.0 : 0.0;
        lastMid.put(key, mid);

        double bidPressure = 1.0;
        double askPressure = 1.0;
        if (changePct > 0.0005 || externalDeltaBias > 0) bidPressure = 2.4;
        if (changePct < -0.0005 || externalDeltaBias < 0) askPressure = 2.4;
        double deltaProxy = externalDeltaBias != 0.0 ? externalDeltaBias : changePct;
        double velocity = Math.min(1.0, Math.abs(changePct) * 100.0);

        MarketSnapshot snap = new MarketSnapshot(symbol, mid, bidPressure, askPressure, deltaProxy, velocity, spreadPct,
                bid, bidPressure, ask, askPressure, Instant.now());
        state.put(provider, snap);
        System.out.println(provider.toUpperCase(Locale.ROOT) + " FOREX QUOTE: " + symbol + " bid=" + bid + " ask=" + ask + " spread=" + String.format(Locale.US, "%.5f", spreadPct) + "%");
    }

    private int publishAnyQuoteTree(String provider, JsonNode root) {
        List<JsonNode> objects = new ArrayList<>();
        collectObjects(root, objects, 0);
        int n = 0;
        for (JsonNode node : objects) {
            String symbol = firstText(node, "symbol", "instrument", "name", "ticker", "pair");
            double bid = firstDouble(node, "bid", "bidPrice", "buy", "b");
            double ask = firstDouble(node, "ask", "askPrice", "sell", "a");
            if (bid > 0 && ask > 0 && !isBlank(symbol)) {
                publishQuote(provider, symbol, bid, ask, 0.0);
                n++;
            }
        }
        return n;
    }

    private void collectObjects(JsonNode node, List<JsonNode> out, int depth) {
        if (node == null || depth > 5) return;
        if (node.isObject()) {
            out.add(node);
            node.fields().forEachRemaining(e -> collectObjects(e.getValue(), out, depth + 1));
        } else if (node.isArray()) {
            for (JsonNode child : node) collectObjects(child, out, depth + 1);
        }
    }

    private String encodeDukascopySymbols(List<String> symbols) {
        return String.join(",", symbols.stream().map(s -> {
            String n = s == null ? "" : s.toUpperCase(Locale.ROOT).replace("/", "").replace("_", "").replace("-", "");
            if (n.equals("XAUUSDT")) return "XAU/USD";
            if (n.equals("XAUUSD")) return "XAU/USD";
            if (n.endsWith("USDT")) n = n.substring(0, n.length() - 1);
            if (n.length() == 6) return n.substring(0, 3) + "/" + n.substring(3);
            return s;
        }).filter(x -> x != null && !x.isBlank()).toList());
    }

    private String toOandaInstrument(String s) {
        String n = normalizeForexSymbol(s);
        if (n.equals("XAUUSDT")) return "XAU_USD";
        if (n.endsWith("USDT")) n = n.substring(0, n.length() - 1);
        if (n.length() == 6) return n.substring(0, 3) + "_" + n.substring(3);
        return s == null ? "" : s;
    }

    public String normalizeForexSymbol(String s) {
        if (s == null) return "";
        String n = s.replace("OANDA:", "").replace("FXCM:", "").replace("DUKASCOPY:", "")
                .replace("BYBIT:", "").replace(".P", "").replace("/", "").replace("_", "").replace("-", "")
                .trim().toUpperCase(Locale.ROOT);
        if (n.endsWith("USD") && !n.endsWith("USDT")) n += "T";
        return n;
    }

    private double firstPrice(JsonNode arr) {
        if (!arr.isArray() || arr.isEmpty()) return 0.0;
        JsonNode first = arr.get(0);
        return first.path("price").asDouble(0.0);
    }

    private String firstText(JsonNode n, String... keys) {
        for (String k : keys) {
            JsonNode v = n.path(k);
            if (v.isTextual() && !v.asText().isBlank()) return v.asText();
        }
        return "";
    }

    private double firstDouble(JsonNode n, String... keys) {
        for (String k : keys) {
            JsonNode v = n.path(k);
            if (v.isNumber()) return v.asDouble();
            if (v.isTextual()) {
                try { return Double.parseDouble(v.asText()); } catch (Exception ignored) {}
            }
        }
        return 0.0;
    }

    private boolean isBlank(String s) { return s == null || s.isBlank(); }
    private void logMissingOnce(String key, String msg) { if (missingConfigLogged.add(key)) System.out.println(msg); }
    private String trim(String s, int max) { return s == null ? "" : (s.length() <= max ? s : s.substring(0, max) + "..."); }
}
