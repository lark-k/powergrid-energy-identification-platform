package com.sgcc.powergrid.integration.mqtt;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sgcc.powergrid.measurement.IngestionModels.Receipt;
import com.sgcc.powergrid.measurement.IngestionService;
import com.sgcc.powergrid.measurement.MainSwitchMinutePoint;
import com.sgcc.powergrid.measurement.MeasurementRepository;
import com.sgcc.powergrid.feedback.FeedbackService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class MqttTelemetryMessageProcessorTest {
    @Test
    void preservesMissingMinuteForModelSpecificPreprocessing() throws Exception {
        MqttTelemetryMapper mapper = mock(MqttTelemetryMapper.class);
        IngestionService ingestion = mock(IngestionService.class);
        MeasurementRepository measurements = mock(MeasurementRepository.class);
        MqttTelemetryMessageProcessor processor =
                new MqttTelemetryMessageProcessor(mapper, ingestion, measurements, mock(FeedbackService.class));
        byte[] payload = {1};
        MainSwitchMinutePoint previous = point("2026-09-04T19:48:00+08:00", -0.802, -0.234, -0.288, -0.280);
        MainSwitchMinutePoint current = point("2026-09-04T19:50:00+08:00", -0.794, -0.233, -0.285, -0.276);
        when(mapper.map("topic", payload)).thenReturn(Optional.of(new MqttTelemetryMapper.MappedMinute(
                "device", "request", OffsetDateTime.parse("2026-09-04T19:50:19+08:00"),
                OffsetDateTime.parse("2026-09-04T19:49:21+08:00"), current)));
        when(measurements.latestBefore("A01", current.eventTime())).thenReturn(Optional.of(previous));
        when(ingestion.ingest(anyList(), eq("request")))
                .thenReturn(new Receipt("request", 2, 2, 0, 0, 0, true));

        processor.process("topic", payload);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<MainSwitchMinutePoint>> points = ArgumentCaptor.forClass(List.class);
        verify(ingestion).ingest(points.capture(), eq("request"));
        assertThat(points.getValue()).hasSize(1);
        assertThat(points.getValue().getLast()).isSameAs(current);
    }

    private static MainSwitchMinutePoint point(
            String eventTime,
            double active,
            double phaseA,
            double phaseB,
            double phaseC) {
        return new MainSwitchMinutePoint(
                "A01", OffsetDateTime.parse(eventTime), active, phaseA, phaseB, phaseC,
                -0.87, null, null, -0.03, 1.0, "good", "mqtt:device");
    }
}
