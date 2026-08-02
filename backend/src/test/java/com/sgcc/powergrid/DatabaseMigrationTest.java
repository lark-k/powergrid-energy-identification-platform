package com.sgcc.powergrid;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest
@ActiveProfiles("test")
class DatabaseMigrationTest {
    @Autowired JdbcClient jdbc;

    @Test
    void emptyDatabaseMigrationCreatesAllRequiredTables() {
        List<String> required = List.of(
                "station", "main_switch_minute", "recognition_result", "recognition_item",
                "pv_separation_result", "pv_feedback_batch", "pv_feedback_point",
                "correction_record", "model_registry", "model_deployment", "training_run",
                "training_epoch", "collection_process_event", "node_status",
                "data_quality_summary", "audit_log", "outbox_event", "inference_replay_job");
        List<String> actual = jdbc.sql("""
                        select table_name from information_schema.tables
                        where table_schema = 'public'
                        """).query(String.class).list();
        assertThat(actual).containsAll(required);
    }
}
