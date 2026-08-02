package com.sgcc.powergrid.realtime;

import com.sgcc.powergrid.common.PlatformProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfiguration implements WebSocketConfigurer {
    private final StationWebSocketHandler handler;
    private final PlatformProperties properties;
    private final StationHandshakeInterceptor stationHandshakeInterceptor;

    public WebSocketConfiguration(StationWebSocketHandler handler, PlatformProperties properties,
            StationHandshakeInterceptor stationHandshakeInterceptor) {
        this.handler = handler;
        this.properties = properties;
        this.stationHandshakeInterceptor = stationHandshakeInterceptor;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        String[] origins = properties.security().corsAllowedOrigins() == null
                ? new String[0] : properties.security().corsAllowedOrigins().toArray(String[]::new);
        registry.addHandler(handler, "/api/v1/stream")
                .addInterceptors(stationHandshakeInterceptor)
                .setAllowedOrigins(origins);
    }
}
