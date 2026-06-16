package com.maradona.telegram;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.maradona.coinglass.CoinglassManualService;
import com.maradona.cluster.AutoClusterService;
import com.maradona.config.MaradonaProperties;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@Component
public class TelegramCommandPoller {
    private final MaradonaProperties props;
    private final TelegramNotifier notifier;
    private final CoinglassManualService coinglass;
    private final AutoClusterService autoClusters;
    private final RestClient rest = RestClient.create();
    private final ObjectMapper mapper = new ObjectMapper();
    private volatile long offset = 0L;

    public TelegramCommandPoller(MaradonaProperties props, TelegramNotifier notifier, CoinglassManualService coinglass, AutoClusterService autoClusters) {
        this.props = props;
        this.notifier = notifier;
        this.coinglass = coinglass;
        this.autoClusters = autoClusters;
    }

    @PostConstruct
    public void start() {
        if (!props.getTelegram().isCommandPollingEnabled()) {
            System.out.println("TELEGRAM COMMAND POLLER OFF");
            return;
        }
        Executors.newSingleThreadScheduledExecutor().scheduleAtFixedRate(this::pollSafe, 8, 8, TimeUnit.SECONDS);
        System.out.println("TELEGRAM COMMAND POLLER ON");
    }

    private void pollSafe() {
        try {
            String token = props.getTelegram().getBotToken();
            if (token == null || token.isBlank()) return;
            String url = "https://api.telegram.org/bot" + token + "/getUpdates?timeout=0&offset=" + offset;
            String body = rest.get().uri(url).retrieve().body(String.class);
            JsonNode root = mapper.readTree(body);
            if (!root.path("ok").asBoolean(false)) return;
            for (JsonNode update : root.path("result")) {
                long updateId = update.path("update_id").asLong();
                offset = Math.max(offset, updateId + 1);
                JsonNode msg = update.path("message");
                if (msg.isMissingNode() || msg.isNull()) continue;
                String chatId = msg.path("chat").path("id").asText("");
                String allowedChat = props.getTelegram().getChatId();
                if (allowedChat != null && !allowedChat.isBlank() && !allowedChat.equals(chatId)) {
                    System.out.println("TELEGRAM COMMAND IGNORED FROM CHAT: " + chatId);
                    continue;
                }
                String text = msg.path("text").asText("").trim();
                if (text.startsWith("/")) handleCommand(text);
            }
        } catch (Exception e) {
            System.out.println("TELEGRAM COMMAND POLLER ERROR: " + e.getMessage());
        }
    }

    private void handleCommand(String text) {
        String lower = text.toLowerCase(Locale.ROOT);
        if (lower.startsWith("/setcg")) {
            handleSetCg(text);
        } else if (lower.startsWith("/cg")) {
            handleShowCg(text);
        } else if (lower.startsWith("/clearcg")) {
            handleClearCg(text);
        } else if (lower.startsWith("/autocg") || lower.startsWith("/clusters")) {
            handleShowAutoClusters(text);
        } else if (lower.startsWith("/help") || lower.startsWith("/start")) {
            notifier.send(helpText());
        }
    }

    private void handleSetCg(String text) {
        try {
            String[] parts = text.trim().split("\\s+");
            if (parts.length < 5) {
                notifier.send("Formato non valido. Usa:\n/setcg BTC above 63200,64500 below 61385,60711");
                return;
            }
            String symbol = parts[1];
            List<Double> above = new ArrayList<>();
            List<Double> below = new ArrayList<>();
            String section = "";
            for (int i = 2; i < parts.length; i++) {
                String p = parts[i].trim();
                if (p.equalsIgnoreCase("above")) { section = "above"; continue; }
                if (p.equalsIgnoreCase("below")) { section = "below"; continue; }
                List<Double> parsed = parseNumbers(p);
                if (section.equals("above")) above.addAll(parsed);
                if (section.equals("below")) below.addAll(parsed);
            }
            CoinglassManualService.ManualLevels saved = coinglass.setLevels(symbol, above, below);
            notifier.send("✅ Coinglass manuale aggiornato\n" + coinglass.formatLevels(saved));
        } catch (Exception e) {
            notifier.send("Errore comando /setcg: " + e.getMessage() + "\nEsempio:\n/setcg BTC above 63200,64500 below 61385,60711");
        }
    }

    private void handleShowCg(String text) {
        String[] parts = text.trim().split("\\s+");
        if (parts.length < 2) {
            notifier.send("Usa: /cg BTC oppure /cg ETH");
            return;
        }
        notifier.send(coinglass.formatLevels(coinglass.getLevels(parts[1])));
    }

    private void handleShowAutoClusters(String text) {
        String[] parts = text.trim().split("\\s+");
        if (parts.length < 2) {
            notifier.send("Usa: /autocg BTC oppure /autocg ETH");
            return;
        }
        notifier.send(autoClusters.formatLevels(autoClusters.buildLevels(parts[1])));
    }

    private void handleClearCg(String text) {
        String[] parts = text.trim().split("\\s+");
        if (parts.length < 2) {
            notifier.send("Usa: /clearcg BTC oppure /clearcg ETH");
            return;
        }
        CoinglassManualService.ManualLevels removed = coinglass.clear(parts[1]);
        notifier.send(removed == null ? "Nessun livello da cancellare." : "✅ Coinglass manuale cancellato per " + removed.symbol());
    }

    private List<Double> parseNumbers(String raw) {
        List<Double> out = new ArrayList<>();
        if (raw == null || raw.isBlank()) return out;
        for (String n : raw.split(",")) {
            String clean = n.trim().replace("_", "").replace(" ", "");
            if (clean.isBlank()) continue;
            out.add(Double.parseDouble(clean));
        }
        return out;
    }

    private String helpText() {
        return "Comandi Maradona:\n" +
                "/setcg BTC above 63200,64500 below 61385,60711\n" +
                "/cg BTC\n" +
                "/autocg BTC\n" +
                "/clusters ETH\n" +
                "/clearcg BTC";
    }
}
