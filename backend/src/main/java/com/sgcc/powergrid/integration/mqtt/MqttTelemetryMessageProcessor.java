package com.sgcc.powergrid.integration.mqtt;

import com.sgcc.powergrid.measurement.IngestionModels.Receipt;
import com.sgcc.powergrid.measurement.IngestionService;
import com.sgcc.powergrid.measurement.MainSwitchMinutePoint;
import com.sgcc.powergrid.measurement.MeasurementRepository;
import com.sgcc.powergrid.feedback.FeedbackService;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(prefix = "platform.mqtt", name = "enabled", havingValue = "true")
public class MqttTelemetryMessageProcessor {
    private static final Logger LOGGER = LoggerFactory.getLogger(MqttTelemetryMessageProcessor.class);

    private final MqttTelemetryMapper mapper;
    private final IngestionService ingestionService;
    private final MeasurementRepository measurements;
    private final FeedbackService feedbackService;

    public MqttTelemetryMessageProcessor(
            MqttTelemetryMapper mapper,
            IngestionService ingestionService,
            MeasurementRepository measurements,
            FeedbackService feedbackService) {
        this.mapper = mapper;
        this.ingestionService = ingestionService;
        this.measurements = measurements;
        this.feedbackService = feedbackService;
    }

    public void process(String topic, byte[] payload) throws IOException {
        var mapped = mapper.map(topic, payload);
        if (mapped.isEmpty()) {
            return;
        }
        var minute = mapped.get();
        if (minute.feedback() != null) {
            var receipt = feedbackService.ingest(minute.feedback(), minute.requestId());
            LOGGER.info("MQTT PV feedback processed device={} station={} event_time={} data_time={} frame_time={} pv_kw={} status={} corrected={}",
                    minute.deviceId(), minute.feedback().stationId(), minute.feedback().coverageStart(),
                    minute.dataTime(), minute.frameTime(), minute.feedback().points().getFirst().pvValue(),
                    receipt.status(), receipt.correctedMinutes());
            return;
        }
        // Persist measured minutes only. Each model applies its own missing-data policy.
        List<MainSwitchMinutePoint> points = List.of(minute.point());
        Receipt receipt = ingestionService.ingest(points, minute.requestId());
        LOGGER.info(
                "MQTT minute processed device={} station={} event_time={} data_time={} frame_time={} gap_filled={} inserted={} duplicates={} inference_scheduled={}",
                minute.deviceId(), minute.point().stationId(), minute.point().eventTime(),
                minute.dataTime(), minute.frameTime(),
                points.size() - 1,
                receipt.inserted(), receipt.duplicates(), receipt.inferenceScheduled());
    }

}
