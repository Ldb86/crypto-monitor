package com.maradona.model;

import java.time.Instant;

public record ExchangeSnapshot(
        String exchange,
        MarketSnapshot market,
        String liquidationBias,
        double liquidationPrice,
        Instant liquidationTime
) {
    public boolean hasFreshLiquidation(long maxSeconds) {
        return liquidationBias != null && !liquidationBias.isBlank()
                && liquidationTime != null
                && Instant.now().minusSeconds(maxSeconds).isBefore(liquidationTime);
    }
}
