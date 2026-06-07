package com.maradona.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record TradingViewSignal(
        String secret,
        String symbol,
        String tf,
        String signal,
        String side,
        Double entry,
        Double entryRangeLow,
        Double entryRangeHigh,
        Double noChaseAbove,
        Double noChaseBelow,
        Double sl,
        Double tp1,
        Double tp2,
        Double tp3,
        Integer score,
        String brain,
        String entryType,
        String compression,
        String mtf,
        String htf,
        String macd,
        String state,
        String action
) {
    public int safeScore() { return score == null ? 0 : score; }
    public double safeEntry() { return entry == null ? 0.0 : entry; }
    public double safeEntryRangeLow() { return entryRangeLow == null ? 0.0 : entryRangeLow; }
    public double safeEntryRangeHigh() { return entryRangeHigh == null ? 0.0 : entryRangeHigh; }
    public double safeNoChaseAbove() { return noChaseAbove == null ? 0.0 : noChaseAbove; }
    public double safeNoChaseBelow() { return noChaseBelow == null ? 0.0 : noChaseBelow; }
    public double safeSl() { return sl == null ? 0.0 : sl; }
    public double safeTp1() { return tp1 == null ? 0.0 : tp1; }
    public double safeTp2() { return tp2 == null ? 0.0 : tp2; }
    public double safeTp3() { return tp3 == null ? 0.0 : tp3; }
    public String safeSignal() { return signal == null ? "UNKNOWN" : signal; }
    public String safeSide() { return side == null ? inferSide(signal) : side; }
    private String inferSide(String s) {
        if (s == null) return "UNKNOWN";
        String u = s.toUpperCase();
        if (u.contains("LONG")) return "LONG";
        if (u.contains("SHORT")) return "SHORT";
        return "UNKNOWN";
    }
}
