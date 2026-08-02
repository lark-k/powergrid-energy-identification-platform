package com.sgcc.powergrid.common;

import java.util.List;

public record PagedResponse<T>(List<T> items, String nextCursor, boolean hasMore) {}
