package com.sgcc.powergrid.integration.mqtt;

import com.sgcc.powergrid.measurement.IngestionModels.Receipt;
import com.sgcc.powergrid.measurement.IngestionService;
import com.sgcc.powergrid.measurement.MainSwitchMinutePoint;
import com.sgcc.powergrid.measurement.MeasurementRepository;
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

    public MqttTelemetryMessageProcessor(
            MqttTelemetryMapper mapper,
            IngestionService ingestionService,
            MeasurementRepository measurements) {
        this.mapper = mapper;
        this.ingestionService = ingestionService;
        this.measurements = measurements;
    }

    public void process(String topic, byte[] payload) throws IOException {
        var mapped = mapper.map(topic, payload);
        if (mapped.isEmpty()) {
            return;
        }
        var minute = mapped.get();
        List<MainSwitchMinutePoint> points = new ArrayList<>(2);
        measurements.latestBefore(minute.point().stationId(), minute.point().eventTime())
                .filter(previous -> previous.eventTime().plusMinutes(2).isEqual(minute.point().eventTime()))
                .map(previous -> midpoint(previous, minute.point()))
                .ifPresent(points::add);
        points.add(minute.point());
        Receipt receipt = ingestionService.ingest(points, minute.requestId());
        LOGGER.info(
                "MQTT minute processed device={} station={} event_time={} data_time={} frame_time={} gap_filled={} inserted={} duplicates={} inference_scheduled={}",
                minute.deviceId(), minute.point().stationId(), minute.point().eventTime(),
                minute.dataTime(), minute.frameTime(),
                points.size() - 1,
                receipt.inserted(), receipt.duplicates(), receipt.inferenceScheduled());
    }

    private static MainSwitchMinutePoint midpoint(
            MainSwitchMinutePoint previous,
            MainSwitchMinutePoint current) {
        return new MainSwitchMinutePoint(
                current.stationId(),
                previous.eventTime().plusMinutes(1),
                average(previous.activePowerKw(), current.activePowerKw()),
                average(previous.phaseAPowerKw(), current.phaseAPowerKw()),
                average(previous.phaseBPowerKw(), current.phaseBPowerKw()),
                average(previous.phaseCPowerKw(), current.phaseCPowerKw()),
                average(previous.reactivePowerKvar(), current.reactivePowerKvar()),
                average(previous.voltage(), current.voltage()),
                average(previous.current(), current.current()),
                average(previous.pf(), current.pf()),
                average(previous.coverageRatio(), current.coverageRatio()),
                "good",
                current.sourceId());
    }

    private static double average(double left, double right) {
        return (left + right) / 2.0;
    }

    private static Double average(Double left, Double right) {
        return left == null || right == null ? null : average(left.doubleValue(), right.doubleValue());
    }
}
