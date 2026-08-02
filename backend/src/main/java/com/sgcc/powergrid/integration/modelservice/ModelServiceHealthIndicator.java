package com.sgcc.powergrid.integration.modelservice;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

@Component("modelService")
public class ModelServiceHealthIndicator implements HealthIndicator {
    private final ModelServiceClient client;

    public ModelServiceHealthIndicator(ModelServiceClient client) {
        this.client = client;
    }

    @Override
    public Health health() {
        return client.ready()
                ? Health.up().withDetail("service", "python-model-service").build()
                : Health.outOfService().withDetail("service", "python-model-service").build();
    }
}
