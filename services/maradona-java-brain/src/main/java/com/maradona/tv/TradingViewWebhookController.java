package com.maradona.tv;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.maradona.bybit.MarketState;
import com.maradona.config.MaradonaProperties;
import com.maradona.core.Decision;
import com.maradona.core.MaradonaBrain;
import com.maradona.core.TargetValidation;
import com.maradona.model.MarketSnapshot;
import com.maradona.model.TradingViewSignal;
import com.maradona.telegram.TelegramNotifier;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/webhook")
public class TradingViewWebhookController {
    private final MaradonaProperties props;
    private final MarketState marketState;
    private final MaradonaBrain brain;
    private final TelegramNotifier telegram;
    private final ObjectMapper mapper = new ObjectMapper();

    public TradingViewWebhookController(MaradonaProperties props, MarketState marketState, MaradonaBrain brain, TelegramNotifier telegram) {
        this.props = props; this.marketState = marketState; this.brain = brain; this.telegram = telegram;
    }

    @PostMapping("/tradingview")
    public ResponseEntity<?> receive(@RequestBody String body) {
        TradingViewSignal signal;
        try {
            signal = mapper.readValue(body, TradingViewSignal.class);
        } catch (Exception e) {
            telegram.send("⚠️ MARADONA WEBHOOK NON JSON\nRicevuto:\n" + body + "\n\nServe JSON Pine/TradingView per Entry/SL/TP.");
            return ResponseEntity.badRequest().body("body must be JSON");
        }

        if (props.getTv().getSecret() != null && !props.getTv().getSecret().isBlank()
                && !props.getTv().getSecret().equals(signal.secret())) {
            return ResponseEntity.status(401).body("bad secret");
        }

        MarketSnapshot snapshot = marketState.get(signal.symbol());
        Decision decision = brain.evaluate(signal, snapshot);
        telegram.send(formatTelegram(signal, snapshot, decision));
        return ResponseEntity.ok(decision);
    }

    private String formatTelegram(TradingViewSignal s, MarketSnapshot m, Decision d) {
        TargetValidation tvTargets = TargetValidation.validate(s);
        StringBuilder b = new StringBuilder();
        b.append(d.telegramTitle()).append("\n\n");
        b.append("Pair: ").append(n(s.symbol())).append("\n");
        b.append("TF: ").append(n(s.tf())).append("\n");
        b.append("TW Signal: ").append(n(s.signal())).append("\n");
        b.append("Side: ").append(n(s.safeSide())).append("\n");
        b.append("Entry Type: ").append(n(s.entryType())).append("\n\n");
        b.append("Entry: ").append(s.safeEntry()).append("\n");
        if (s.safeEntryRangeLow() > 0 || s.safeEntryRangeHigh() > 0) {
            b.append("Entry Range: ").append(s.safeEntryRangeLow()).append(" - ").append(s.safeEntryRangeHigh()).append("\n");
        }
        if (s.safeNoChaseAbove() > 0) b.append("No Chase Above: ").append(s.safeNoChaseAbove()).append("\n");
        if (s.safeNoChaseBelow() > 0) b.append("No Chase Below: ").append(s.safeNoChaseBelow()).append("\n");
        b.append("SL: ").append(s.safeSl()).append("\n");
        b.append("TP1: ").append(s.safeTp1()).append("\n");
        b.append("TP2: ").append(s.safeTp2()).append("\n");
        b.append("TP3: ").append(s.safeTp3()).append("\n");
        if (!tvTargets.valid()) {
            b.append("\n⚠️ TP VALIDATION: ").append(tvTargets.warning()).append("\n");
            if (tvTargets.correctedTp1() != null) b.append("TP1 corretto/suggerito: ").append(round(tvTargets.correctedTp1())).append("\n");
            if (tvTargets.correctedTp2() != null) b.append("TP2 corretto/suggerito: ").append(round(tvTargets.correctedTp2())).append("\n");
            if (tvTargets.correctedTp3() != null) b.append("TP3 corretto/suggerito: ").append(round(tvTargets.correctedTp3())).append("\n");
        }
        b.append("\nBrain: ").append(n(s.brain())).append("\n");
        b.append("HTF: ").append(n(s.htf())).append("\n");
        b.append("MTF: ").append(n(s.mtf())).append("\n");
        b.append("Compression: ").append(n(s.compression())).append("\n");
        b.append("Score: ").append(s.safeScore()).append("\n\n");
        if (m != null) {
            b.append("Bybit Flow:\n");
            b.append("Mid: ").append(round(m.mid())).append("\n");
            b.append("BidPressure: ").append(round(m.bidPressure())).append("\n");
            b.append("AskPressure: ").append(round(m.askPressure())).append("\n");
            b.append("DeltaProxy: ").append(round(m.deltaProxy())).append("\n");
            b.append("Velocity: ").append(round(m.velocity())).append("\n");
            b.append("Spread%: ").append(round(m.spreadPct())).append("\n\n");
        } else {
            b.append("Bybit Flow: NO SNAPSHOT\n\n");
        }
        b.append("Decisione: ").append(d.action()).append("\n");
        b.append("Confidence: ").append(d.confidence()).append("%\n");
        b.append("Motivo: ").append(d.reason());
        return b.toString();
    }

    private String n(String v) { return v == null || v.isBlank() ? "-" : v; }
    private String round(double v) { return String.format(java.util.Locale.US, "%.4f", v); }

    @GetMapping("/status/{symbol}")
    public ResponseEntity<?> status(@PathVariable String symbol) {
        return ResponseEntity.ok(marketState.get(symbol));
    }
}
