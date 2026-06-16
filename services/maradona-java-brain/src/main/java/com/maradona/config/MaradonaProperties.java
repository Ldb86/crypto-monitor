package com.maradona.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;
import java.util.ArrayList;

@Configuration
@ConfigurationProperties(prefix = "maradona")
public class MaradonaProperties {
    private List<String> symbols;
    private Bybit bybit = new Bybit();
    private Binance binance = new Binance();
    private Okx okx = new Okx();
    private MultiExchange multiExchange = new MultiExchange();
    private Forex forex = new Forex();
    private AutoCluster autoCluster = new AutoCluster();
    private Notifications notifications = new Notifications();
    private Telegram telegram = new Telegram();
    private Tv tv = new Tv();

    public List<String> getSymbols() { return symbols; }
    public void setSymbols(List<String> symbols) { this.symbols = symbols; }
    public Bybit getBybit() { return bybit; }
    public Binance getBinance() { return binance; }
    public Okx getOkx() { return okx; }
    public MultiExchange getMultiExchange() { return multiExchange; }
    public Forex getForex() { return forex; }
    public AutoCluster getAutoCluster() { return autoCluster; }
    public Notifications getNotifications() { return notifications; }
    public Telegram getTelegram() { return telegram; }
    public Tv getTv() { return tv; }

    public List<String> symbolsForBybit() {
        List<String> out = new ArrayList<>();
        if (symbols != null) out.addAll(symbols);
        if (forex != null && forex.isEnabled() && forex.getSymbols() != null) {
            for (String s : forex.getSymbols()) {
                if (s != null && !s.isBlank() && out.stream().noneMatch(x -> normalizeSymbol(x).equals(normalizeSymbol(s)))) out.add(s);
            }
        }
        return out;
    }

    public List<String> symbolsForMultiExchange() {
        if (symbols == null) return List.of();
        return symbols.stream()
                .filter(s -> !isForexSymbol(s))
                .collect(Collectors.toList());
    }

    public boolean isForexSymbol(String symbol) {
        if (symbol == null || forex == null || !forex.isEnabled() || forex.getSymbols() == null) return false;
        String n = normalizeSymbol(symbol);
        return forex.getSymbols().stream().anyMatch(s -> normalizeSymbol(s).equals(n));
    }

    private String normalizeSymbol(String symbol) {
        if (symbol == null) return "";
        String n = symbol.replace("BYBIT:", "")
                .replace("BINANCE:", "")
                .replace("OKX:", "")
                .replace("OANDA:", "")
                .replace("FXCM:", "")
                .replace("DUKASCOPY:", "")
                .replace(".P", "")
                .replace("PERP", "")
                .replace("/", "")
                .replace("_", "")
                .replace("-USDT-SWAP", "USDT")
                .replace("-", "")
                .trim()
                .toUpperCase(Locale.ROOT);
        if (n.endsWith("USD") && !n.endsWith("USDT")) n = n + "T";
        return n;
    }


    public static class Bybit {
        private String wsUrl;
        public String getWsUrl() { return wsUrl; }
        public void setWsUrl(String wsUrl) { this.wsUrl = wsUrl; }
    }

    public static class Binance {
        private boolean enabled = true;
        private String wsUrl;
        public boolean isEnabled() { return enabled; }
        public void setEnabled(boolean enabled) { this.enabled = enabled; }
        public String getWsUrl() { return wsUrl; }
        public void setWsUrl(String wsUrl) { this.wsUrl = wsUrl; }
    }

    public static class Okx {
        private boolean enabled = true;
        private String wsUrl;
        public boolean isEnabled() { return enabled; }
        public void setEnabled(boolean enabled) { this.enabled = enabled; }
        public String getWsUrl() { return wsUrl; }
        public void setWsUrl(String wsUrl) { this.wsUrl = wsUrl; }
    }

    public static class MultiExchange {
        private boolean enabled = true;
        private int requiredConfirmations = 2;
        private boolean notifyRejectedMicroGz = false;
        public boolean isEnabled() { return enabled; }
        public void setEnabled(boolean enabled) { this.enabled = enabled; }
        public int getRequiredConfirmations() { return requiredConfirmations; }
        public void setRequiredConfirmations(int requiredConfirmations) { this.requiredConfirmations = requiredConfirmations; }
        public boolean isNotifyRejectedMicroGz() { return notifyRejectedMicroGz; }
        public void setNotifyRejectedMicroGz(boolean notifyRejectedMicroGz) { this.notifyRejectedMicroGz = notifyRejectedMicroGz; }
    }



    public static class Forex {
        private boolean enabled = false;
        private String mode = "BYBIT_ONLY";
        private List<String> symbols = List.of("XAUUSDT");
        private int minBybitScore = 4;
        private double maxSpreadPct = 0.12;
        private int confidencePenalty = 18;
        private boolean notifyRejected = false;
        private boolean multiProviderEnabled = false;
        private int requiredConfirmations = 2;
        private String providerMode = "BYBIT_DUKASCOPY_OANDA";
        private Provider dukascopy = new Provider();
        private Provider oanda = new Provider();
        private Provider fxcm = new Provider();

        public boolean isEnabled() { return enabled; }
        public void setEnabled(boolean enabled) { this.enabled = enabled; }
        public String getMode() { return mode; }
        public void setMode(String mode) { this.mode = mode; }
        public List<String> getSymbols() { return symbols; }
        public void setSymbols(List<String> symbols) { this.symbols = symbols; }
        public int getMinBybitScore() { return minBybitScore; }
        public void setMinBybitScore(int minBybitScore) { this.minBybitScore = minBybitScore; }
        public double getMaxSpreadPct() { return maxSpreadPct; }
        public void setMaxSpreadPct(double maxSpreadPct) { this.maxSpreadPct = maxSpreadPct; }
        public int getConfidencePenalty() { return confidencePenalty; }
        public void setConfidencePenalty(int confidencePenalty) { this.confidencePenalty = confidencePenalty; }
        public boolean isNotifyRejected() { return notifyRejected; }
        public void setNotifyRejected(boolean notifyRejected) { this.notifyRejected = notifyRejected; }
        public boolean isMultiProviderEnabled() { return multiProviderEnabled; }
        public void setMultiProviderEnabled(boolean multiProviderEnabled) { this.multiProviderEnabled = multiProviderEnabled; }
        public int getRequiredConfirmations() { return requiredConfirmations; }
        public void setRequiredConfirmations(int requiredConfirmations) { this.requiredConfirmations = requiredConfirmations; }
        public String getProviderMode() { return providerMode; }
        public void setProviderMode(String providerMode) { this.providerMode = providerMode; }
        public Provider getDukascopy() { return dukascopy; }
        public void setDukascopy(Provider dukascopy) { this.dukascopy = dukascopy; }
        public Provider getOanda() { return oanda; }
        public void setOanda(Provider oanda) { this.oanda = oanda; }
        public Provider getFxcm() { return fxcm; }
        public void setFxcm(Provider fxcm) { this.fxcm = fxcm; }

        public static class Provider {
            private boolean enabled = false;
            private List<String> symbols = List.of("XAUUSD", "EURUSD");
            private int minScore = 4;
            private String url = "";
            private String token = "";
            private String accountId = "";
            private int pollSeconds = 20;

            public boolean isEnabled() { return enabled; }
            public void setEnabled(boolean enabled) { this.enabled = enabled; }
            public List<String> getSymbols() { return symbols; }
            public void setSymbols(List<String> symbols) { this.symbols = symbols; }
            public int getMinScore() { return minScore; }
            public void setMinScore(int minScore) { this.minScore = minScore; }
            public String getUrl() { return url; }
            public void setUrl(String url) { this.url = url; }
            public String getToken() { return token; }
            public void setToken(String token) { this.token = token; }
            public String getAccountId() { return accountId; }
            public void setAccountId(String accountId) { this.accountId = accountId; }
            public int getPollSeconds() { return pollSeconds; }
            public void setPollSeconds(int pollSeconds) { this.pollSeconds = pollSeconds; }
        }
    }

    public static class AutoCluster {
        private boolean enabled = true;
        private String mode = "ON_SIGNAL";
        private int ttlMinutes = 60;
        private boolean dynamicTtlEnabled = true;
        private int cooldownMinutes = 30;
        private double refreshOnPriceMovePercent = 0.5;
        private int levelsAbove = 3;
        private int levelsBelow = 3;
        private int maxCandles = 100;
        private double maxDistancePct = 2.5;
        private double mergeTolerancePct = 0.20;

        public boolean isEnabled() { return enabled; }
        public void setEnabled(boolean enabled) { this.enabled = enabled; }
        public String getMode() { return mode; }
        public void setMode(String mode) { this.mode = mode; }
        public int getTtlMinutes() { return ttlMinutes; }
        public void setTtlMinutes(int ttlMinutes) { this.ttlMinutes = ttlMinutes; }
        public boolean isDynamicTtlEnabled() { return dynamicTtlEnabled; }
        public void setDynamicTtlEnabled(boolean dynamicTtlEnabled) { this.dynamicTtlEnabled = dynamicTtlEnabled; }
        public int getCooldownMinutes() { return cooldownMinutes; }
        public void setCooldownMinutes(int cooldownMinutes) { this.cooldownMinutes = cooldownMinutes; }
        public double getRefreshOnPriceMovePercent() { return refreshOnPriceMovePercent; }
        public void setRefreshOnPriceMovePercent(double refreshOnPriceMovePercent) { this.refreshOnPriceMovePercent = refreshOnPriceMovePercent; }
        public int getLevelsAbove() { return levelsAbove; }
        public void setLevelsAbove(int levelsAbove) { this.levelsAbove = levelsAbove; }
        public int getLevelsBelow() { return levelsBelow; }
        public void setLevelsBelow(int levelsBelow) { this.levelsBelow = levelsBelow; }
        public int getMaxCandles() { return maxCandles; }
        public void setMaxCandles(int maxCandles) { this.maxCandles = maxCandles; }
        public double getMaxDistancePct() { return maxDistancePct; }
        public void setMaxDistancePct(double maxDistancePct) { this.maxDistancePct = maxDistancePct; }
        public double getMergeTolerancePct() { return mergeTolerancePct; }
        public void setMergeTolerancePct(double mergeTolerancePct) { this.mergeTolerancePct = mergeTolerancePct; }
    }

    public static class Notifications {
        private boolean notifyReady = false;
        private boolean notifyPre = false;
        private boolean notifyWarning = false;
        private boolean notifyOther = false;
        private boolean notifyMonitor = false;
        private boolean notifyMicroTableReset = false;
        private boolean notifySlReset = false;
        private boolean notifyMasterWatch = false;
        private boolean notifyMasterRejected = false;
        private boolean notifyTpSl = true;
        private boolean notifyProtectWarningActiveTrade = true;
        private boolean notifyDuplicateOverlap = true;
        private boolean suppressDuplicateEntries = true;
        private int duplicateOverlapWindowMinutes = 90;
        private double duplicateEntryDistancePct = 0.30;
        private double duplicateRangeOverlapPct = 50.0;

        public boolean isNotifyReady() { return notifyReady; }
        public void setNotifyReady(boolean notifyReady) { this.notifyReady = notifyReady; }
        public boolean isNotifyPre() { return notifyPre; }
        public void setNotifyPre(boolean notifyPre) { this.notifyPre = notifyPre; }
        public boolean isNotifyWarning() { return notifyWarning; }
        public void setNotifyWarning(boolean notifyWarning) { this.notifyWarning = notifyWarning; }
        public boolean isNotifyOther() { return notifyOther; }
        public void setNotifyOther(boolean notifyOther) { this.notifyOther = notifyOther; }
        public boolean isNotifyMonitor() { return notifyMonitor; }
        public void setNotifyMonitor(boolean notifyMonitor) { this.notifyMonitor = notifyMonitor; }
        public boolean isNotifyMicroTableReset() { return notifyMicroTableReset; }
        public void setNotifyMicroTableReset(boolean notifyMicroTableReset) { this.notifyMicroTableReset = notifyMicroTableReset; }
        public boolean isNotifySlReset() { return notifySlReset; }
        public void setNotifySlReset(boolean notifySlReset) { this.notifySlReset = notifySlReset; }
        public boolean isNotifyMasterWatch() { return notifyMasterWatch; }
        public void setNotifyMasterWatch(boolean notifyMasterWatch) { this.notifyMasterWatch = notifyMasterWatch; }
        public boolean isNotifyMasterRejected() { return notifyMasterRejected; }
        public void setNotifyMasterRejected(boolean notifyMasterRejected) { this.notifyMasterRejected = notifyMasterRejected; }
        public boolean isNotifyTpSl() { return notifyTpSl; }
        public void setNotifyTpSl(boolean notifyTpSl) { this.notifyTpSl = notifyTpSl; }
        public boolean isNotifyProtectWarningActiveTrade() { return notifyProtectWarningActiveTrade; }
        public void setNotifyProtectWarningActiveTrade(boolean notifyProtectWarningActiveTrade) { this.notifyProtectWarningActiveTrade = notifyProtectWarningActiveTrade; }
        public boolean isNotifyDuplicateOverlap() { return notifyDuplicateOverlap; }
        public void setNotifyDuplicateOverlap(boolean notifyDuplicateOverlap) { this.notifyDuplicateOverlap = notifyDuplicateOverlap; }
        public boolean isSuppressDuplicateEntries() { return suppressDuplicateEntries; }
        public void setSuppressDuplicateEntries(boolean suppressDuplicateEntries) { this.suppressDuplicateEntries = suppressDuplicateEntries; }
        public int getDuplicateOverlapWindowMinutes() { return duplicateOverlapWindowMinutes; }
        public void setDuplicateOverlapWindowMinutes(int duplicateOverlapWindowMinutes) { this.duplicateOverlapWindowMinutes = duplicateOverlapWindowMinutes; }
        public double getDuplicateEntryDistancePct() { return duplicateEntryDistancePct; }
        public void setDuplicateEntryDistancePct(double duplicateEntryDistancePct) { this.duplicateEntryDistancePct = duplicateEntryDistancePct; }
        public double getDuplicateRangeOverlapPct() { return duplicateRangeOverlapPct; }
        public void setDuplicateRangeOverlapPct(double duplicateRangeOverlapPct) { this.duplicateRangeOverlapPct = duplicateRangeOverlapPct; }
    }

    public static class Telegram {
        private String botToken;
        private String chatId;
        private boolean telegramEnabled = true;
        private boolean commandPollingEnabled = true;

        public String getBotToken() { return botToken; }
        public void setBotToken(String botToken) { this.botToken = botToken; }
        public String getChatId() { return chatId; }
        public void setChatId(String chatId) { this.chatId = chatId; }
        public boolean isTelegramEnabled() { return telegramEnabled; }
        public void setTelegramEnabled(boolean telegramEnabled) { this.telegramEnabled = telegramEnabled; }
        public boolean isCommandPollingEnabled() { return commandPollingEnabled; }
        public void setCommandPollingEnabled(boolean commandPollingEnabled) { this.commandPollingEnabled = commandPollingEnabled; }
    }

    public static class Tv {
        private String secret;
        public String getSecret() { return secret; }
        public void setSecret(String secret) { this.secret = secret; }
    }
}
