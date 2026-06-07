package com.maradona.telegram;

import com.maradona.config.MaradonaProperties;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import java.util.Map;

@Service
public class TelegramNotifier {
    private final MaradonaProperties props;
    private final RestClient rest = RestClient.create();

    public TelegramNotifier(MaradonaProperties props) { this.props = props; }

    public void send(String text) {
        if (props.getTelegram().getBotToken() == null || props.getTelegram().getBotToken().isBlank()) {
            System.out.println("TELEGRAM OFF: " + text); return;
        }
        String url = "https://api.telegram.org/bot" + props.getTelegram().getBotToken() + "/sendMessage";
        rest.post().uri(url).contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("chat_id", props.getTelegram().getChatId(), "text", text))
                .retrieve().toBodilessEntity();
    }
}
