package com.sgcc.powergrid.integration.mqtt;

import jakarta.annotation.PreDestroy;
import java.util.concurrent.atomic.AtomicBoolean;
import org.eclipse.paho.client.mqttv3.IMqttActionListener;
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.IMqttToken;
import org.eclipse.paho.client.mqttv3.MqttAsyncClient;
import org.eclipse.paho.client.mqttv3.MqttCallbackExtended;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "platform.mqtt", name = "enabled", havingValue = "true")
public class MqttTelemetrySubscriber implements MqttCallbackExtended {
    private static final Logger LOGGER = LoggerFactory.getLogger(MqttTelemetrySubscriber.class);

    private final MqttTelemetryProperties properties;
    private final MqttTelemetryMessageProcessor processor;
    private final AtomicBoolean connecting = new AtomicBoolean();
    private final AtomicBoolean everConnected = new AtomicBoolean();
    private final AtomicBoolean stopped = new AtomicBoolean();
    private volatile MqttAsyncClient client;

    public MqttTelemetrySubscriber(
            MqttTelemetryProperties properties,
            MqttTelemetryMessageProcessor processor) {
        this.properties = properties;
        this.processor = processor;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        ensureConnected();
    }

    @Scheduled(fixedDelayString = "${platform.mqtt.reconnect-delay-ms:10000}")
    public void ensureConnected() {
        if (stopped.get()) {
            return;
        }
        try {
            MqttAsyncClient current = client();
            if (current.isConnected()
                    || (everConnected.get() && properties.automaticReconnect())
                    || !connecting.compareAndSet(false, true)) {
                return;
            }
            current.connect(connectOptions(), null, new IMqttActionListener() {
                @Override
                public void onSuccess(IMqttToken asyncActionToken) {
                    connecting.set(false);
                }

                @Override
                public void onFailure(IMqttToken asyncActionToken, Throwable exception) {
                    connecting.set(false);
                    LOGGER.warn("MQTT connection failed broker={} error={}",
                            properties.brokerUri(), exception.getClass().getSimpleName());
                }
            });
        } catch (MqttException exception) {
            connecting.set(false);
            LOGGER.warn("Unable to start MQTT connection broker={} reason={}",
                    properties.brokerUri(), exception.getReasonCode());
        }
    }

    private synchronized MqttAsyncClient client() throws MqttException {
        if (client == null) {
            String configuredId = properties.clientId();
            String clientId = configuredId == null || configuredId.isBlank()
                    ? MqttAsyncClient.generateClientId() : configuredId;
            client = new MqttAsyncClient(properties.brokerUri(), clientId, new MemoryPersistence());
            client.setCallback(this);
        }
        return client;
    }

    private MqttConnectOptions connectOptions() {
        MqttConnectOptions options = new MqttConnectOptions();
        options.setMqttVersion(MqttConnectOptions.MQTT_VERSION_3_1_1);
        options.setAutomaticReconnect(properties.automaticReconnect());
        options.setCleanSession(properties.cleanSession());
        options.setConnectionTimeout(properties.connectionTimeoutSeconds());
        options.setKeepAliveInterval(properties.keepAliveSeconds());
        return options;
    }

    @Override
    public void connectComplete(boolean reconnect, String serverURI) {
        connecting.set(false);
        everConnected.set(true);
        LOGGER.info("MQTT connected broker={} reconnect={}", serverURI, reconnect);
        try {
            client().subscribe(properties.topicFilter(), properties.qos(), null, new IMqttActionListener() {
                @Override
                public void onSuccess(IMqttToken asyncActionToken) {
                    LOGGER.info("MQTT subscribed topic={} qos={}", properties.topicFilter(), properties.qos());
                }

                @Override
                public void onFailure(IMqttToken asyncActionToken, Throwable exception) {
                    LOGGER.warn("MQTT subscription failed topic={} error={}",
                            properties.topicFilter(), exception.getClass().getSimpleName());
                }
            });
        } catch (MqttException exception) {
            LOGGER.warn("Unable to subscribe MQTT topic={} reason={}",
                    properties.topicFilter(), exception.getReasonCode());
        }
    }

    @Override
    public void connectionLost(Throwable cause) {
        connecting.set(false);
        LOGGER.warn("MQTT connection lost broker={} error={}", properties.brokerUri(),
                cause == null ? "unknown" : cause.getClass().getSimpleName());
    }

    @Override
    public void messageArrived(String topic, MqttMessage message) {
        try {
            processor.process(topic, message.getPayload());
        } catch (Exception exception) {
            LOGGER.warn("MQTT telemetry rejected topic={} error={} message={}",
                    topic, exception.getClass().getSimpleName(), exception.getMessage());
        }
    }

    @Override
    public void deliveryComplete(IMqttDeliveryToken token) {
        // This client subscribes only and does not publish application messages.
    }

    @PreDestroy
    public void stop() {
        stopped.set(true);
        MqttAsyncClient current = client;
        if (current == null) {
            return;
        }
        try {
            if (current.isConnected()) {
                current.disconnect().waitForCompletion(5_000);
            }
        } catch (MqttException exception) {
            LOGGER.warn("MQTT disconnect failed reason={}", exception.getReasonCode());
        } finally {
            try {
                current.close();
            } catch (MqttException exception) {
                LOGGER.warn("MQTT close failed reason={}", exception.getReasonCode());
            }
        }
    }
}
