package com.sgcc.powergrid.measurement;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;

public final class IngestionModels {
    private IngestionModels() {}

    public record Request(@NotEmpty @Size(max = 5000) List<@Valid MainSwitchMinutePoint> points) {}

    public record Receipt(
            String requestId,
            int accepted,
            int inserted,
            int updated,
            int duplicates,
            int outOfOrder,
            boolean inferenceScheduled) {}

    public record MinutesIngestedEvent(String stationId, String requestId, List<OffsetDateTime> eventTimes) {}
}
