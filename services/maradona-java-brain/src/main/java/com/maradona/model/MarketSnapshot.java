package com.maradona.model;

import java.time.Instant;

public record MarketSnapshot(
        String symbol,
        double mid,
        double bidPressure,
        double askPressure,
        double deltaProxy,
        double velocity,
        double spreadPct,
        double strongestBidPrice,
        double strongestBidQty,
        double strongestAskPrice,
        double strongestAskQty,
        Instant time
) {}
