package com.sgcc.powergrid.measurement;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/** Frozen model input whitelist. PV feedback never enters this main-meter payload. */
public final class ElectricalFields {
    private static final ObjectMapper JSON = new ObjectMapper();
    public static final Set<String> NAMES = Set.of(
            "TotW_MA", "PhW_phsA_MA", "PhW_phsB_MA", "PhW_phsC_MA",
            "TotVar_MA", "PhVar_phsA_MA", "PhVar_phsB_MA", "PhVar_phsC_MA",
            "PhV_phsA", "PhV_phsB", "PhV_phsC", "A_phsA", "A_phsB", "A_phsC", "TotPF_AA",
            "TotW_PSD", "PhW_phsA_PSD", "PhW_phsB_PSD", "PhW_phsC_PSD",
            "TotVar_PSD", "PhVar_phsA_PSD", "PhVar_phsB_PSD", "PhVar_phsC_PSD",
            "TotW_MCU", "PhW_phsA_MCU", "PhW_phsB_MCU", "PhW_phsC_MCU",
            "TotW_MCD", "PhW_phsA_MCD", "PhW_phsB_MCD", "PhW_phsC_MCD",
            "TotW_MEA", "PhW_phsA_MEA", "PhW_phsB_MEA", "PhW_phsC_MEA", "A_SCC",
            "TotVar_MCU", "TotVar_MCD", "TotVar_MEA", "PhVar_phsA_MEA", "PhVar_phsB_MEA", "PhVar_phsC_MEA",
            "TotW_AAC", "PhW_phsA_AAC", "PhW_phsB_AAC", "PhW_phsC_AAC",
            "TotVar_AAC", "PhVar_phsA_AAC", "PhVar_phsB_AAC", "PhVar_phsC_AAC",
            "ImbNg_TotW", "ImbNg_TotVar", "TotW_MEC", "TotVar_MEC", "TotW_MTS", "TotVar_MTS");

    public static Map<String, Double> validate(Map<String, Double> values) {
        if (values == null) return Map.of();
        var result = new TreeMap<String, Double>();
        values.forEach((key, value) -> {
            if (!NAMES.contains(key)) throw new IllegalArgumentException("未知电气字段: " + key);
            if (value != null) {
                if (!Double.isFinite(value)) throw new IllegalArgumentException("电气字段必须为有限数值");
                result.put(key, value);
            }
        });
        return java.util.Collections.unmodifiableMap(result);
    }

    public static String json(Object value) {
        try { return JSON.writeValueAsString(value); }
        catch (Exception exception) { throw new IllegalArgumentException("Invalid electrical fields", exception); }
    }

    public static Map<String, Double> values(Object value) {
        try { return value == null ? Map.of() : JSON.readValue(value.toString(), new TypeReference<>() {}); }
        catch (Exception exception) { throw new IllegalStateException("Invalid persisted electrical fields", exception); }
    }

    public static Map<String, Boolean> validity(Object value) {
        try { return value == null ? Map.of() : JSON.readValue(value.toString(), new TypeReference<>() {}); }
        catch (Exception exception) { throw new IllegalStateException("Invalid persisted field validity", exception); }
    }
}
