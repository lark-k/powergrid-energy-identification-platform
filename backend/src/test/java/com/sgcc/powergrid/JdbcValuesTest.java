package com.sgcc.powergrid;

import static org.assertj.core.api.Assertions.assertThat;

import com.sgcc.powergrid.common.JdbcValues;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

class JdbcValuesTest {
    private static final Instant INSTANT = Instant.parse("2025-12-12T01:34:00Z");

    @Test
    void convertsSupportedTimezoneAwareJdbcValuesToTheSameInstant() {
        OffsetDateTime offsetDateTime = INSTANT.atOffset(java.time.ZoneOffset.ofHours(8));

        assertThat(JdbcValues.offsetDateTime(offsetDateTime).toInstant()).isEqualTo(INSTANT);
        assertThat(JdbcValues.offsetDateTime(Timestamp.from(INSTANT)).toInstant()).isEqualTo(INSTANT);
        assertThat(JdbcValues.offsetDateTime(INSTANT).toInstant()).isEqualTo(INSTANT);
    }
}
