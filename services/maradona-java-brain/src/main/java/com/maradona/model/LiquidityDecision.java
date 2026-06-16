package com.maradona.model;

import java.util.List;

public record LiquidityDecision(
        boolean confirmed,
        int confirms,
        int available,
        int contrary,
        String direction,
        String status,
        String friendlyLine,
        String reason,
        List<ExchangeVote> votes
) {
    public String scoreLabel() {
        return confirms + "/" + available;
    }
}
