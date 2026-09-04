package com.sgcc.powergrid.integration.mqtt;

import com.sgcc.powergrid.measurement.IngestionModels.Receipt;
import com.sgcc.powergrid.measurement.IngestionService;
import java.io.IOException;
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

    public MqttTelemetryMessageProcessor(MqttTelemetryMapper mapper, IngestionService ingestionService) {
        this.mapper = mapper;
        this.ingestionService = ingestionService;
    }

    public void process(String topic, byte[] payload) throws IOException {
        var mapped = mapper.map(topic, payload);
        if (mapped.isEmpty()) {
            return;
        }
        var minute = mapped.get();
        Receipt receipt = ingestionService.ingest(List.of(minute.point()), minute.requestId());
        LOGGER.info(
                "MQTT minute processed device={} station={} event_time={} inserted={} duplicates={} inference_scheduled={}",
                minute.deviceId(), minute.point().stationId(), minute.point().eventTime(),
                receipt.inserted(), receipt.duplicates(), receipt.inferenceScheduled());
    }
}
