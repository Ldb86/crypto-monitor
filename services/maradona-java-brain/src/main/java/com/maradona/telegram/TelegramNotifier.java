package com.maradona.telegram;

import com.maradona.config.MaradonaProperties;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.HashMap;
import java.util.Map;

@Service
public class TelegramNotifier {
    private final MaradonaProperties props;
    private final RestClient rest = RestClient.create();

    public TelegramNotifier(MaradonaProperties props) {
        this.props = props;
    }

    public void send(String text) {
        String botToken = props.getTelegram().getBotToken();
        String chatId = props.getTelegram().getChatId();
        boolean enabled = props.getTelegram().isTelegramEnabled();

        if (!enabled) {
            System.out.println("TELEGRAM OFF BY CONFIG telegram_enabled=false: " + text);
            return;
        }

        if (botToken == null || botToken.isBlank()) {
            System.out.println("TELEGRAM OFF: TELEGRAM_BOT_TOKEN mancante o vuoto");
            System.out.println("MESSAGGIO NON INVIATO: " + text);
            return;
        }

        if (chatId == null || chatId.isBlank()) {
            System.out.println("TELEGRAM OFF: TELEGRAM_CHAT_ID mancante o vuoto");
            System.out.println("MESSAGGIO NON INVIATO: " + text);
            return;
        }

        String url = "https://api.telegram.org/bot" + botToken + "/sendMessage";

        Map<String, Object> body = new HashMap<>();
        body.put("chat_id", chatId);
        body.put("text", text);
        body.put("disable_web_page_preview", true);

        try {
            rest.post()
                    .uri(url)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .toBodilessEntity();

            System.out.println("TELEGRAM SENT OK");

        } catch (RestClientException e) {
            System.out.println("TELEGRAM ERROR: " + e.getMessage());
            System.out.println("TELEGRAM BOT TOKEN PRESENT: " + !botToken.isBlank());
            System.out.println("TELEGRAM CHAT ID: " + chatId);
            System.out.println("MESSAGGIO NON INVIATO: " + text);
        } catch (Exception e) {
            System.out.println("TELEGRAM GENERIC ERROR: " + e.getMessage());
            e.printStackTrace();
            System.out.println("MESSAGGIO NON INVIATO: " + text);
        }
    }
}
