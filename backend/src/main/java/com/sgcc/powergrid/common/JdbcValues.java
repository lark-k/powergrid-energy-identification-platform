package com.sgcc.powergrid.common;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

public final class JdbcValues {
    private JdbcValues() {}

    public static OffsetDateTime offsetDateTime(Object value) {
        if (value instanceof OffsetDateTime offsetDateTime) {
            return offsetDateTime;
        }
        if (value instanceof Timestamp timestamp) {
            return timestamp.toInstant().atOffset(ZoneOffset.UTC);
        }
        if (value instanceof Instant instant) {
            return instant.atOffset(ZoneOffset.UTC);
        }
        throw new IllegalArgumentException("Expected a timezone-aware JDBC timestamp but got "
                + (value == null ? "null" : value.getClass().getName()));
    }
}
