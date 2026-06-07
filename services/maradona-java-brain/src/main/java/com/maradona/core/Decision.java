package com.maradona.core;

public record Decision(
        String action,
        String reason,
        int confidence,
        String telegramTitle,
        boolean operative
) {}
