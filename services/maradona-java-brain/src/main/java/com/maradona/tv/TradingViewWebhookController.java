package com.maradona.tv;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.maradona.bybit.MarketState;
import com.maradona.config.MaradonaProperties;
import com.maradona.coinglass.CoinglassManualService;
import com.maradona.cluster.AutoClusterService;
import com.maradona.core.Decision;
import com.maradona.core.MaradonaBrain;
import com.maradona.core.SignalOverlapService;
import com.maradona.core.TargetValidation;
import com.maradona.liquidity.LiquidityVoteEngine;
import com.maradona.model.ExchangeSnapshot;
import com.maradona.model.LiquidityDecision;
import com.maradona.model.MarketSnapshot;
import com.maradona.model.TradingViewSignal;
import com.maradona.telegram.TelegramNotifier;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

@RestController
@RequestMapping("/webhook")
public class TradingViewWebhookController {
    private final MaradonaProperties props;
    private final MarketState marketState;
    private final MaradonaBrain brain;
    private final LiquidityVoteEngine liquidityVoteEngine;
    private final CoinglassManualService coinglass;
    private final AutoClusterService autoClusters;
    private final SignalOverlapService overlapService;
    private final TelegramNotifier telegram;
    private final ObjectMapper mapper = new ObjectMapper();

    public TradingViewWebhookController(MaradonaProperties props, MarketState marketState, MaradonaBrain brain,
                                        LiquidityVoteEngine liquidityVoteEngine, CoinglassManualService coinglass,
                                        AutoClusterService autoClusters, SignalOverlapService overlapService, TelegramNotifier telegram) {
        this.props = props;
        this.marketState = marketState;
        this.brain = brain;
        this.liquidityVoteEngine = liquidityVoteEngine;
        this.coinglass = coinglass;
        this.autoClusters = autoClusters;
        this.overlapService = overlapService;
        this.telegram = telegram;
    }

    @PostMapping("/tradingview")
    public ResponseEntity<?> receive(@RequestBody String body) {
        TradingViewSignal signal;
        try {
            signal = mapper.readValue(body, TradingViewSignal.class);
        } catch (Exception e) {
            System.out.println("WEBHOOK NON JSON: " + e.getMessage());
            CompletableFuture.runAsync(() -> telegram.send("⚠️ MARADONA WEBHOOK NON JSON\nRicevuto:\n" + body + "\n\nServe JSON Pine/TradingView per Entry/SL/TP."));
            return ResponseEntity.badRequest().body(Map.of("ok", false, "error", "body must be JSON"));
        }

        if (props.getTv().getSecret() != null && !props.getTv().getSecret().isBlank()
                && !props.getTv().getSecret().equals(signal.secret())) {
            return ResponseEntity.status(401).body(Map.of("ok", false, "error", "bad secret"));
        }

        final TradingViewSignal asyncSignal = signal;
        CompletableFuture.runAsync(() -> processSignal(asyncSignal));

        return ResponseEntity.ok(Map.of(
                "ok", true,
                "received", true,
                "symbol", signal.symbol() == null ? "" : signal.symbol(),
                "signal", signal.safeSignal()
        ));
    }

    private void processSignal(TradingViewSignal signal) {
        try {
            System.out.println("WEBHOOK ASYNC START: " + signal.symbol() + " " + signal.safeSignal());

            String tvSymbol = signal.symbol();
            String bybitSymbol = marketState.normalizeBybitSymbol(tvSymbol);
            MarketSnapshot bybitSnapshot = marketState.get(bybitSymbol);
            Collection<ExchangeSnapshot> exchangeSnapshots = marketState.getAllExchanges(tvSymbol);

            System.out.println("TV SYMBOL: " + tvSymbol + " -> BYBIT SYMBOL: " + bybitSymbol);
            System.out.println("BYBIT SNAPSHOT FOUND: " + (bybitSnapshot != null));
            System.out.println("EXCHANGE SNAPSHOTS: " + exchangeSnapshots.size());

            AutoClusterService.OperationalMap opMap = autoClusters.prepareForSignal(signal, "WEBHOOK_" + signal.safeSignal());
            System.out.println("AUTO CLUSTER EVENT MAP: " + autoClusters.shortSummary(opMap));

            sendManualClusterHitReminders(signal, bybitSnapshot);

            Decision decision = brain.evaluate(signal, bybitSnapshot);
            LiquidityDecision liquidity = liquidityVoteEngine.evaluate(signal, exchangeSnapshots);
            System.out.println("Liquidity: " + liquidity.status() + " " + liquidity.scoreLabel());

            boolean microMaster = isMicroMaster(signal);
            boolean forexSymbol = props.isForexSymbol(signal.symbol());
            boolean isMaster = signal.safeSignal().toUpperCase().contains("MASTER");

            if (!autoClusters.shouldNotifySignal(signal)) {
                System.out.println("SEGNALE NASCOSTO / SOLO BRAIN: " + signal.safeSignal() + " - mappa aggiornata, nessun Telegram operativo.");
                System.out.println("WEBHOOK ASYNC END: " + signal.symbol() + " " + signal.safeSignal());
                return;
            }

            if (microMaster && props.getMultiExchange().isEnabled() && !liquidity.confirmed()) {
                System.out.println("MICRO GZ NON NOTIFICATA: " + liquidity.status() + " - " + liquidity.reason());
                if (props.getMultiExchange().isNotifyRejectedMicroGz()) {
                    telegram.send(formatTelegram(signal, bybitSnapshot, decision, liquidity));
                }
                System.out.println("WEBHOOK ASYNC END: " + signal.symbol() + " " + signal.safeSignal());
                return;
            }

            if (forexSymbol && isMaster && !liquidity.confirmed()) {
                System.out.println("FOREX NON NOTIFICATO: " + liquidity.status() + " - " + liquidity.reason());
                if (props.getForex().isNotifyRejected()) {
                    telegram.send(formatTelegram(signal, bybitSnapshot, decision, liquidity));
                }
                System.out.println("WEBHOOK ASYNC END: " + signal.symbol() + " " + signal.safeSignal());
                return;
            }

            if (!shouldSendOperationalTelegram(signal, decision, liquidity, microMaster, forexSymbol)) {
                System.out.println("SEGNALE NASCOSTO / SOLO BRAIN: " + signal.safeSignal() + " action=" + decision.action() + " liquidity=" + liquidity.status());
                System.out.println("WEBHOOK ASYNC END: " + signal.symbol() + " " + signal.safeSignal());
                return;
            }

            SignalOverlapService.OverlapCheck overlap = overlapService.evaluateAndRemember(signal, decision, liquidity);
            if (overlap.duplicate()) {
                System.out.println("DUPLICATE/OVERLAP SIGNAL SUPPRESSED: " + overlap.message());
                if (props.getNotifications().isNotifyDuplicateOverlap()) {
                    telegram.send(overlapService.formatDuplicateNote(overlap));
                }
                System.out.println("WEBHOOK ASYNC END: " + signal.symbol() + " " + signal.safeSignal());
                return;
            }

            telegram.send(formatTelegram(signal, bybitSnapshot, decision, liquidity));
            System.out.println("WEBHOOK ASYNC END: " + signal.symbol() + " " + signal.safeSignal());
        } catch (Exception e) {
            System.out.println("WEBHOOK ASYNC ERROR: " + e.getMessage());
            e.printStackTrace();
            try {
                telegram.send("⚠️ MARADONA SERVER ERROR\n" + e.getMessage());
            } catch (Exception ignored) {
                System.out.println("TELEGRAM ERROR DURANTE SERVER ERROR: " + ignored.getMessage());
            }
        }
    }

    private void sendManualClusterHitReminders(TradingViewSignal signal, MarketSnapshot bybitSnapshot) {
        if (signal == null || bybitSnapshot == null || bybitSnapshot.mid() <= 0) return;
        try {
            List<String> alerts = coinglass.checkTouchedLevels(signal.symbol(), bybitSnapshot.mid(), signal.tf());
            for (String alert : alerts) {
                System.out.println("COINGLASS MANUAL CLUSTER TOUCHED: " + alert.replace("\n", " | "));
                telegram.send(alert);
            }
        } catch (Exception e) {
            System.out.println("COINGLASS TOUCH CHECK ERROR: " + e.getMessage());
        }
    }

    private boolean shouldSendOperationalTelegram(TradingViewSignal signal, Decision decision, LiquidityDecision liquidity, boolean microMaster, boolean forexSymbol) {
        String sig = signal.safeSignal().toUpperCase();
        String action = decision.action() == null ? "" : decision.action().toUpperCase();

        if (sig.contains("READY")) return props.getNotifications().isNotifyReady();
        if (sig.contains("PRE")) return props.getNotifications().isNotifyPre();
        if (sig.contains("MICRO_TABLE_RESET")) return props.getNotifications().isNotifyMicroTableReset();
        if (sig.contains("SL_RESET") || action.contains("SL_RESET")) return props.getNotifications().isNotifySlReset();
        if (action.equals("MONITOR") || sig.contains("MONITOR")) return props.getNotifications().isNotifyMonitor();

        if (sig.contains("WARNING") || sig.contains("PROTECT") || sig.contains("RISK")) {
            return props.getNotifications().isNotifyWarning();
        }

        if (sig.contains("MASTER")) {
            if (microMaster) return liquidity != null && liquidity.confirmed();
            if (forexSymbol) return liquidity != null && liquidity.confirmed() && decision.operative();
            if (action.contains("ENTRY_WATCH") || action.contains("MASTER_WATCH")) return props.getNotifications().isNotifyMasterWatch();
            if (!decision.operative()) return props.getNotifications().isNotifyMasterRejected();
            return liquidity != null && liquidity.confirmed();
        }

        return props.getNotifications().isNotifyOther();
    }

    private String formatTelegram(TradingViewSignal s, MarketSnapshot m, Decision d, LiquidityDecision liquidity) {
        TargetValidation tvTargets = TargetValidation.validate(s);
        String side = s.safeSide().toUpperCase();
        String signal = s.safeSignal().toUpperCase();
        boolean isMaster = signal.contains("MASTER");
        boolean isMicroGz = isMicroMaster(s);

        String orderBookStatus = orderBookStatus(side, m, d);
        double autoEntryCandidate = autoClusters.entryCandidateFromAutoClusters(s);
        double cgEntryCandidate = coinglass.entryCandidateFromCoinglass(s);
        double brainEntry = brainEntry(s, m, autoEntryCandidate, cgEntryCandidate);
        AutoClusterService.AutoClusterCheck autoCheck = autoClusters.evaluate(s, brainEntry);
        CoinglassManualService.CoinglassCheck cgCheck = coinglass.evaluate(s, brainEntry);

        StringBuilder b = new StringBuilder();
        b.append(friendlyTitle(s, d, isMicroGz, liquidity)).append("\n\n");
        b.append("PAIR: ").append(n(s.symbol())).append("\n");
        b.append("TF: ").append(n(s.tf())).append("\n\n");

        b.append("DECISIONE: ").append(friendlyDecision(d.action(), side, isMicroGz, liquidity)).append("\n");
        b.append("CONFIDENCE: ").append(adjustConfidence(d.confidence(), liquidity, isMicroGz)).append("%\n\n");

        if (isMaster && brainEntry > 0) {
            b.append("ENTRY DECISA DAL BRAIN: ").append(round(brainEntry)).append("\n");
        } else {
            b.append("ENTRY: ").append(round(s.safeEntry())).append("\n");
        }

        if (s.safeEntryRangeLow() > 0 || s.safeEntryRangeHigh() > 0) {
            b.append("ENTRY RANGE: ").append(round(s.safeEntryRangeLow())).append(" - ").append(round(s.safeEntryRangeHigh())).append("\n");
        }
        if (s.safeNoChaseAbove() > 0) b.append("NO CHASE ABOVE: ").append(round(s.safeNoChaseAbove())).append("\n");
        if (s.safeNoChaseBelow() > 0) b.append("NO CHASE BELOW: ").append(round(s.safeNoChaseBelow())).append("\n");

        b.append("\nSL TRADINGVIEW: ").append(round(s.safeSl())).append("\n");
        if (autoCheck != null && autoCheck.map() != null) {
            AutoClusterService.OperationalMap map = autoCheck.map();
            if (map.retailLiquidityPool() > 0) {
                b.append("RETAIL LIQUIDITY POOL: ").append(round(map.retailLiquidityPool())).append("\n");
            }
            if (map.protectiveStopEstimate() > 0) {
                b.append("OUR SL PROTETTIVO STIMATO: ").append(round(map.protectiveStopEstimate())).append("\n");
            }
            if (map.stopWarning() != null && !map.stopWarning().isBlank()) {
                b.append("⚠️ SL WARNING: ").append(map.stopWarning()).append("\n");
            }
        }
        b.append("TP1: ").append(round(s.safeTp1())).append("\n");
        b.append("TP2: ").append(round(s.safeTp2())).append("\n");
        b.append("TP3: ").append(round(s.safeTp3())).append("\n");

        if (!tvTargets.valid()) {
            b.append("\n⚠️ TP VALIDATION: ").append(tvTargets.warning()).append("\n");
            if (tvTargets.correctedTp1() != null) b.append("TP1 corretto/suggerito: ").append(round(tvTargets.correctedTp1())).append("\n");
            if (tvTargets.correctedTp2() != null) b.append("TP2 corretto/suggerito: ").append(round(tvTargets.correctedTp2())).append("\n");
            if (tvTargets.correctedTp3() != null) b.append("TP3 corretto/suggerito: ").append(round(tvTargets.correctedTp3())).append("\n");
        }

        b.append("\nENTRY TYPE: ").append(n(s.entryType())).append("\n");
        b.append("SETUP: ").append(n(s.safeSetupFamily())).append("\n");
        b.append("BRAIN: ").append(n(s.brain())).append("\n");
        b.append("HTF: ").append(n(s.htf())).append("\n");
        b.append("MTF: ").append(n(s.mtf())).append("\n");
        b.append("SCORE L/S: ").append(s.safeScoreLong()).append(" / ").append(s.safeScoreShort()).append("\n");
        b.append("SCORE: ").append(s.safeScore()).append("\n");
        b.append("COMPRESSION: ").append(n(s.compression())).append("\n\n");

        b.append("ORDER BOOK BYBIT: ").append(orderBookStatus).append("\n");
        b.append("LIQUIDITY ENGINE: ").append(liquidity == null ? "NON DISPONIBILE" : liquidity.friendlyLine()).append("\n");
        b.append(formatExchangeVotes(liquidity));
        b.append("CLUSTER AUTO 0.4.7 EVENT: ").append(autoClusterFriendly(autoCheck)).append("\n");
        if (autoCheck != null && autoCheck.map() != null) {
            b.append("MAPPA READY/MASTER: ").append(autoCheck.map().confluenceSummary()).append("\n");
            if (autoCheck.map().retailLiquidityPool() > 0) {
                b.append("POOL RETAIL: ").append(round(autoCheck.map().retailLiquidityPool()));
                if (autoCheck.map().protectiveStopEstimate() > 0) {
                    b.append(" | OUR SL STIMATO: ").append(round(autoCheck.map().protectiveStopEstimate()));
                } else {
                    b.append(" | OUR SL STIMATO: NON VALIDO / NON CALCOLABILE");
                }
                b.append("\n");
            }
        }
        b.append("COINGLASS MANUALE: ").append(cgFriendly(cgCheck)).append("\n");

        b.append("\nMOTIVO:\n").append(friendlyReason(s, m, d, orderBookStatus, liquidity, isMicroGz));
        if (autoCheck != null && !"NOT_SET".equals(autoCheck.status())) {
            b.append("\nCluster automatici: ").append(autoCheck.reason());
        }
        if (cgCheck != null && !"NOT_SET".equals(cgCheck.status())) {
            b.append("\nCoinglass manuale: ").append(cgCheck.reason());
        }
        b.append("\n");
        b.append("\nAZIONE:\n").append(friendlyAction(s, d, brainEntry, liquidity, isMicroGz));

        return b.toString();
    }

    private boolean isMicroMaster(TradingViewSignal s) {
        String signal = s.safeSignal().toUpperCase();
        return signal.contains("MASTER_PELE_MICRO_GZ")
                || (signal.contains("MASTER") && s.safeSetupFamily().toUpperCase().contains("MICRO_GZ"));
    }

    private String friendlyTitle(TradingViewSignal s, Decision d, boolean isMicroGz, LiquidityDecision liquidity) {
        String side = s.safeSide().toUpperCase();
        String action = d.action() == null ? "" : d.action().toUpperCase();
        String signal = s.safeSignal().toUpperCase();
        if (isMicroGz && signal.contains("MASTER")) return "🎯 MASTER PELE MICRO GZ " + side + " CONFERMATO";
        if (action.contains("ENTRY_VALIDATED")) return "✅ MARADONA ENTRY VALIDATA " + side;
        if (action.contains("ENTRY_WATCH") || action.contains("MASTER_WATCH")) return "🟨 MARADONA MASTER WATCH " + side;
        if (action.contains("BLOCK") || action.contains("NO_BYBIT") || action.contains("TARGET_ERROR")) return "⛔ MARADONA MASTER NON CONFERMATO " + side;
        if (action.contains("READY")) return "🟠 MARADONA READY " + side;
        if (action.contains("WARNING") || action.contains("PROTECT")) return "⚠️ MARADONA WARNING / PROTECT";
        if (action.contains("FLIP")) return "🔁 MARADONA FLIP " + side;
        return d.telegramTitle() == null ? "⚪ MARADONA" : d.telegramTitle();
    }

    private String friendlyDecision(String action, String side, boolean isMicroGz, LiquidityDecision liquidity) {
        if (isMicroGz && liquidity != null && liquidity.confirmed()) return "MASTER PELE MICRO GZ VALIDATO " + side + " " + liquidity.scoreLabel();
        String a = action == null ? "" : action.toUpperCase();
        if (a.contains("ENTRY_VALIDATED")) return "ENTRY VALIDATA " + side;
        if (a.contains("ENTRY_WATCH") || a.contains("MASTER_WATCH")) return "MASTER DA MONITORARE " + side;
        if (a.contains("BLOCK") || a.contains("NO_BYBIT") || a.contains("TARGET_ERROR")) return "ENTRY BLOCCATA / NON CONFERMATA " + side;
        if (a.contains("READY")) return "READY " + side;
        if (a.contains("WARNING") || a.contains("PROTECT")) return "WARNING / PROTECT";
        if (a.contains("FLIP")) return "FLIP " + side;
        return action == null ? "-" : action;
    }

    private int adjustConfidence(int base, LiquidityDecision liquidity, boolean isMicroGz) {
        if (!isMicroGz || liquidity == null) return base;
        int boosted = base + (liquidity.confirms() * 8) - (liquidity.contrary() * 10);
        return Math.max(0, Math.min(100, boosted));
    }

    private String orderBookStatus(String side, MarketSnapshot m, Decision d) {
        if (m == null) return "NON DISPONIBILE";
        String action = d.action() == null ? "" : d.action().toUpperCase();
        boolean isLong = side != null && side.toUpperCase().contains("LONG");
        boolean isShort = side != null && side.toUpperCase().contains("SHORT");
        if (action.contains("ENTRY_VALIDATED")) return isLong ? "CONFERMA LONG" : "CONFERMA SHORT";
        if (action.contains("ENTRY_WATCH")) return isLong ? "CONFERMA LONG PARZIALE" : "CONFERMA SHORT PARZIALE";
        if (action.contains("BLOCK")) return isLong ? "NON CONFERMA LONG" : "NON CONFERMA SHORT";
        if (isLong) return (m.bidPressure() > m.askPressure() && m.deltaProxy() > 0) ? "CONFERMA LONG" : "NON CONFERMA LONG";
        if (isShort) return (m.askPressure() > m.bidPressure() && m.deltaProxy() < 0) ? "CONFERMA SHORT" : "NON CONFERMA SHORT";
        return "NEUTRO";
    }

    private double brainEntry(TradingViewSignal s, MarketSnapshot m, double autoCandidate, double cgCandidate) {
        double low = s.safeEntryRangeLow();
        double high = s.safeEntryRangeHigh();
        double entry = s.safeEntry();
        if (low <= 0 || high <= 0 || high < low) return entry;
        String side = s.safeSide().toUpperCase();
        double candidate = 0.0;
        if (side.contains("SHORT") && m != null) candidate = m.strongestAskPrice();
        if (side.contains("LONG") && m != null) candidate = m.strongestBidPrice();
        if (candidate >= low && candidate <= high) return candidate;
        if (autoCandidate >= low && autoCandidate <= high) return autoCandidate;
        if (cgCandidate >= low && cgCandidate <= high) return cgCandidate;
        if (entry >= low && entry <= high) return entry;
        return (low + high) / 2.0;
    }



    private String formatExchangeVotes(LiquidityDecision liquidity) {
        if (liquidity == null || liquidity.votes() == null || liquidity.votes().isEmpty()) {
            return "EXCHANGE VOTES: dati non ancora disponibili\n";
        }
        StringBuilder out = new StringBuilder();
        for (com.maradona.model.ExchangeVote v : liquidity.votes()) {
            out.append(v.exchange().toUpperCase()).append(": ")
                    .append(v.vote())
                    .append(" (score ").append(v.score()).append(")")
                    .append(" - ").append(shortVoteReason(v.reason()))
                    .append("\n");
        }
        return out.toString();
    }

    private String shortVoteReason(String reason) {
        if (reason == null || reason.isBlank()) return "flow misto";
        String r = reason.replace("; ", ", ").trim();
        if (r.endsWith(",")) r = r.substring(0, r.length() - 1);
        return r;
    }

    private String autoClusterFriendly(AutoClusterService.AutoClusterCheck auto) {
        if (auto == null) return "NON DISPONIBILE";
        String line = auto.friendlyLine() == null ? "NEUTRO" : auto.friendlyLine().replace("CLUSTER AUTO: ", "");
        if (auto.nearestLevel() > 0) return line + " - livello " + round(auto.nearestLevel());
        if (auto.levels() != null) {
            int above = auto.levels().above() == null ? 0 : auto.levels().above().size();
            int below = auto.levels().below() == null ? 0 : auto.levels().below().size();
            return line + " - above " + above + " / below " + below;
        }
        return line;
    }

    private String cgFriendly(CoinglassManualService.CoinglassCheck cg) {
        if (cg == null) return "NON IMPOSTATO";
        String line = cg.friendlyLine() == null ? "NEUTRO" : cg.friendlyLine().replace("COINGLASS: ", "");
        if (cg.nearestLevel() > 0) return line + " - livello " + round(cg.nearestLevel());
        return line;
    }

    private String friendlyReason(TradingViewSignal s, MarketSnapshot m, Decision d, String orderBookStatus,
                                  LiquidityDecision liquidity, boolean isMicroGz) {
        String side = s.safeSide().toUpperCase();
        String signal = s.safeSignal().toUpperCase();
        String action = d.action() == null ? "" : d.action().toUpperCase();
        if (m == null) return "TradingView ha inviato il segnale, ma Java Brain non ha ancora uno snapshot Bybit valido. Messaggio solo informativo.";
        if (isMicroGz && liquidity != null) {
            return "TradingView ha dato " + signal + ". Java Brain ha validato la micro Golden Zone con motore gratuito multi-exchange. " + liquidity.reason();
        }
        if (action.contains("ENTRY_VALIDATED")) {
            return "TradingView ha dato " + signal + ". Java Brain conferma dopo controllo order book. " +
                    (side.contains("SHORT") ? "Pressione venditrice favorevole e flow coerente con lo short." : "Pressione compratrice favorevole e flow coerente con il long.");
        }
        if (action.contains("BLOCK")) {
            return "TradingView ha dato " + signal + ", ma Java Brain non trova conferma sufficiente sul book. " + orderBookStatus + ".";
        }
        if (action.contains("READY")) return "Pelé ha ricevuto palla. Java Brain monitora il contesto, ma non è ancora una entry.";
        if (action.contains("WARNING") || action.contains("PROTECT")) return "Segnale di gestione/protezione: valutare rischio opposto o trade attivo.";
        return d.reason() == null ? "-" : italianize(d.reason());
    }

    private String friendlyAction(TradingViewSignal s, Decision d, double brainEntry, LiquidityDecision liquidity, boolean isMicroGz) {
        String action = d.action() == null ? "" : d.action().toUpperCase();
        String side = s.safeSide().toUpperCase();
        if (isMicroGz && liquidity != null && liquidity.confirmed()) {
            return (side.contains("SHORT") ? "Micro GZ short operativa." : "Micro GZ long operativa.") + noChaseText(s, side);
        }
        if (action.contains("ENTRY_VALIDATED")) {
            return (side.contains("SHORT") ? "Short valido." : "Long valido.") + noChaseText(s, side);
        }
        if (action.contains("ENTRY_WATCH")) return "Segnale da monitorare. Attendere retest o conferma più pulita prima di entrare.";
        if (action.contains("BLOCK")) return "Non entrare ora. Aspetta nuovo MASTER, retest migliore o conferma del Brain.";
        if (action.contains("READY")) return "Guardare grafico e dashboard. Non entrare finché non arriva MASTER operativo.";
        if (action.contains("WARNING") || action.contains("PROTECT")) return "Proteggi il trade o evita nuove entry contrarie finché il Brain non conferma.";
        return "Monitorare.";
    }

    private String noChaseText(TradingViewSignal s, String side) {
        if (side.contains("SHORT") && s.safeNoChaseBelow() > 0) return " Non inseguire sotto " + round(s.safeNoChaseBelow()) + ".";
        if (side.contains("LONG") && s.safeNoChaseAbove() > 0) return " Non inseguire sopra " + round(s.safeNoChaseAbove()) + ".";
        return "";
    }

    private String italianize(String reason) {
        return reason
                .replace("ask pressure forte", "pressione venditrice forte")
                .replace("bid pressure forte", "pressione compratrice forte")
                .replace("delta proxy negativo", "delta negativo")
                .replace("delta proxy positivo", "delta positivo")
                .replace("velocity attiva", "velocità del book attiva")
                .replace("spread ok", "spread regolare")
                .replace("TW MASTER", "MASTER TradingView");
    }

    private String n(String v) { return v == null || v.isBlank() ? "-" : v; }
    private String round(double v) { return String.format(java.util.Locale.US, "%.4f", v); }

    @GetMapping("/status/{symbol}")
    public ResponseEntity<?> status(@PathVariable String symbol) {
        return ResponseEntity.ok(marketState.get(symbol));
    }

    @GetMapping("/status-normalized/{symbol}")
    public ResponseEntity<?> statusNormalized(@PathVariable String symbol) {
        String normalized = marketState.normalizeBybitSymbol(symbol);
        MarketSnapshot snapshot = marketState.get(normalized);
        return ResponseEntity.ok(java.util.Map.of(
                "requested", symbol,
                "normalized", normalized,
                "snapshotFound", snapshot != null,
                "snapshot", snapshot
        ));
    }

    @GetMapping("/status-exchanges/{symbol}")
    public ResponseEntity<?> statusExchanges(@PathVariable String symbol) {
        return ResponseEntity.ok(marketState.getAllExchanges(symbol));
    }

    @GetMapping("/auto-clusters/{symbol}")
    public ResponseEntity<?> autoClusters(@PathVariable String symbol) {
        return ResponseEntity.ok(autoClusters.buildLevels(symbol));
    }
}
