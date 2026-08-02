package com.sgcc.powergrid.common;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "platform")
public record PlatformProperties(Security security, ModelService modelService, Imports imports) {
    public record Security(String mode, List<String> corsAllowedOrigins) {}

    public record ModelService(
            String baseUrl,
            String token,
            Duration connectTimeout,
            Duration readTimeout,
            int maxRetries,
            int circuitFailureThreshold,
            Duration circuitOpenDuration,
            boolean shadowEnabled,
            String candidateBaseUrl) {}

    public record Imports(List<String> allowedContentTypes) {}
}
