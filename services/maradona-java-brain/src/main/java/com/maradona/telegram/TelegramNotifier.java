package com.maradona.telegram;

import com.maradona.config.MaradonaProperties;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;

@Service
public class TelegramNotifier {
    private final MaradonaProperties props;
    private final RestClient rest = RestClient.create();
    private static final Map<String, String> DOTENV = loadDotEnv();

    public TelegramNotifier(MaradonaProperties props) { this.props = props; }

    public void send(String text) {
        String botToken = firstValue(props.getTelegram().getBotToken());
        if (botToken == null) botToken = firstValue(System.getenv("TELEGRAM_BOT_TOKEN"));
        if (botToken == null) botToken = firstValue(System.getenv("BOT_TOKENS"));
        if (botToken == null) botToken = firstValue(DOTENV.get("TELEGRAM_BOT_TOKEN"));
        if (botToken == null) botToken = firstValue(DOTENV.get("BOT_TOKENS"));

        String chatId = firstValue(props.getTelegram().getChatId());
        if (chatId == null) chatId = firstValue(System.getenv("TELEGRAM_CHAT_ID"));
        if (chatId == null) chatId = firstValue(System.getenv("CHAT_IDS"));
        if (chatId == null) chatId = firstValue(DOTENV.get("TELEGRAM_CHAT_ID"));
        if (chatId == null) chatId = firstValue(DOTENV.get("CHAT_IDS"));

        if (botToken == null || botToken.isBlank()) {
            System.out.println("TELEGRAM OFF: missing bot token -> " + text);
            return;
        }
        if (chatId == null || chatId.isBlank()) {
            System.out.println("TELEGRAM OFF: missing chat id -> " + text);
            return;
        }

        String url = "https://api.telegram.org/bot" + botToken + "/sendMessage";
        rest.post().uri(url).contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("chat_id", chatId, "text", text))
                .retrieve().toBodilessEntity();
    }

    private static String firstValue(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        if (value.isEmpty()) return null;
        int comma = value.indexOf(',');
        if (comma >= 0) value = value.substring(0, comma).trim();
        return value.isEmpty() ? null : value;
    }

    private static Map<String, String> loadDotEnv() {
        Map<String, String> env = new HashMap<>();
        for (Path file : new Path[] { Paths.get(".env"), Paths.get("..", ".env") }) {
            if (!Files.exists(file)) continue;
            try {
                for (String line : Files.readAllLines(file)) {
                    String trimmed = line.strip();
                    if (trimmed.isEmpty() || trimmed.startsWith("#")) continue;
                    int eq = trimmed.indexOf('=');
                    if (eq < 1) continue;
                    String key = trimmed.substring(0, eq).trim();
                    String value = trimmed.substring(eq + 1).trim();
                    if (!key.isEmpty()) env.putIfAbsent(key, value);
                }
            } catch (IOException ignored) {
            }
        }
        return env;
    }
}
