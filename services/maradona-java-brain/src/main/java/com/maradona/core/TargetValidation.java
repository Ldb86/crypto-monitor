package com.maradona.core;

import com.maradona.model.TradingViewSignal;

import java.util.ArrayList;
import java.util.List;

public record TargetValidation(
        boolean valid,
        String warning,
        Double correctedTp1,
        Double correctedTp2,
        Double correctedTp3
) {
    public static TargetValidation validate(TradingViewSignal s) {
        if (s == null) return ok();
        String side = s.safeSide() == null ? "UNKNOWN" : s.safeSide().toUpperCase();
        double entry = s.safeEntry();
        if (entry <= 0 || (!side.contains("LONG") && !side.contains("SHORT"))) return ok();

        List<Double> tps = new ArrayList<>();
        if (s.tp1() != null && s.tp1() > 0) tps.add(s.tp1());
        if (s.tp2() != null && s.tp2() > 0) tps.add(s.tp2());
        if (s.tp3() != null && s.tp3() > 0) tps.add(s.tp3());
        if (tps.isEmpty()) return ok();

        List<Double> directional = new ArrayList<>();
        List<String> bad = new ArrayList<>();
        String[] names = {"TP1", "TP2", "TP3"};
        Double[] vals = {s.tp1(), s.tp2(), s.tp3()};
        for (int i = 0; i < vals.length; i++) {
            Double v = vals[i];
            if (v == null || v <= 0) continue;
            boolean good = side.contains("SHORT") ? v < entry : v > entry;
            if (good) directional.add(v); else bad.add(names[i] + "=" + fmt(v));
        }

        boolean validDirection = bad.isEmpty();
        boolean ordered = true;
        if (directional.size() >= 2) {
            for (int i = 1; i < directional.size(); i++) {
                if (side.contains("SHORT")) {
                    if (!(directional.get(i) < directional.get(i - 1))) ordered = false;
                } else {
                    if (!(directional.get(i) > directional.get(i - 1))) ordered = false;
                }
            }
        }

        if (validDirection && ordered) return ok();

        // Corrective ordering: keep only directional TPs and sort them from nearest to farthest.
        directional.sort((a, b) -> side.contains("SHORT") ? Double.compare(b, a) : Double.compare(a, b));
        Double c1 = directional.size() > 0 ? directional.get(0) : null;
        Double c2 = directional.size() > 1 ? directional.get(1) : null;
        Double c3 = directional.size() > 2 ? directional.get(2) : null;

        StringBuilder w = new StringBuilder();
        w.append("TP direzionali incoerenti. ");
        if (!bad.isEmpty()) {
            w.append("Per ").append(side.contains("SHORT") ? "SHORT" : "LONG")
             .append(" questi target sono dalla parte sbagliata: ").append(String.join(", ", bad)).append(". ");
        }
        if (!ordered) w.append("Ordine TP non progressivo. ");
        if (c1 != null) {
            w.append("TP validi riorganizzati: TP1=").append(fmt(c1));
            if (c2 != null) w.append(" TP2=").append(fmt(c2));
            if (c3 != null) w.append(" TP3=").append(fmt(c3));
            w.append(".");
        } else {
            w.append("Nessun TP coerente: usare cluster/manuale o attendere nuovo alert.");
        }
        return new TargetValidation(false, w.toString(), c1, c2, c3);
    }

    public static TargetValidation ok() {
        return new TargetValidation(true, "OK", null, null, null);
    }

    private static String fmt(double v) {
        return String.format(java.util.Locale.US, "%.4f", v);
    }
}
