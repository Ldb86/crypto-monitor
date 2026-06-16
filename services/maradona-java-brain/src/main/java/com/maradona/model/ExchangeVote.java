package com.maradona.model;

public record ExchangeVote(
        String exchange,
        String vote,
        int score,
        String reason
) {}
