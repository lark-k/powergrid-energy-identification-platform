package com.sgcc.powergrid;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sgcc.powergrid.realtime.RealtimeHub;
import com.sgcc.powergrid.station.SnapshotService;
import java.time.OffsetDateTime;
import java.util.Map;
import org.junit.jupiter.api.Test;

class RealtimeHubTest {
    @Test
    void publishingWithoutConnectedClientsIsAValidNoOp() {
        SnapshotService snapshots = mock(SnapshotService.class);
        RealtimeHub hub = new RealtimeHub(snapshots, new ObjectMapper());

        assertThatCode(() -> hub.publish(
                "EVT-1", "REQ-1", "A01", "snapshot.updated",
                OffsetDateTime.parse("2025-12-12T01:34:00Z"), Map.of("target_time", "2025-12-12T01:34:00Z")))
                .doesNotThrowAnyException();
        verifyNoInteractions(snapshots);
    }
}
