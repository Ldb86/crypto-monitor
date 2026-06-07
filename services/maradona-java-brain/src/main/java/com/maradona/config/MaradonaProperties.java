package com.maradona.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import java.util.List;

@Configuration
@ConfigurationProperties(prefix = "maradona")
public class MaradonaProperties {
    private List<String> symbols;
    private Bybit bybit = new Bybit();
    private Telegram telegram = new Telegram();
    private Tv tv = new Tv();

    public List<String> getSymbols() { return symbols; }
    public void setSymbols(List<String> symbols) { this.symbols = symbols; }
    public Bybit getBybit() { return bybit; }
    public Telegram getTelegram() { return telegram; }
    public Tv getTv() { return tv; }

    public static class Bybit {
        private String wsUrl;
        public String getWsUrl() { return wsUrl; }
        public void setWsUrl(String wsUrl) { this.wsUrl = wsUrl; }
    }

    public static class Telegram {
        private String botToken;
        private String chatId;
        private boolean telegramEnabled = true;

        public String getBotToken() { return botToken; }
        public void setBotToken(String botToken) { this.botToken = botToken; }
        public String getChatId() { return chatId; }
        public void setChatId(String chatId) { this.chatId = chatId; }
        public boolean isTelegramEnabled() { return telegramEnabled; }
        public void setTelegramEnabled(boolean telegramEnabled) { this.telegramEnabled = telegramEnabled; }
    }

    public static class Tv {
        private String secret;
        public String getSecret() { return secret; }
        public void setSecret(String secret) { this.secret = secret; }
    }
}
