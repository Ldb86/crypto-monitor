package com.maradona.liquidity;

import com.maradona.config.MaradonaProperties;
import com.maradona.model.ExchangeSnapshot;
import com.maradona.model.ExchangeVote;
import com.maradona.model.LiquidityDecision;
import com.maradona.model.MarketSnapshot;
import com.maradona.model.TradingViewSignal;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;

@Service
public class LiquidityVoteEngine {
    private final MaradonaProperties props;

    public LiquidityVoteEngine(MaradonaProperties props) {
        this.props = props;
    }

    public LiquidityDecision evaluate(TradingViewSignal signal, Collection<ExchangeSnapshot> snapshots) {
        String side = signal == null ? "UNKNOWN" : signal.safeSide().toUpperCase(Locale.ROOT);
        String direction = side.contains("LONG") ? "LONG" : side.contains("SHORT") ? "SHORT" : "UNKNOWN";
        if (signal != null && props.isForexSymbol(signal.symbol())) {
            return evaluateForexBybitOnly(signal, snapshots, direction);
        }
        return evaluateCryptoMultiExchange(signal, snapshots, direction);
    }

    private LiquidityDecision evaluateCryptoMultiExchange(TradingViewSignal signal, Collection<ExchangeSnapshot> snapshots, String direction) {
        List<ExchangeVote> votes = new ArrayList<>();

        if (snapshots != null) {
            for (ExchangeSnapshot snap : snapshots) {
                if (snap == null || snap.market() == null) continue;
                votes.add(vote(direction, snap));
            }
        }

        int available = votes.size();
        int confirms = (int) votes.stream().filter(v -> "CONFIRM".equals(v.vote())).count();
        int contrary = (int) votes.stream().filter(v -> "CONTRA".equals(v.vote())).count();
        int required = Math.max(2, props.getMultiExchange().getRequiredConfirmations());
        boolean confirmed = confirms >= required;

        String status;
        String friendly;
        String reason;
        if (available < required) {
            status = "WAIT_EXCHANGES";
            friendly = "LIQUIDITY ENGINE: ATTESA DATI " + required + "/3";
            reason = "Servono almeno " + required + " exchange disponibili per confermare il segnale.";
        } else if (confirmed) {
            status = "CONFIRMED_2_OF_3";
            friendly = "LIQUIDITY ENGINE: CONFERMA " + direction + " " + confirms + "/" + available;
            reason = "Almeno " + required + " exchange confermano direzione e pressione coerente.";
        } else if (contrary >= required) {
            status = "REJECTED_2_OF_3";
            friendly = "LIQUIDITY ENGINE: NON CONFERMA " + direction;
            reason = "Almeno " + required + " exchange sono contrari o non coerenti con il segnale.";
        } else {
            status = "NEUTRAL";
            friendly = "LIQUIDITY ENGINE: NEUTRO " + confirms + "/" + available;
            reason = "Conferma multi-exchange insufficiente: meglio non inviare notifica operativa aggressiva.";
        }
        return new LiquidityDecision(confirmed, confirms, available, contrary, direction, status, friendly, reason, votes);
    }

    private LiquidityDecision evaluateForexBybitOnly(TradingViewSignal signal, Collection<ExchangeSnapshot> snapshots, String direction) {
        if (props.getForex().isMultiProviderEnabled()) {
            return evaluateForexMultiProvider(signal, snapshots, direction);
        }
        return evaluateForexSingleBybit(signal, snapshots, direction);
    }

    private LiquidityDecision evaluateForexMultiProvider(TradingViewSignal signal, Collection<ExchangeSnapshot> snapshots, String direction) {
        List<ExchangeVote> votes = new ArrayList<>();
        if (snapshots != null) {
            for (ExchangeSnapshot snap : snapshots) {
                if (snap == null || snap.market() == null) continue;
                String ex = snap.exchange() == null ? "" : snap.exchange().toUpperCase(Locale.ROOT);
                if (!(ex.equals("BYBIT") || ex.equals("DUKASCOPY") || ex.equals("OANDA") || ex.equals("FXCM"))) continue;
                ExchangeVote raw = vote(direction, snap);
                votes.add(applyProviderThreshold(raw, snap));
            }
        }
        int available = votes.size();
        int confirms = (int) votes.stream().filter(v -> "CONFIRM".equals(v.vote())).count();
        int contrary = (int) votes.stream().filter(v -> "CONTRA".equals(v.vote())).count();
        int required = Math.max(2, props.getForex().getRequiredConfirmations());
        boolean confirmed = confirms >= required;

        if (available < required) {
            return new LiquidityDecision(false, confirms, available, contrary, direction,
                    "FOREX_WAIT_PROVIDERS",
                    "FOREX ENGINE: ATTESA PROVIDER " + available + "/" + required,
                    "Forex multi-provider attivo, ma servono almeno " + required + " fonti tra Bybit/Dukascopy/OANDA/FXCM.",
                    votes);
        }
        if (confirmed) {
            return new LiquidityDecision(true, confirms, available, contrary, direction,
                    "FOREX_CONFIRMED_2_OF_3",
                    "FOREX ENGINE: CONFERMA " + direction + " " + confirms + "/" + available,
                    "Almeno " + required + " provider forex confermano direzione e pressione coerente.",
                    votes);
        }
        if (contrary >= required) {
            return new LiquidityDecision(false, confirms, available, contrary, direction,
                    "FOREX_REJECTED_2_OF_3",
                    "FOREX ENGINE: NON CONFERMA " + direction,
                    "Almeno " + required + " provider forex sono contrari al segnale.",
                    votes);
        }
        return new LiquidityDecision(false, confirms, available, contrary, direction,
                "FOREX_NEUTRAL",
                "FOREX ENGINE: NEUTRO " + confirms + "/" + available,
                "Conferma forex multi-provider insufficiente: meglio non inviare notifica operativa aggressiva.",
                votes);
    }

    private LiquidityDecision evaluateForexSingleBybit(TradingViewSignal signal, Collection<ExchangeSnapshot> snapshots, String direction) {
        List<ExchangeVote> votes = new ArrayList<>();
        ExchangeSnapshot bybit = null;
        if (snapshots != null) {
            for (ExchangeSnapshot snap : snapshots) {
                if (snap == null || snap.market() == null) continue;
                if ("BYBIT".equalsIgnoreCase(snap.exchange())) {
                    bybit = snap;
                    break;
                }
            }
        }
        if (bybit == null) {
            return new LiquidityDecision(false, 0, 0, 0, direction,
                    "FOREX_WAIT_BYBIT",
                    "FOREX ENGINE: ATTESA DATI BYBIT",
                    "Mercato forex/TradFi configurato in BYBIT_ONLY, ma manca snapshot Bybit.",
                    votes);
        }

        ExchangeVote v = vote(direction, bybit);
        votes.add(v);
        double spread = bybit.market().spreadPct();
        boolean spreadOk = spread <= Math.max(0.01, props.getForex().getMaxSpreadPct());
        boolean confirmed = "CONFIRM".equals(v.vote()) && v.score() >= props.getForex().getMinBybitScore() && spreadOk;
        boolean contrary = "CONTRA".equals(v.vote());

        String status;
        String friendly;
        String reason;
        if (confirmed) {
            status = "FOREX_BYBIT_ONLY_CONFIRMED";
            friendly = "FOREX ENGINE: BYBIT_ONLY CONFERMA " + direction + " score " + v.score();
            reason = "Bybit conferma direzione con soglia severa forex; spread ok " + round(spread) + "%";
        } else if (contrary) {
            status = "FOREX_BYBIT_ONLY_REJECTED";
            friendly = "FOREX ENGINE: BYBIT_ONLY NON CONFERMA " + direction;
            reason = "Bybit è contrario al segnale forex/TradFi. " + v.reason();
        } else if (!spreadOk) {
            status = "FOREX_SPREAD_BLOCKED";
            friendly = "FOREX ENGINE: SPREAD TROPPO ALTO";
            reason = "Spread " + round(spread) + "% oltre soglia " + props.getForex().getMaxSpreadPct() + "%";
        } else {
            status = "FOREX_BYBIT_ONLY_NEUTRAL";
            friendly = "FOREX ENGINE: BYBIT_ONLY NEUTRO " + v.score();
            reason = "Score Bybit insufficiente per compensare l'assenza degli altri provider forex.";
        }
        return new LiquidityDecision(confirmed, confirmed ? 1 : 0, 1, contrary ? 1 : 0, direction, status, friendly, reason, votes);
    }

    private ExchangeVote applyProviderThreshold(ExchangeVote raw, ExchangeSnapshot snap) {
        if (raw == null || snap == null) return raw;
        String ex = snap.exchange() == null ? "" : snap.exchange().toUpperCase(Locale.ROOT);
        int min = switch (ex) {
            case "BYBIT" -> props.getForex().getMinBybitScore();
            case "DUKASCOPY" -> props.getForex().getDukascopy().getMinScore();
            case "OANDA" -> props.getForex().getOanda().getMinScore();
            case "FXCM" -> props.getForex().getFxcm().getMinScore();
            default -> 4;
        };
        boolean spreadOk = snap.market() == null || snap.market().spreadPct() <= Math.max(0.01, props.getForex().getMaxSpreadPct());
        if ("CONFIRM".equals(raw.vote()) && (raw.score() < min || !spreadOk)) {
            String reason = raw.reason() + (raw.score() < min ? " score sotto soglia " + min + "; " : "")
                    + (!spreadOk ? "spread oltre soglia forex; " : "");
            return new ExchangeVote(raw.exchange(), "NEUTRAL", raw.score(), reason);
        }
        return raw;
    }

    private ExchangeVote vote(String direction, ExchangeSnapshot snap) {
        MarketSnapshot m = snap.market();
        int s = 0;
        StringBuilder reason = new StringBuilder();
        double bid = m.bidPressure();
        double ask = m.askPressure();
        double delta = m.deltaProxy();
        double velocity = m.velocity();
        double spread = m.spreadPct();

        if ("LONG".equals(direction)) {
            if (bid > ask * 1.10) { s += 2; reason.append("pressione compratrice; "); }
            if (delta > 0) { s += 2; reason.append("delta positivo; "); }
            if (snap.hasFreshLiquidation(180) && "SHORT_LIQ".equalsIgnoreCase(snap.liquidationBias())) { s += 1; reason.append("liquidazioni short recenti; "); }

            if (ask > bid * 1.20) { s -= 2; reason.append("pressione venditrice contraria; "); }
            if (delta < 0) { s -= 2; reason.append("delta negativo contrario; "); }
        } else if ("SHORT".equals(direction)) {
            if (ask > bid * 1.10) { s += 2; reason.append("pressione venditrice; "); }
            if (delta < 0) { s += 2; reason.append("delta negativo; "); }
            if (snap.hasFreshLiquidation(180) && "LONG_LIQ".equalsIgnoreCase(snap.liquidationBias())) { s += 1; reason.append("liquidazioni long recenti; "); }

            if (bid > ask * 1.20) { s -= 2; reason.append("pressione compratrice contraria; "); }
            if (delta > 0) { s -= 2; reason.append("delta positivo contrario; "); }
        }

        if (velocity > 0.35) { s += 1; reason.append("book attivo; "); }
        if (spread < 0.08) { s += 1; reason.append("spread regolare; "); }

        String vote = s >= 3 ? "CONFIRM" : s <= -2 ? "CONTRA" : "NEUTRAL";
        if (reason.isEmpty()) reason.append("flow misto");
        return new ExchangeVote(snap.exchange(), vote, s, reason.toString());
    }

    private String round(double v) {
        return String.format(Locale.US, "%.4f", v);
    }
}
