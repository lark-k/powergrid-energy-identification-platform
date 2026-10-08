package com.sgcc.powergrid.model;

import com.sgcc.powergrid.integration.modelservice.ModelServiceClient;
import com.sgcc.powergrid.measurement.MeasurementRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/** Finalize arrival minutes after they close, including the three-minute causal hold. */
@Service
public class ArrivalMinuteInferenceScheduler {
    private final MeasurementRepository measurements;
    private final InferencePipeline pipeline;
    private final ModelServiceClient modelService;

    public ArrivalMinuteInferenceScheduler(MeasurementRepository measurements, InferencePipeline pipeline, ModelServiceClient modelService) {
        this.measurements = measurements;
        this.pipeline = pipeline;
        this.modelService = modelService;
    }

    @Scheduled(cron = "5 * * * * *")
    @SuppressWarnings("unchecked")
    public void inferClosedMinute() {
        try {
            Map<String, Object> catalog = modelService.modelVersions();
            String active = ((Map<String, String>) catalog.get("active")).get("pv_separation");
            boolean arrivalModel = ((List<Map<String, Object>>) catalog.get("models")).stream().anyMatch(m ->
                    active.equals(m.get("model_version")) && m.get("manifest") instanceof Map<?, ?> manifest
                            && "small_s4d".equals(manifest.get("model_type")));
            if (!arrivalModel) return;
            OffsetDateTime decision = OffsetDateTime.now(ZoneOffset.UTC).withSecond(0).withNano(0);
            OffsetDateTime target = decision.minusMinutes(1);
            for (String station : measurements.recentlyArrivingStations(target.minusMinutes(4), decision)) {
                pipeline.process(station, target, "arrival-" + station + "-" + target.toEpochSecond());
            }
        } catch (Exception exception) {
            LoggerFactory.getLogger(getClass()).warn("Closed arrival-minute inference unavailable: {}", exception.getClass().getSimpleName());
        }
    }
}
