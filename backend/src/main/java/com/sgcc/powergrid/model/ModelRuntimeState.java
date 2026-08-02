package com.sgcc.powergrid.model;

import java.time.OffsetDateTime;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.stereotype.Component;

@Component
public class ModelRuntimeState {
    private final AtomicReference<State> state = new AtomicReference<>(
            new State("degraded", "degraded", null, null, null, null, "warming_up"));

    public State get() { return state.get(); }

    public void success(String recognitionVersion, String separationVersion, double milliseconds, OffsetDateTime at,
            String windowStatus) {
        state.set(new State(
                recognitionVersion == null ? "degraded" : "running",
                separationVersion == null ? "degraded" : "running",
                recognitionVersion,
                separationVersion,
                milliseconds,
                at,
                windowStatus));
    }

    public void failure() {
        State previous = state.get();
        state.set(new State("degraded", "degraded", previous.recognitionVersion(),
                previous.separationVersion(), previous.lastInferenceMs(), previous.lastInferenceTime(), "delayed"));
    }

    public record State(
            String recognitionStatus,
            String separationStatus,
            String recognitionVersion,
            String separationVersion,
            Double lastInferenceMs,
            OffsetDateTime lastInferenceTime,
            String windowStatus) {}
}
